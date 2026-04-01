import { getDrugDisplayName, getDrugUnitPrice } from "./drugMaster";

function normalizeDrugCode(value) {
  return String(value || "").trim().toUpperCase();
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\ufeff/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveBarcode(drug) {
  return String(
    drug?.barcode || drug?.barcode_no || drug?.bar_code || drug?.ean || ""
  ).trim();
}

export function buildDrugCodeMap(drugs = []) {
  const map = new Map();

  (drugs || []).forEach((drug) => {
    const code = normalizeDrugCode(drug?.drug_code);
    if (!code) return;
    if (!map.has(code)) map.set(code, drug);
  });

  return map;
}

export function findDrugByCode(drugCode, codeMap) {
  const code = normalizeDrugCode(drugCode);
  if (!code) return null;
  return codeMap?.get(code) || null;
}

export function getMasterAutofill(drug, fallbackCode = "") {
  if (!drug) {
    return {
      drug_code: normalizeDrugCode(fallbackCode),
      drug_name: "",
      brand_name: "",
      generic_name: "",
      barcode: "",
      unit_cost: "",
    };
  }

  const unitCost = getDrugUnitPrice(drug, "pharmacy");
  const brand = String(drug.brand_name || "").trim();
  const generic = String(drug.generic_name || "").trim();

  return {
    drug_code: normalizeDrugCode(drug.drug_code || fallbackCode),
    drug_name: getDrugDisplayName(drug),
    brand_name: brand,
    generic_name: generic,
    barcode: resolveBarcode(drug),
    unit_cost: unitCost != null ? String(unitCost) : "",
  };
}

export function parseCsvText(csvText = "") {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    return { rows: [], headers: [] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);

  const rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });
    return row;
  });

  return { rows, headers };
}
