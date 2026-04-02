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

export { NEAR_EXPIRY_DAYS };
