/**
 * drugPricing.js
 * Parses the same drugs_master.csv used by DrugSearch and provides a
 * normalized drug-name → unit price lookup Map for Financial Intelligence.
 * No second CSV is added — this imports the identical source file.
 */
import drugsMasterCsv from "../data/drugs_master.csv?raw";

// ─── lightweight CSV parser (mirrors DrugSearch.jsx logic) ───────────────────

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeCSVKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[\s/_-]+/g, "")
    .trim();
}

function getVal(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function parseNum(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return null;
  const normalized = text.replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function extractUnits(packageSize) {
  const text = String(packageSize ?? "").trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return 1;
  const units = Number(match[0]);
  return Number.isFinite(units) && units > 0 ? units : 1;
}

// ─── normalize a drug name for lookup (matches pdss.js normalizeDrugName) ────

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── module-level cache so the CSV is only parsed once ───────────────────────

let cachedPriceMap = null;

/**
 * Build (and cache) a Map of normalized drug name → { pharmacyUnitPrice, publicUnitPrice }.
 * Both brand name and generic name are indexed so PDSS drug names have the
 * best chance of matching. Entries where no price is found are skipped.
 * If a drug appears more than once the first entry wins.
 */
export function buildDrugPriceMap() {
  if (cachedPriceMap) return cachedPriceMap;

  const map = new Map();

  try {
    const text = String(drugsMasterCsv || "");
    if (!text.trim()) {
      cachedPriceMap = map;
      return map;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      cachedPriceMap = map;
      return map;
    }

    const rawHeaders = parseCSVLine(lines[0]);
    const headers = rawHeaders.map((h) => normalizeCSVKey(h));

    for (const line of lines.slice(1)) {
      const cols = parseCSVLine(line);
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cols[i] ?? "";
      });

      const packageSize = getVal(row, ["packagesize", "packsize", "packqty"]);
      const pharmacyPrice = getVal(row, [
        "pharmacyprice",
        "pricetopharmacy",
        "packagepricetopharmacy",
        "packpricetopharmacy",
      ]);
      const publicPrice = getVal(row, [
        "publicprice",
        "pricetopublic",
        "packagepricetopublic",
        "packpricetopublic",
      ]);

      const packageUnits = extractUnits(packageSize);
      const pharmacyPriceNum = parseNum(pharmacyPrice);
      const publicPriceNum = parseNum(publicPrice);

      const pharmacyUnitPrice =
        pharmacyPriceNum !== null ? pharmacyPriceNum / packageUnits : null;
      const publicUnitPrice =
        publicPriceNum !== null ? publicPriceNum / packageUnits : null;

      if (pharmacyUnitPrice === null && publicUnitPrice === null) continue;

      const entry = { pharmacyUnitPrice, publicUnitPrice };

      // Index by brand name
      const brand = getVal(row, ["brand", "brandname", "packagename", "tradename"]);
      if (brand) {
        const key = normName(brand);
        if (key && !map.has(key)) map.set(key, entry);
      }

      // Index by generic name
      const generic = getVal(row, ["generic", "genericname", "scientificname"]);
      if (generic) {
        const key = normName(generic);
        if (key && !map.has(key)) map.set(key, entry);
      }
    }
  } catch {
    // Silent fail — financial KPIs will simply show AED 0
  }

  cachedPriceMap = map;
  return map;
}
