import { supabase } from "../lib/supabaseClient";

const NEAR_EXPIRY_DAYS = 180;
const DEFAULT_PAGE_SIZE = 1000;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getTodayStart() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function buildNearExpiryWindow(days = NEAR_EXPIRY_DAYS) {
  const today = getTodayStart();
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  return { today, limit };
}

export function isNearExpiry(expiryDateValue, days = NEAR_EXPIRY_DAYS) {
  const date = toDate(expiryDateValue);
  if (!date) return false;

  const { today, limit } = buildNearExpiryWindow(days);
  return date >= today && date <= limit;
}

export function computeInventoryAggregates(inventoryRows = [], days = NEAR_EXPIRY_DAYS) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const { today, limit } = buildNearExpiryWindow(days);

  const activeSites = new Set();
  const byPharmacyId = {};

  let totalQty = 0;
  let stockValue = 0;
  let nearExpiryItems = 0;
  let nearExpiryStockValue = 0;
  let expiredStockValue = 0;

  for (const row of rows) {
    const pharmacyId = String(row?.pharmacy_id || "").trim();
    if (!pharmacyId) continue;

    activeSites.add(pharmacyId);

    if (!byPharmacyId[pharmacyId]) {
      byPharmacyId[pharmacyId] = {
        pharmacyId,
        inventoryRecords: 0,
        totalQty: 0,
        stockValue: 0,
        nearExpiryItems: 0,
      };
    }

    const qty = Math.max(0, toNumber(row?.quantity, 0));
    const unitCost = Math.max(0, toNumber(row?.unit_cost, 0));
    const lineValue = qty * unitCost;

    totalQty += qty;
    stockValue += lineValue;

    byPharmacyId[pharmacyId].inventoryRecords += 1;
    byPharmacyId[pharmacyId].totalQty += qty;
    byPharmacyId[pharmacyId].stockValue += lineValue;

    const expiryDate = toDate(row?.expiry_date);
    if (!expiryDate) continue;

    if (expiryDate >= today && expiryDate <= limit) {
      nearExpiryItems += 1;
      nearExpiryStockValue += lineValue;
      byPharmacyId[pharmacyId].nearExpiryItems += 1;
    }

    if (expiryDate < today) {
      expiredStockValue += lineValue;
    }
  }

  return {
    nearExpiryDays: days,
    inventoryRecords: rows.length,
    activeSites: activeSites.size,
    totalQty,
    stockValue,
    nearExpiryItems,
    nearExpiryStockValue,
    expiredStockValue,
    byPharmacyId,
  };
}

export async function fetchAllRows(
  table,
  columns = "*",
  { orderBy, ascending = true, pageSize = DEFAULT_PAGE_SIZE, includeCount = true } = {}
) {
  if (!supabase) {
    return { data: [], error: null };
  }

  const rows = [];
  let from = 0;
  let expectedTotal = null;
  let previousPageSignature = "";
  let repeatedPageCount = 0;

  if (includeCount) {
    try {
      const { count, error: countError } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (!countError && Number.isFinite(count)) {
        expectedTotal = count;
        if (count === 0) {
          return { data: [], error: null };
        }
      }
    } catch {
      // Count is an optimization/safety guard only.
    }
  }

  let pageGuard = 0;

  while (true) {
    pageGuard += 1;
    if (pageGuard > 500) {
      return {
        data: rows,
        error: new Error(`Paged fetch aborted for ${table}: exceeded safe page limit.`),
      };
    }

    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }

    const { data, error } = await query;
    if (error) {
      return { data: rows, error };
    }

    const page = data || [];
    if (page.length === 0) {
      break;
    }

    // Guard: if a backend row-limit policy ignores range, the same page can repeat forever.
    const firstRow = page[0] || {};
    const lastRow = page[page.length - 1] || {};
    const pageSignature = `${page.length}::${String(firstRow.id || "")}::${String(lastRow.id || "")}`;

    if (pageSignature === previousPageSignature) {
      repeatedPageCount += 1;
      if (repeatedPageCount >= 2) {
        return {
          data: rows,
          error: new Error(
            `Paged fetch aborted for ${table}: repeated page detected (range likely not advancing).`
          ),
        };
      }
    } else {
      repeatedPageCount = 0;
      previousPageSignature = pageSignature;
    }

    rows.push(...page);

    if (expectedTotal != null && rows.length >= expectedTotal) {
      break;
    }

    if (page.length < pageSize) {
      break;
    }

    from += page.length;
  }

  return { data: rows, error: null };
}

const qtyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatQty(value) {
  return qtyFormatter.format(toNumber(value, 0));
}

export function formatAed(value) {
  return `AED ${moneyFormatter.format(toNumber(value, 0))}`;
}

export function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

export function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

export function calculateLineValue(quantity, unitCost) {
  return roundMoney(Number(quantity || 0) * Number(unitCost || 0));
}

export function resolveSalesPrice(item) {
  return Number(item?.sales_price ?? item?.price_to_public ?? 0);
}

export function resolveCostPrice(item) {
  return Number(item?.cost_price ?? item?.unit_cost ?? 0);
}

export function resolveCostValue(item) {
  const rawCostValue = Number(item?.cost_value ?? item?.line_value);
  if (Number.isFinite(rawCostValue)) {
    return roundMoney(rawCostValue);
  }
  return calculateLineValue(item?.quantity, resolveCostPrice(item));
}

export function resolveSalesValue(item) {
  const rawSalesValue = Number(item?.sales_value);
  if (Number.isFinite(rawSalesValue)) {
    return roundMoney(rawSalesValue);
  }
  return calculateLineValue(item?.quantity, resolveSalesPrice(item));
}

export function resolveMarginValue(item) {
  const rawMarginValue = Number(item?.margin_value);
  if (Number.isFinite(rawMarginValue)) {
    return roundMoney(rawMarginValue);
  }
  return roundMoney(resolveSalesValue(item) - resolveCostValue(item));
}

export function getInventoryTotals(inventory = []) {
  const rows = Array.isArray(inventory) ? inventory : [];

  const totalItems = rows.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalValue = rows.reduce((sum, item) => sum + resolveCostValue(item), 0);
  const totalSalesValue = rows.reduce((sum, item) => sum + resolveSalesValue(item), 0);
  const potentialMargin = roundMoney(rows.reduce((sum, item) => sum + resolveMarginValue(item), 0));

  return {
    totalItems,
    totalValue,
    totalSalesValue,
    potentialMargin,
  };
}

export function getLowStockRows(inventory = [], threshold = 10) {
  const rows = Array.isArray(inventory) ? inventory : [];
  return rows.filter(
    (item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= threshold
  );
}

export function getInventoryInsight({ inventory = [], loading = false }) {
  const rows = Array.isArray(inventory) ? inventory : [];
  if (loading || rows.length === 0) return null;

  const lowStockRows = getLowStockRows(rows, 10);
  if (lowStockRows.length === 0) return null;

  const topLow = [...lowStockRows].sort(
    (a, b) => Number(a.quantity || 0) - Number(b.quantity || 0)
  )[0];

  return {
    icon: "▾",
    tone: "warning",
    title: "Smart Insight: Low Stock Warning",
    message: `${lowStockRows.length} SKU${lowStockRows.length === 1 ? "" : "s"} are at or below 10 units. Lowest stock: ${topLow?.drug_name || "Unknown"} (${Number(
      topLow?.quantity || 0
    )} units).`,
  };
}

export function getInventoryIntelligence({ inventory = [], loading = false }) {
  const rows = Array.isArray(inventory) ? inventory : [];

  if (loading || rows.length === 0) {
    return {
      lowStockCount: 0,
      nearExpiryCount: 0,
      valueAtRisk: 0,
      highestRiskItem: null,
    };
  }

  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 180);

  const lowStockItems = getLowStockRows(rows, 10);

  const nearExpiryItems = rows.filter((item) => {
    if (!item.expiry_date) return false;
    try {
      const expiryDate = new Date(item.expiry_date);
      return expiryDate <= futureDate && expiryDate >= today;
    } catch {
      return false;
    }
  });

  const valueAtRisk = nearExpiryItems.reduce(
    (sum, item) => sum + resolveCostValue(item),
    0
  );

  let highestRiskItem = null;
  if (nearExpiryItems.length > 0) {
    let maxRiskValue = 0;
    nearExpiryItems.forEach((item) => {
      const riskValue = resolveCostValue(item);
      if (riskValue > maxRiskValue) {
        maxRiskValue = riskValue;
        highestRiskItem = {
          drugName: item.drug_name || "Unknown",
          riskValue,
          expiryDate: item.expiry_date,
        };
      }
    });
  }

  return {
    lowStockCount: lowStockItems.length,
    nearExpiryCount: nearExpiryItems.length,
    valueAtRisk,
    highestRiskItem,
  };
}

