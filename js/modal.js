(function (root) {
  "use strict";

  const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  function createModalController(element) {
    let returnFocus = null;

    function focusableElements() {
      return [...element.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (control) => !control.hidden && control.offsetParent !== null,
      );
    }

    function open(initialFocus = null) {
      returnFocus = document.activeElement;
      element.hidden = false;
      element.classList.add("open");
      const target = initialFocus || focusableElements()[0];
      target?.focus();
    }

    function close() {
      if (!element.classList.contains("open")) return;
      element.classList.remove("open");
      element.hidden = true;
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    }

    element.addEventListener("click", (event) => {
      if (event.target === element) close();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusableElements();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    return Object.freeze({ open, close });
  }

  root.ReforgePlanner.modal = Object.freeze({ createModalController });
})(globalThis);
