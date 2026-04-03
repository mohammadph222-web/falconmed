import { loadDrugMaster, parseDrugPrice } from "./drugMaster";

let pricingCache = new Map();
let cacheReady = false;
let cachePromise = null;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,;:()\[\]{}]+/g, " ")
    .replace(/[+/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPositiveNumber(value) {
  const parsed = parseDrugPrice(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function derivePricing(drug) {
  const pharmacyUnitPrice =
    toPositiveNumber(drug?.unit_price_pharmacy) ||
    toPositiveNumber(drug?.unit_price_to_pharmacy) ||
    toPositiveNumber(drug?.pharmacy_price) ||
    toPositiveNumber(drug?.price_to_pharmacy) ||
    toPositiveNumber(drug?.unit_cost);

  const publicUnitPrice =
    toPositiveNumber(drug?.unit_price_public) ||
    toPositiveNumber(drug?.unit_price_to_public) ||
    toPositiveNumber(drug?.public_price) ||
    toPositiveNumber(drug?.price_to_public);

  if (pharmacyUnitPrice == null && publicUnitPrice == null) {
    return null;
  }

  return { pharmacyUnitPrice, publicUnitPrice };
}

function buildPricingMap(drugs) {
  const map = new Map();

  for (const drug of drugs || []) {
    const pricing = derivePricing(drug);
    if (!pricing) continue;

    const keys = [
      normalize(drug?.drug_name),
      normalize(drug?.brand_name),
      normalize(drug?.generic_name),
      normalize([drug?.drug_name, drug?.strength].filter(Boolean).join(" ")),
      normalize([drug?.brand_name, drug?.strength].filter(Boolean).join(" ")),
    ].filter(Boolean);

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, pricing);
      }
    }
  }

  return map;
}

async function ensureCacheLoaded() {
  if (cacheReady) return;
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        const drugs = await loadDrugMaster();
        pricingCache = buildPricingMap(drugs || []);
      } catch {
        pricingCache = new Map();
      } finally {
        cacheReady = true;
      }
    })();
  }

  await cachePromise;
}

// Kept synchronous for compatibility with existing callers in hidden modules.
export function buildDrugPriceMap() {
  if (!cacheReady) {
    void ensureCacheLoaded();
  }
  return pricingCache;
}

export function resolveDrugPricing(drugName) {
  if (!cacheReady) {
    void ensureCacheLoaded();
  }

  const key = normalize(drugName);
  if (!key) return null;

  return pricingCache.get(key) || null;
}

export function resolvePharmacyUnitPrice(drugName) {
  return resolveDrugPricing(drugName)?.pharmacyUnitPrice ?? null;
}
