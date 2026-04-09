import { loadDrugMaster } from "./drugMasterLoader";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let cachedPriceMap = new Map();
let hasInitialized = false;

function buildPriceMapFromRows(rows = []) {
  const map = new Map();

  for (const drug of Array.isArray(rows) ? rows : []) {
    const pharmacyUnitPrice = toNumber(
      drug?.pharmacy_unit_price ?? drug?.unit_price_pharmacy,
      0
    );

    if (pharmacyUnitPrice <= 0) continue;

    const keys = [
      drug?.drug_name,
      drug?.brand_name,
      drug?.generic_name,
      drug?.drug_code,
      drug?.display_name,
    ]
      .map((value) => normalizeName(value))
      .filter(Boolean);

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, pharmacyUnitPrice);
      }
    }
  }

  return map;
}

function warmCacheIfNeeded() {
  if (hasInitialized) return;
  hasInitialized = true;

  loadDrugMaster()
    .then((rows) => {
      cachedPriceMap = buildPriceMapFromRows(rows || []);
    })
    .catch(() => {
      cachedPriceMap = new Map();
    });
}

export function buildDrugPriceMap() {
  warmCacheIfNeeded();
  return cachedPriceMap;
}

export function resolvePharmacyUnitPrice(drugName) {
  warmCacheIfNeeded();
  const key = normalizeName(drugName);
  if (!key) return null;

  if (cachedPriceMap.has(key)) {
    return cachedPriceMap.get(key);
  }

  return null;
}
