import { DEMO_TENANTS } from "../config/demoTenants";

const WORKSPACE_PHARMACY_ID_KEY = "falconmed_workspace_pharmacy_id";

function normalizeId(value) {
  return String(value || "").trim();
}

export function readWorkspacePharmacyId() {
  if (typeof window === "undefined") return "";
  try {
    return normalizeId(window.localStorage.getItem(WORKSPACE_PHARMACY_ID_KEY));
  } catch {
    return "";
  }
}

export function writeWorkspacePharmacyId(pharmacyId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_PHARMACY_ID_KEY, normalizeId(pharmacyId));
  } catch {
    // Ignore storage failures.
  }
}

function dedupeById(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const id = normalizeId(row?.id);
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      name: String(row?.name || "").trim() || "Unknown Pharmacy",
      location: String(row?.location || "").trim(),
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

export function resolveWorkspacePharmacies(pharmacies = []) {
  const dbOptions = dedupeById(pharmacies);
  if (dbOptions.length > 0) return dbOptions;
  return dedupeById(DEMO_TENANTS);
}

export function resolveWorkspaceSelection(options = [], preferredId = "") {
  const normalizedPreferred = normalizeId(preferredId);
  const fromStorage = readWorkspacePharmacyId();

  if (normalizedPreferred && options.some((item) => item.id === normalizedPreferred)) {
    return normalizedPreferred;
  }

  if (fromStorage && options.some((item) => item.id === fromStorage)) {
    return fromStorage;
  }

  return options[0]?.id || "";
}
