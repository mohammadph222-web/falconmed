export const INVENTORY_DRAFT_STORAGE_KEY = "falconmed_inventory_draft";
export const INVENTORY_BULK_PREVIEW_STORAGE_KEY = "falconmed_bulk_upload_preview";
export const INVENTORY_BULK_SUMMARY_STORAGE_KEY = "falconmed_inventory_upload_summary";

export function readStorageJson(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStorageJson(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

export function clearStorageKey(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage remove failures.
  }
}

export function clearInventoryDraftStorage() {
  clearStorageKey(INVENTORY_DRAFT_STORAGE_KEY);
}

export function clearInventoryBulkPreviewStorage() {
  clearStorageKey(INVENTORY_BULK_PREVIEW_STORAGE_KEY);
}

export function loadInventoryDraftBundle() {
  return {
    draft: readStorageJson(INVENTORY_DRAFT_STORAGE_KEY),
    preview: readStorageJson(INVENTORY_BULK_PREVIEW_STORAGE_KEY),
    summary: readStorageJson(INVENTORY_BULK_SUMMARY_STORAGE_KEY),
  };
}

export function saveInventoryDraftBundle(draftPayload) {
  writeStorageJson(INVENTORY_DRAFT_STORAGE_KEY, draftPayload);
}

export function saveInventoryBulkPreview(previewPayload) {
  if (previewPayload) {
    writeStorageJson(INVENTORY_BULK_PREVIEW_STORAGE_KEY, previewPayload);
    return;
  }
  clearStorageKey(INVENTORY_BULK_PREVIEW_STORAGE_KEY);
}

export function saveInventoryBulkSummary(summaryPayload) {
  writeStorageJson(INVENTORY_BULK_SUMMARY_STORAGE_KEY, summaryPayload);
}
