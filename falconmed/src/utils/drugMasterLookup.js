import Papa from "papaparse";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function candidateKeys(drug) {
  return [
    drug?.barcode,
    drug?.drug_code,
    drug?.drug_name,
    drug?.brand_name,
    drug?.generic_name,
    drug?.display_name,
  ]
    .map((value) => normalizeKey(value))
    .filter(Boolean);
}

export function buildDrugCodeMap(drugs = []) {
  const map = new Map();

  for (const drug of Array.isArray(drugs) ? drugs : []) {
    for (const key of candidateKeys(drug)) {
      if (!map.has(key)) {
        map.set(key, drug);
      }
    }
  }

  return map;
}

function findInArrayByIdentifier(identifier, drugs = []) {
  const target = normalizeKey(identifier);
  if (!target) return null;

  for (const drug of Array.isArray(drugs) ? drugs : []) {
    const keys = candidateKeys(drug);
    if (keys.includes(target)) {
      return drug;
    }
  }

  return null;
}

export function findDrugByCode(code, drugCodeMap, drugs = []) {
  const key = normalizeKey(code);
  if (!key) return null;

  if (drugCodeMap?.has(key)) {
    return drugCodeMap.get(key) || null;
  }

  return findInArrayByIdentifier(key, drugs);
}

export function findDrugByDrugCode(drugCode, drugs = []) {
  const key = normalizeKey(drugCode);
  if (!key) return null;

  for (const drug of Array.isArray(drugs) ? drugs : []) {
    if (normalizeKey(drug?.drug_code) === key) {
      return drug;
    }
  }

  return null;
}

export function findDrugByIdentifier(identifier, drugCodeMap, drugs = []) {
  return findDrugByCode(identifier, drugCodeMap, drugs);
}

export function getMasterAutofill(drug, lookupValue = "") {
  const resolvedDrugName =
    normalizeText(drug?.drug_name) ||
    normalizeText(drug?.brand_name) ||
    normalizeText(drug?.generic_name) ||
    normalizeText(lookupValue);

  const pharmacyUnit = Number(drug?.pharmacy_unit_price ?? drug?.unit_price_pharmacy ?? 0);
  const publicUnit = Number(drug?.public_unit_price ?? drug?.unit_price_public ?? 0);

  return {
    drug_name: resolvedDrugName,
    brand_name: normalizeText(drug?.brand_name),
    generic_name: normalizeText(drug?.generic_name),
    barcode: normalizeText(drug?.barcode),
    unit: normalizeText(drug?.base_unit || drug?.unit || "Unit"),
    unit_cost: Number.isFinite(pharmacyUnit) ? pharmacyUnit : 0,
    sales_price: Number.isFinite(publicUnit) ? publicUnit : 0,
  };
}

export function parseCsvText(text) {
  const parsed = Papa.parse(String(text || ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeKey(header),
  });

  const headers = (parsed.meta?.fields || []).map((header) => normalizeKey(header));
  const rows = (parsed.data || []).map((row) => {
    const normalized = {};
    for (const key of headers) {
      normalized[key] = normalizeText(row?.[key]);
    }
    return normalized;
  });

  return { rows, headers };
}
