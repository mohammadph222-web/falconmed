const NEAR_EXPIRY_DAYS = 180;

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
    const unitCost = Math.max(0, toNumber(row?.unit_cost ?? row?.cost_price, 0));
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
