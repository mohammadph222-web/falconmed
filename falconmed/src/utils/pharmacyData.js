import { supabase } from "../lib/supabaseClient";

function toCanonicalPharmacy(row) {
  const id = String(row?.id || "").trim();
  if (!id) return null;

  return {
    id,
    name: String(row?.name || "").trim(),
    location: String(row?.location || "").trim(),
  };
}

function dedupePharmaciesById(rows) {
  const map = new Map();

  for (const row of rows || []) {
    const canonical = toCanonicalPharmacy(row);
    if (!canonical) continue;

    const existing = map.get(canonical.id);
    if (!existing) {
      map.set(canonical.id, canonical);
      continue;
    }

    map.set(canonical.id, {
      id: canonical.id,
      name: existing.name || canonical.name,
      location: existing.location || canonical.location,
    });
  }

  return Array.from(map.values()).sort((left, right) =>
    String(left.name || "").localeCompare(String(right.name || ""))
  );
}

export async function loadPharmaciesWithFallback() {
  if (!supabase) {
    return {
      data: [],
      error: null,
      isFallback: true,
    };
  }

  try {
    const { data, error } = await supabase
      .from("pharmacies")
      .select("id, name, location")
      .order("name", { ascending: true });

    if (error) {
      return {
        data: [],
        error,
        isFallback: true,
      };
    }

    const existing = dedupePharmaciesById(data || []);

    return {
      data: existing,
      error: null,
      isFallback: existing.length === 0,
    };
  } catch (error) {
    return {
      data: [],
      error,
      isFallback: true,
    };
  }
}

export function normalizeInventoryRow(row) {
  const rawUnitCost = row?.unit_cost;
  const rawSalesPrice = row?.sales_price ?? row?.price_to_public;
  const rawSalesValue = row?.sales_value;
  const rawMarginValue = row?.margin_value;
  const parsedUnitCost = Number(rawUnitCost);
  const parsedSalesPrice = Number(rawSalesPrice);
  const parsedSalesValue = Number(rawSalesValue);
  const parsedMarginValue = Number(rawMarginValue);
  const parsedQuantity = Number(row?.quantity || 0);
  const hasUnitCost =
    rawUnitCost != null && String(rawUnitCost).trim() !== "" && Number.isFinite(parsedUnitCost);
  const derivedCostValue = hasUnitCost ? parsedQuantity * parsedUnitCost : null;

  return {
    ...row,
    pharmacy_id: row?.pharmacy_id != null ? String(row.pharmacy_id) : "",
    drug_name: row?.drug_name || row?.drug || "",
    batch_no: row?.batch_no || row?.batch || "",
    barcode: row?.barcode || "",
    expiry_date: row?.expiry_date || "",
    quantity: Number(row?.quantity || 0),
    stock_unit: row?.stock_unit || row?.unit || "",
    cost_price: hasUnitCost ? parsedUnitCost : null,
    unit_cost:
      hasUnitCost ? parsedUnitCost : null,
    sales_price:
      rawSalesPrice == null || String(rawSalesPrice).trim() === "" || !Number.isFinite(parsedSalesPrice)
        ? null
        : parsedSalesPrice,
    cost_value: derivedCostValue,
    sales_value:
      rawSalesValue == null || String(rawSalesValue).trim() === "" || !Number.isFinite(parsedSalesValue)
        ? null
        : parsedSalesValue,
    margin_value:
      rawMarginValue == null || String(rawMarginValue).trim() === "" || !Number.isFinite(parsedMarginValue)
        ? null
        : parsedMarginValue,
  };
}