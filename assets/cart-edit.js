import { QuickBuyModal } from "theme";

class LineItemEditModal extends QuickBuyModal {
  constructor() {
    super();
    this.addEventListener("submit", this._handleSubmit.bind(this), { capture: true });
  }

  async show() {
    const result = await super.show();
    const quantityInput = this.querySelector('form[action*="/cart/add"] input[name="quantity"]');
    const lineQuantity = parseInt(this.getAttribute("line-quantity") || "1", 10);
    if (quantityInput && lineQuantity > 0) {
      quantityInput.value = String(lineQuantity);
    }
    return result;
  }

  async _handleSubmit(event) {
    const form = event.target;
    if (!form || !form.matches('form[action*="/cart/add"]')) return;
    const lineKey = this.getAttribute("line-key");
    if (!lineKey) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const submitButtons = Array.from(form.elements).filter((el) => el.type === "submit");
    submitButtons.forEach((btn) => btn.setAttribute("aria-busy", "true"));
    document.documentElement.dispatchEvent(new CustomEvent("theme:loading:start", { bubbles: true }));

    try {
      const formData = new FormData(form);

      const addResponse = await fetch(`${Shopify.routes.root}cart/add.js`, {
        method: "POST",
        body: formData,
        headers: { "X-Requested-With": "XMLHttpRequest" }
      });

      if (!addResponse.ok) {
        const err = await addResponse.json();
        form.dispatchEvent(new CustomEvent("cart:error", { bubbles: true, detail: { error: err.description } }));
        return;
      }

      const sectionsToBundle = [];
      document.documentElement.dispatchEvent(
        new CustomEvent("cart:prepare-bundled-sections", { bubbles: true, detail: { sections: sectionsToBundle } })
      );

      const removeResponse = await fetch(`${Shopify.routes.root}cart/change.js`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lineKey,
          quantity: 0,
          sections: sectionsToBundle.join(",")
        })
      });

      const cartContent = await removeResponse.json();

      await this.hide();

      document.documentElement.dispatchEvent(
        new CustomEvent("cart:change", {
          bubbles: true,
          detail: {
            baseEvent: "line-item:change",
            cart: cartContent
          }
        })
      );
    } finally {
      submitButtons.forEach((btn) => btn.removeAttribute("aria-busy"));
      document.documentElement.dispatchEvent(new CustomEvent("theme:loading:end", { bubbles: true }));
    }
  }
}

if (!window.customElements.get("line-item-edit-modal")) {
  window.customElements.define("line-item-edit-modal", LineItemEditModal);
}
