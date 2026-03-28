import drugsMasterCsv from "../data/drugs_master.csv?raw";
import { supabase } from "../lib/supabaseClient";

const DRUG_MASTER_COLUMNS = [
  "drug_code",
  "brand_name",
  "generic_name",
  "strength",
  "dosage_form",
  "package_size",
  "dispense_mode",
  "public_price",
  "pharmacy_price",
  "agent_name",
  "manufacturer_name",
  "upp_scope",
  "included_thiqa_abm",
  "included_basic",
].join(",");

let cachedDrugs = null;
let loadPromise = null;

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
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

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\ufeff/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export function parseDrugPrice(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getDrugDisplayName(drug) {
  const primary = cleanText(drug?.brand_name || drug?.generic_name);
  const strength = cleanText(drug?.strength);
  return [primary, strength].filter(Boolean).join(" ");
}

export function normalizeDrugMasterRecord(rawRow) {
  const row = rawRow || {};
  const normalized = {
    drug_code: cleanText(getValue(row, ["drug_code", "drugcode", "code", "id"])),
    brand_name: cleanText(
      getValue(row, ["brand_name", "brandname", "brand_Name", "brand", "packagename", "tradename"])
    ),
    generic_name: cleanText(
      getValue(row, ["generic_name", "genericname", "Generic_Name", "generic", "scientificname"])
    ),
    strength: cleanText(getValue(row, ["strength"])),
    dosage_form: cleanText(getValue(row, ["dosage_form", "dosageform", "dosage", "form"])),
    package_size: cleanText(getValue(row, ["package_size", "packagesize"])),
    dispense_mode: cleanText(getValue(row, ["dispense_mode", "dispensemode"])),
    public_price: cleanText(getValue(row, ["public_price", "publicprice", "price_public", "price"])),
    pharmacy_price: cleanText(getValue(row, ["pharmacy_price", "pharmacyprice", "price_pharmacy"])),
    agent_name: cleanText(getValue(row, ["agent_name", "agentname"])),
    manufacturer_name: cleanText(getValue(row, ["manufacturer_name", "manufacturername"])),
    upp_scope: cleanText(getValue(row, ["upp_scope", "uppscope"])),
    included_thiqa_abm: cleanText(
      getValue(row, [
        "included_thiqa_abm",
        "included_in_thiqa_abm_other_than_1_7_drug_formulary",
      ])
    ),
    included_basic: cleanText(getValue(row, ["included_basic", "includedbasic"])),
  };

  return {
    ...normalized,
    display_name: getDrugDisplayName(normalized),
  };
}

function dedupeDrugs(rows) {
  const unique = new Map();

  rows.forEach((row) => {
    const normalized = normalizeDrugMasterRecord(row);
    if (!normalized.brand_name && !normalized.generic_name) {
      return;
    }

    const key =
      normalized.drug_code ||
      [normalized.brand_name, normalized.generic_name, normalized.strength, normalized.dosage_form]
        .map((value) => value.toLowerCase())
        .join("::");

    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  });

  return Array.from(unique.values()).sort((left, right) =>
    getDrugDisplayName(left).localeCompare(getDrugDisplayName(right))
  );
}

function parseCsvDrugMaster() {
  const text = String(drugsMasterCsv || "");
  if (!text.trim()) return [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map((header) => normalizeHeader(header));

  const rows = lines.slice(1).map((line) => {
    const cols = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });
    return row;
  });

  return dedupeDrugs(rows);
}

async function fetchSupabaseDrugMaster() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase.from("drug_master").select(DRUG_MASTER_COLUMNS).limit(30000);
    if (error) return [];
    return dedupeDrugs(data || []);
  } catch {
    return [];
  }
}

export async function loadDrugMaster() {
  if (cachedDrugs) {
    return cachedDrugs;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const supabaseRows = await fetchSupabaseDrugMaster();
      cachedDrugs = supabaseRows.length > 0 ? supabaseRows : parseCsvDrugMaster();
      return cachedDrugs;
    })();
  }

  return loadPromise;
}

export function searchDrugMaster(drugs, query, limit = 25) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (normalizedQuery.length < 2) {
    return [];
  }

  return (drugs || [])
    .filter((drug) => {
      const brand = cleanText(drug.brand_name).toLowerCase();
      const generic = cleanText(drug.generic_name).toLowerCase();
      return brand.includes(normalizedQuery) || generic.includes(normalizedQuery);
    })
    .slice(0, limit);
}

export function getDrugUnitPrice(drug, preferredField = "public") {
  const preferred = preferredField === "pharmacy"
    ? [drug?.pharmacy_price, drug?.public_price]
    : [drug?.public_price, drug?.pharmacy_price];

  for (const candidate of preferred) {
    const parsed = parseDrugPrice(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}