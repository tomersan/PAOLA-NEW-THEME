import { QuickBuyModal } from "theme";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnceWithBackoff(url, options) {
  let response = await fetch(url, options);
  if (response.status !== 429) return response;
  await sleep(1500);
  return fetch(url, options);
}

const SPINNER_STYLE_ID = "cart-edit-spinner-style";
function ensureSpinnerStyle() {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const styleEl = document.createElement("style");
  styleEl.id = SPINNER_STYLE_ID;
  styleEl.textContent = `
    @keyframes cart-edit-spin { to { transform: rotate(360deg); } }
    .cart-edit-loading-overlay {
      position: absolute;
      inset: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.78);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
      border-radius: inherit;
    }
    .cart-edit-loading-overlay__spinner {
      width: 44px;
      height: 44px;
      border: 3px solid rgba(0, 0, 0, 0.12);
      border-top-color: rgba(0, 0, 0, 0.65);
      border-radius: 50%;
      animation: cart-edit-spin 0.75s linear infinite;
    }
  `;
  document.head.appendChild(styleEl);
}

class LineItemEditModal extends QuickBuyModal {
  constructor() {
    super();
    this.addEventListener("submit", this._handleSubmit.bind(this), { capture: true });
  }

  async show() {
    let result;
    try {
      result = await super.show();
    } catch (e) {
      console.warn("[cart-edit] modal open failed, retrying once after 1.5s", e);
      await sleep(1500);
      try {
        result = await super.show();
      } catch (e2) {
        alert("השרת עמוס כרגע, אנא נסה שוב בעוד מספר שניות");
        throw e2;
      }
    }
    const quantityInput = this.querySelector('form[action*="/cart/add"] input[name="quantity"]');
    const lineQuantity = parseInt(this.getAttribute("line-quantity") || "1", 10);
    if (quantityInput && lineQuantity > 0) {
      quantityInput.value = String(lineQuantity);
    }
    return result;
  }

  _showLoadingOverlay() {
    ensureSpinnerStyle();
    const host = this.querySelector(".quick-buy-modal__content") || this;
    if (!host.style.position) host.style.position = "relative";
    const overlay = document.createElement("div");
    overlay.className = "cart-edit-loading-overlay";
    const spinner = document.createElement("div");
    spinner.className = "cart-edit-loading-overlay__spinner";
    overlay.appendChild(spinner);
    host.appendChild(overlay);
    this._loadingOverlay = overlay;
  }

  _hideLoadingOverlay() {
    if (this._loadingOverlay) {
      this._loadingOverlay.remove();
      this._loadingOverlay = null;
    }
  }

  async _handleSubmit(event) {
    const form = event.target;
    if (!form || !form.matches('form[action*="/cart/add"]')) return;
    const oldLineKey = this.getAttribute("line-key");
    if (!oldLineKey) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const formData = new FormData(form);
    const newVariantId = String(formData.get("id") || "");
    const newQuantity = parseInt(formData.get("quantity"), 10) || 1;

    if (!newVariantId) return;

    // /cart/update.js with a variant_id REPLACES the qty of all matching lines instead of adding to it.
    // If the new variant already exists in another line, target that line by key and merge quantities.
    const existingMatch = Array.from(document.querySelectorAll("[data-line-key]"))
      .map((el) => ({ key: el.dataset.lineKey, qty: parseInt(el.value, 10) || 0 }))
      .find(({ key }) => key !== oldLineKey && key.startsWith(`${newVariantId}:`));

    const updates = { [oldLineKey]: 0 };
    if (existingMatch) {
      updates[existingMatch.key] = existingMatch.qty + newQuantity;
    } else {
      updates[newVariantId] = newQuantity;
    }

    const submitButtons = Array.from(form.elements).filter((el) => el.type === "submit");
    submitButtons.forEach((btn) => btn.setAttribute("aria-busy", "true"));
    document.documentElement.dispatchEvent(new CustomEvent("theme:loading:start", { bubbles: true }));
    this._showLoadingOverlay();

    let cartContent = null;
    let errorDescription = null;

    try {
      const sectionsToBundle = [];
      document.documentElement.dispatchEvent(
        new CustomEvent("cart:prepare-bundled-sections", { bubbles: true, detail: { sections: sectionsToBundle } })
      );

      const updateResponse = await fetchOnceWithBackoff(`${Shopify.routes.root}cart/update.js`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({
          updates,
          sections: sectionsToBundle.join(",")
        })
      });

      if (!updateResponse.ok) {
        const err = await updateResponse.json().catch(() => ({}));
        errorDescription = err.description || `שגיאה בעדכון הסל (HTTP ${updateResponse.status})`;
        return;
      }

      cartContent = await updateResponse.json();
    } catch (e) {
      errorDescription = e?.message || "שגיאה לא צפויה";
    } finally {
      submitButtons.forEach((btn) => btn.removeAttribute("aria-busy"));
      document.documentElement.dispatchEvent(new CustomEvent("theme:loading:end", { bubbles: true }));
      this._hideLoadingOverlay();

      if (errorDescription && !cartContent) {
        form.dispatchEvent(new CustomEvent("cart:error", { bubbles: true, detail: { error: errorDescription } }));
        await sleep(1800);
      }

      try { await this.hide(); } catch (_) {}

      if (cartContent) {
        document.documentElement.dispatchEvent(
          new CustomEvent("cart:change", {
            bubbles: true,
            detail: { baseEvent: "line-item:change", cart: cartContent }
          })
        );
      } else {
        document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true }));
      }
    }
  }
}

if (!window.customElements.get("line-item-edit-modal")) {
  window.customElements.define("line-item-edit-modal", LineItemEditModal);
}
