import Papa from "papaparse";

const DRUG_MASTER_CSV_PATH = "/dru_gmaster.csv";

let drugMasterCache = null;
let loadingPromise = null;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePackSize(rawValue) {
  const raw = normalizeText(rawValue);
  if (!raw) return 1;

  const text = raw
    .replace(/â€™/g, "'")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Highest priority: outer final count at the start, e.g. 14's (7's Blister x 2) => 14
  const leadingOuterApostrophe = text.match(/^(\d+(?:\.\d+)?)\s*'s\b/i);
  if (leadingOuterApostrophe) {
    return Math.max(Math.round(parseNumber(leadingOuterApostrophe[1])), 1);
  }

  // 30's (10's Blister x 3) => 30
  const nestedApostropheX = text.match(/(\d+(?:\.\d+)?)\s*'s.*?\bx\s*(\d+(?:\.\d+)?)/i);
  if (nestedApostropheX) {
    return Math.max(
      Math.round(parseNumber(nestedApostropheX[1]) * parseNumber(nestedApostropheX[2])),
      1
    );
  }

  // 10's Blister x 3 => 30
  const blisterPattern = text.match(/(\d+(?:\.\d+)?)\s*'s\s*blister\s*x\s*(\d+(?:\.\d+)?)/i);
  if (blisterPattern) {
    return Math.max(
      Math.round(parseNumber(blisterPattern[1]) * parseNumber(blisterPattern[2])),
      1
    );
  }

  // 10*3 / 10 x 3 / 5*4 nebules => 30 / 20
  const multiplierPattern = text.match(/(\d+(?:\.\d+)?)\s*[*x]\s*(\d+(?:\.\d+)?)/i);
  if (multiplierPattern) {
    return Math.max(
      Math.round(parseNumber(multiplierPattern[1]) * parseNumber(multiplierPattern[2])),
      1
    );
  }

  // x 50 => 50   e.g. 2ml Vial x 50
  const trailingMultiplier = text.match(/\bx\s*(\d+(?:\.\d+)?)/i);
  if (trailingMultiplier) {
    return Math.max(Math.round(parseNumber(trailingMultiplier[1])), 1);
  }

  // 10's / 12's / 30's
  const apostrophePattern = text.match(/(\d+(?:\.\d+)?)\s*'s/i);
  if (apostrophePattern) {
    return Math.max(Math.round(parseNumber(apostrophePattern[1])), 1);
  }

  // x 1 unit => 1
  const unitPattern = text.match(/(\d+(?:\.\d+)?)\s*unit(s)?\b/i);
  if (unitPattern) {
    return Math.max(Math.round(parseNumber(unitPattern[1])), 1);
  }

  // Single containers => 1
  if (/(vial|bottle|tube|ampoule|ampule|nebule|syringe|jar|can)/i.test(text)) {
    return 1;
  }

  return 1;
}

function getPublicPackPrice(row) {
  return parseNumber(
    row?.public_price ||
    row?.price_to_public ||
    row?.retail_price ||
    row?.selling_price ||
    row?.cash_price ||
    row?.pack_price
  );
}

function getPharmacyPackPrice(row) {
  return parseNumber(
    row?.pharmacy_price ||
    row?.pack_cost ||
    row?.cost_price
  );
}

function getExplicitPublicUnitPrice(row) {
  return parseNumber(
    row?.unit_price_public ||
    row?.public_unit_price ||
    row?.price_per_unit_public
  );
}

function getExplicitPharmacyUnitPrice(row) {
  return parseNumber(
    row?.unit_Price_Pharmacy ||
    row?.unit_price_pharmacy ||
    row?.pharmacy_unit_price ||
    row?.price_per_unit_pharmacy
  );
}

function normalizeDrugRow(row, index) {
  const packageSizeRaw = normalizeText(row?.package_size);
  const normalizedPackSize = normalizePackSize(packageSizeRaw);

  let publicPackPrice = getPublicPackPrice(row);
  let pharmacyPackPrice = getPharmacyPackPrice(row);

  let publicUnitPrice = getExplicitPublicUnitPrice(row);
  let pharmacyUnitPrice = getExplicitPharmacyUnitPrice(row);

  // If pack price exists, derive unit price from it
  if (publicPackPrice > 0 && normalizedPackSize > 0) {
    publicUnitPrice = Number((publicPackPrice / normalizedPackSize).toFixed(4));
  }
  if (pharmacyPackPrice > 0 && normalizedPackSize > 0) {
    pharmacyUnitPrice = Number((pharmacyPackPrice / normalizedPackSize).toFixed(4));
  }

  // If pack price missing but explicit unit price exists, derive pack price
  if (publicPackPrice <= 0 && publicUnitPrice > 0 && normalizedPackSize > 0) {
    publicPackPrice = Number((publicUnitPrice * normalizedPackSize).toFixed(4));
  }
  if (pharmacyPackPrice <= 0 && pharmacyUnitPrice > 0 && normalizedPackSize > 0) {
    pharmacyPackPrice = Number((pharmacyUnitPrice * normalizedPackSize).toFixed(4));
  }

  const brandName = normalizeText(row?.brand_name);
  const genericName = normalizeText(row?.generic_name);
  const strength = normalizeText(row?.strength);

  const searchIndex = [
    normalizeText(row?.drug_code),
    brandName,
    genericName,
    normalizeText(row?.drug_name),
    strength,
    normalizeText(row?.dosage_form),
    normalizeText(row?.barcode),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    id: normalizeText(row?.drug_code) || `drug-${index + 1}`,
    brand_name: brandName,
    generic_name: genericName,
    strength,
    dosage_form: normalizeText(row?.dosage_form),
    package_size_raw: packageSizeRaw,
    normalized_pack_size: normalizedPackSize,
    public_pack_price: publicPackPrice,
    pharmacy_pack_price: pharmacyPackPrice,
    public_unit_price: publicUnitPrice,
    pharmacy_unit_price: pharmacyUnitPrice,

    // Compatibility fields used by existing modules
    drug_code: normalizeText(row?.drug_code),
    drug_name: brandName || genericName,
    package_size: packageSizeRaw,
    public_price: publicPackPrice,
    pharmacy_price: pharmacyPackPrice,
    unit_price_public: publicUnitPrice,
    unit_price_pharmacy: pharmacyUnitPrice,
    display_name: [brandName || genericName, strength].filter(Boolean).join(" "),
    search_index: searchIndex,
  };
}

function parseCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => normalizeText(header),
  });

  if (parsed.errors?.length) {
    const fatal = parsed.errors.find((err) => err.code !== "TooFewFields");
    if (fatal) {
      throw new Error(`Drug master CSV parse failed: ${fatal.message}`);
    }
  }

  return (parsed.data || []).map((row, index) => normalizeDrugRow(row, index));
}

