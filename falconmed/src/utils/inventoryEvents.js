export const INVENTORY_UPDATED_EVENT = "falconmed:inventory-updated";

export function emitInventoryUpdated(pharmacyId = "") {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent(INVENTORY_UPDATED_EVENT, {
      detail: { pharmacyId: String(pharmacyId || "") },
    })
  );
}

export function subscribeInventoryUpdated(listener) {
  if (typeof window === "undefined" || typeof listener !== "function") {
    return () => {};
  }

  const wrapped = (event) => {
    listener(event?.detail || {});
  };

  window.addEventListener(INVENTORY_UPDATED_EVENT, wrapped);
  return () => window.removeEventListener(INVENTORY_UPDATED_EVENT, wrapped);
}
