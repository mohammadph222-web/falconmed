/**
 * drugPricing.js
 * Parses the same /dru_gmaster.csv used by DrugSearch and provides a
 * normalized drug-name → unit price lookup for Financial Intelligence.
 * No second CSV is added — this imports the identical source file.
 */
import drugsMasterCsv from "../../public/dru_gmaster.csv?raw";

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

// ─── normalize drug names for lookup ─────────────────────────────────────────

function normalizeDrugText(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,;:()\[\]{}]+/g, " ")
    .replace(/[+]/g, " ")
    .replace(/[\\/]+/g, " ")
    .replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\s*(ml|l)\b/g, "$1 $2 $3")
    .replace(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu)\b/g, "$1 $2")
    .replace(/tablets?\b/g, "tablet")
    .replace(/capsules?\b/g, "capsule")
    .replace(/ampoules?\b/g, "ampoule")
    .replace(/vials?\b/g, "vial")
    .replace(/\s+/g, " ")
    .trim();
}

function strengthTokens(text) {
  const value = normalizeDrugText(text);
  const tokens = [];

  const combined = value.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu)\s*(?:ml|l)\b/g) || [];
  for (const token of combined) {
    tokens.push(token.replace(/\s+/g, " ").trim());
  }

  const single = value.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu)\b/g) || [];
  for (const token of single) {
    const normalized = token.replace(/\s+/g, " ").trim();
    if (!tokens.includes(normalized)) {
      tokens.push(normalized);
    }
  }

  return tokens;
}

const STOP_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "without",
  "plus",
  "combination",
  "tablet",
  "capsule",
  "ampoule",
  "vial",
]);

function significantTokens(text) {
  return normalizeDrugText(text)
    .split(" ")
    .filter((token) => {
      if (!token) return false;
      if (STOP_TOKENS.has(token)) return false;
      if (/\d/.test(token)) return true;
      return token.length >= 4;
    });
}

function tokenOverlapScore(queryTokens, candidateTokens) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return { overlap: 0, ratio: 0 };
  }

  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;

  for (const token of querySet) {
    if (candidateSet.has(token)) overlap += 1;
  }

  return {
    overlap,
    ratio: overlap / Math.max(1, querySet.size),
  };
}

function hasAnyStrengthMatch(queryStrength, candidateText) {
  if (!queryStrength || queryStrength.length === 0) return true;
  const text = normalizeDrugText(candidateText);
  return queryStrength.some((token) => text.includes(token));
}

// ─── module-level cache so the CSV is only parsed once ───────────────────────

let cachedPriceMap = null;
let cachedPricingEntries = null;
let cachedBrandPackageMap = null;
let cachedGenericMap = null;

function ensurePricingCache() {
  if (cachedPriceMap && cachedPricingEntries && cachedBrandPackageMap && cachedGenericMap) {
    return;
  }

  const priceMap = new Map();
  const entries = [];
  const brandPackageMap = new Map();
  const genericMap = new Map();

  try {
    const text = String(drugsMasterCsv || "");
    if (!text.trim()) {
      cachedPriceMap = priceMap;
      cachedPricingEntries = entries;
      cachedBrandPackageMap = brandPackageMap;
      cachedGenericMap = genericMap;
      return;
    }

    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      cachedPriceMap = priceMap;
      cachedPricingEntries = entries;
      cachedBrandPackageMap = brandPackageMap;
      cachedGenericMap = genericMap;
      return;
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

      const entry = {
        pharmacyUnitPrice,
        publicUnitPrice,
        brand: getVal(row, ["brand", "brandname"]),
        packageName: getVal(row, ["packagename", "tradename"]),
        generic: getVal(row, ["generic", "genericname", "scientificname"]),
        strength: getVal(row, ["strength"]),
      };

      const brandNorm = normalizeDrugText(entry.brand);
      const packageNorm = normalizeDrugText(entry.packageName);
      const genericNorm = normalizeDrugText(entry.generic);
      const strengthNorm = normalizeDrugText(entry.strength);

      const entrySearchText = [brandNorm, packageNorm, genericNorm, strengthNorm]
        .filter(Boolean)
        .join(" ")
        .trim();

      const enrichedEntry = {
        ...entry,
        brandNorm,
        packageNorm,
        genericNorm,
        strengthNorm,
        searchText: entrySearchText,
        tokens: significantTokens(entrySearchText),
      };

      entries.push(enrichedEntry);

      const value = {
        pharmacyUnitPrice: enrichedEntry.pharmacyUnitPrice,
        publicUnitPrice: enrichedEntry.publicUnitPrice,
      };

      if (brandNorm && !priceMap.has(brandNorm)) priceMap.set(brandNorm, value);
      if (packageNorm && !priceMap.has(packageNorm)) priceMap.set(packageNorm, value);
      if (genericNorm && !priceMap.has(genericNorm)) priceMap.set(genericNorm, value);

      if (brandNorm && !brandPackageMap.has(brandNorm)) {
        brandPackageMap.set(brandNorm, enrichedEntry);
      }
      if (packageNorm && !brandPackageMap.has(packageNorm)) {
        brandPackageMap.set(packageNorm, enrichedEntry);
      }
      if (genericNorm && !genericMap.has(genericNorm)) {
        genericMap.set(genericNorm, enrichedEntry);
      }
    }
  } catch {
    // Silent fail — financial KPIs will simply show AED 0
  }

  cachedPriceMap = priceMap;
  cachedPricingEntries = entries;
  cachedBrandPackageMap = brandPackageMap;
  cachedGenericMap = genericMap;
}

