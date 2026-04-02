import { supabase } from "../lib/supabaseClient";

export const DEMO_PHARMACIES = [
  { id: "demo-pharmacy-a", name: "Pharmacy A", location: "Abu Dhabi" },
  { id: "demo-pharmacy-b", name: "Pharmacy B", location: "Dubai" },
  { id: "demo-pharmacy-c", name: "Pharmacy C", location: "Al Ain" },
];

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

export function mergeDemoPharmacies(rows) {
  const merged = [...(rows || [])];
  const knownNames = new Set(merged.map((row) => normalizeName(row.name)));

  DEMO_PHARMACIES.forEach((pharmacy) => {
    if (!knownNames.has(normalizeName(pharmacy.name))) {
      merged.push(pharmacy);
    }
  });

  return merged.sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export async function loadPharmaciesWithFallback() {
  if (!supabase) {
    return { data: mergeDemoPharmacies([]), error: null, isFallback: true };
  }

  try {
    const { data, error } = await supabase.from("pharmacies").select("*").order("name", { ascending: true });
    if (error) {
      return { data: mergeDemoPharmacies([]), error, isFallback: true };
    }

    const existing = data || [];
    const existingNames = new Set(existing.map((row) => normalizeName(row.name)));
    const missingDemoRows = DEMO_PHARMACIES.filter(
      (row) => !existingNames.has(normalizeName(row.name))
    ).map((row) => ({ name: row.name, location: row.location }));

    if (missingDemoRows.length > 0) {
      try {
        await supabase.from("pharmacies").insert(missingDemoRows);
        const refreshed = await supabase.from("pharmacies").select("*").order("name", { ascending: true });
        if (!refreshed.error) {
          return {
            data: mergeDemoPharmacies(refreshed.data || []),
            error: null,
            isFallback: false,
          };
        }
      } catch {
        // Keep rendering with the merged fallback list when inserts are not allowed.
      }
    }

    return {
      data: mergeDemoPharmacies(existing),
      error: null,
      isFallback: existing.length === 0,
    };
  } catch (error) {
    return { data: mergeDemoPharmacies([]), error, isFallback: true };
  }
}

export function normalizeInventoryRow(row) {
  const rawUnitCost = row?.cost_price ?? row?.unit_cost;
  const rawSalesPrice = row?.sales_price ?? row?.price_to_public;
  const rawCostValue = row?.cost_value ?? row?.line_value;
  const rawSalesValue = row?.sales_value;
  const rawMarginValue = row?.margin_value;
  const parsedUnitCost = Number(rawUnitCost);
  const parsedSalesPrice = Number(rawSalesPrice);
  const parsedCostValue = Number(rawCostValue);
  const parsedSalesValue = Number(rawSalesValue);
  const parsedMarginValue = Number(rawMarginValue);

  return {
    ...row,
    pharmacy_id: row?.pharmacy_id != null ? String(row.pharmacy_id) : "",
    drug_name: row?.drug_name || row?.drug || "",
    batch_no: row?.batch_no || row?.batch || "",
    barcode: row?.barcode || "",
    expiry_date: row?.expiry_date || "",
    quantity: Number(row?.quantity || 0),
    stock_unit: row?.stock_unit || row?.unit || "",
    cost_price:
      rawUnitCost == null || String(rawUnitCost).trim() === "" || !Number.isFinite(parsedUnitCost)
        ? null
        : parsedUnitCost,
    unit_cost:
      rawUnitCost == null || String(rawUnitCost).trim() === "" || !Number.isFinite(parsedUnitCost)
        ? null
        : parsedUnitCost,
    sales_price:
      rawSalesPrice == null || String(rawSalesPrice).trim() === "" || !Number.isFinite(parsedSalesPrice)
        ? null
        : parsedSalesPrice,
    cost_value:
      rawCostValue == null || String(rawCostValue).trim() === "" || !Number.isFinite(parsedCostValue)
        ? null
        : parsedCostValue,
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