export async function loadDrugMaster(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(drugMasterCache)) {
    return drugMasterCache;
  }

  if (!forceRefresh && loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = fetch(DRUG_MASTER_CSV_PATH)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${DRUG_MASTER_CSV_PATH}: HTTP ${response.status}`);
      }
      return response.text();
    })
    .then((csvText) => {
      const rows = parseCsv(csvText);
      drugMasterCache = rows;
      return rows;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

export function getDrugDisplayName(drug) {
  const primary = normalizeText(drug?.brand_name || drug?.drug_name || drug?.generic_name);
  const strength = normalizeText(drug?.strength);
  return [primary, strength].filter(Boolean).join(" ");
}

export function searchDrugMaster(drugs, query, limit = 25) {
  const q = normalizeText(query).toLowerCase();
  if (!q) return (Array.isArray(drugs) ? drugs : []).slice(0, limit);

  return (Array.isArray(drugs) ? drugs : [])
    .filter((drug) => {
      if (drug?.search_index) {
        return drug.search_index.includes(q);
      }

      // Backward compatibility if cached rows were created before search_index existed.
      const fields = [
        drug?.drug_code,
        drug?.brand_name,
        drug?.generic_name,
        drug?.drug_name,
        drug?.strength,
        drug?.dosage_form,
      ];
      return fields.some((field) => normalizeText(field).toLowerCase().includes(q));
    })
    .slice(0, limit);
}

export function getDrugUnitPrice(drug, scope = "public") {
  if (!drug) return null;

  if (scope === "pharmacy") {
    return parseNumber(drug.pharmacy_unit_price || drug.unit_price_pharmacy);
  }

  return parseNumber(drug.public_unit_price || drug.unit_price_public);
}

export function clearDrugMasterCache() {
  drugMasterCache = null;
}