/**
 * Build (and cache) a Map of normalized drug name → { pharmacyUnitPrice, publicUnitPrice }.
 * Both brand/package and generic names are indexed.
 * If a drug appears more than once the first entry wins.
 */
export function buildDrugPriceMap() {
  ensurePricingCache();
  return cachedPriceMap || new Map();
}

/**
 * Conservative tiered match:
 * 1) exact brand/package/trade name
 * 2) exact generic name
 * 3) startsWith / includes fallback with token overlap guard
 * 4) strength-aware preference
 * 5) null if confidence is weak
 */
export function resolveDrugPricing(drugName) {
  ensurePricingCache();

  const normalizedQuery = normalizeDrugText(drugName);
  if (!normalizedQuery) return null;

  const brandExact = cachedBrandPackageMap?.get(normalizedQuery);
  if (brandExact) {
    return {
      pharmacyUnitPrice: brandExact.pharmacyUnitPrice,
      publicUnitPrice: brandExact.publicUnitPrice,
    };
  }

  const genericExact = cachedGenericMap?.get(normalizedQuery);
  if (genericExact) {
    return {
      pharmacyUnitPrice: genericExact.pharmacyUnitPrice,
      publicUnitPrice: genericExact.publicUnitPrice,
    };
  }

  const queryTokens = significantTokens(normalizedQuery);
  const queryStrengthTokens = strengthTokens(normalizedQuery);
  if (queryTokens.length === 0) return null;

  let best = null;

  for (const entry of cachedPricingEntries || []) {
    const candidates = [
      { text: entry.brandNorm, weight: 20 },
      { text: entry.packageNorm, weight: 18 },
      { text: entry.genericNorm, weight: 10 },
      { text: entry.searchText, weight: 8 },
    ].filter((c) => c.text);

    let bestCandidateScore = -Infinity;

    for (const candidate of candidates) {
      let score = candidate.weight;

      const startsWithMatch =
        candidate.text.startsWith(normalizedQuery) ||
        normalizedQuery.startsWith(candidate.text);

      const includesMatch =
        candidate.text.includes(normalizedQuery) ||
        normalizedQuery.includes(candidate.text);

      if (startsWithMatch) score += 20;
      else if (includesMatch) score += 10;

      const overlapInfo = tokenOverlapScore(queryTokens, significantTokens(candidate.text));
      score += overlapInfo.ratio * 40;

      // Conservative guard to avoid false positives from short overlaps.
      if (overlapInfo.overlap < 2 && !startsWithMatch) {
        score -= 30;
      }

      if (queryStrengthTokens.length > 0) {
        if (hasAnyStrengthMatch(queryStrengthTokens, candidate.text)) {
          score += 12;
        } else {
          score -= 10;
        }
      }

      if (score > bestCandidateScore) bestCandidateScore = score;
    }

    if (bestCandidateScore >= 45 && (!best || bestCandidateScore > best.score)) {
      best = {
        entry,
        score: bestCandidateScore,
      };
    }
  }

  if (!best) return null;

  return {
    pharmacyUnitPrice: best.entry.pharmacyUnitPrice,
    publicUnitPrice: best.entry.publicUnitPrice,
  };
}

export function resolvePharmacyUnitPrice(drugName) {
  return resolveDrugPricing(drugName)?.pharmacyUnitPrice ?? null;
}