export function getExpiryRiskItems({ inventory = [], loading = false }) {
  const rows = Array.isArray(inventory) ? inventory : [];
  if (loading || rows.length === 0) return [];

  const today = new Date();
  const riskLevelOrder = { Critical: 0, "High Risk": 1, "Medium Risk": 2 };

  const results = [];
  rows.forEach((item) => {
    if (!item.expiry_date) return;
    let expiryDate;
    try {
      expiryDate = new Date(item.expiry_date);
      if (Number.isNaN(expiryDate.getTime())) return;
    } catch {
      return;
    }

    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    let riskLevel = null;
    if (daysUntilExpiry <= 30) riskLevel = "Critical";
    else if (daysUntilExpiry <= 90) riskLevel = "High Risk";
    else if (daysUntilExpiry <= 180) riskLevel = "Medium Risk";
    if (!riskLevel) return;

    results.push({
      ...item,
      daysUntilExpiry,
      riskLevel,
      riskValue: calculateLineValue(item.quantity, item.unit_cost),
    });
  });

  results.sort((a, b) => {
    const levelDiff = riskLevelOrder[a.riskLevel] - riskLevelOrder[b.riskLevel];
    if (levelDiff !== 0) return levelDiff;
    return b.riskValue - a.riskValue;
  });

  return results;
}

export function getInventoryHealthScore({ inventory = [], loading = false }) {
  const rows = Array.isArray(inventory) ? inventory : [];

  if (loading || rows.length === 0) {
    return {
      score: 100,
      status: "Excellent",
      lowStockCount: 0,
      nearExpiryCount: 0,
      criticalExpiryCount: 0,
      valueAtRisk: 0,
    };
  }

  const today = new Date();
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in180 = new Date();
  in180.setDate(in180.getDate() + 180);

  let lowStockCount = 0;
  let nearExpiryCount = 0;
  let criticalExpiryCount = 0;
  let valueAtRisk = 0;

  rows.forEach((item) => {
    const qty = Number(item.quantity || 0);
    if (qty > 0 && qty <= 10) lowStockCount += 1;
    if (item.expiry_date) {
      try {
        const expDate = new Date(item.expiry_date);
        if (!Number.isNaN(expDate.getTime())) {
          if (expDate >= today && expDate <= in30) {
            criticalExpiryCount += 1;
            valueAtRisk += resolveCostValue(item);
          } else if (expDate > in30 && expDate <= in180) {
            nearExpiryCount += 1;
            valueAtRisk += resolveCostValue(item);
          }
        }
      } catch {
        // Skip invalid dates.
      }
    }
  });

  let score = 100;
  score -= lowStockCount * 2;
  score -= nearExpiryCount * 3;
  score -= criticalExpiryCount * 5;
  if (valueAtRisk >= 20000) score -= 15;
  else if (valueAtRisk >= 5000) score -= 10;
  else if (valueAtRisk > 0) score -= 5;
  score = Math.max(0, Math.min(100, score));

  let status = "Critical";
  if (score >= 90) status = "Excellent";
  else if (score >= 75) status = "Good";
  else if (score >= 50) status = "Needs Attention";

  return {
    score,
    status,
    lowStockCount,
    nearExpiryCount,
    criticalExpiryCount,
    valueAtRisk,
  };
}

export { NEAR_EXPIRY_DAYS };
