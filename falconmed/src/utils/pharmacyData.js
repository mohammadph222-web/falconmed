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
  return {
    ...row,
    pharmacy_id: row?.pharmacy_id != null ? String(row.pharmacy_id) : "",
    drug_name: row?.drug_name || row?.drug || "",
    batch_no: row?.batch_no || row?.batch || "",
    barcode: row?.barcode || "",
    expiry_date: row?.expiry_date || "",
    quantity: Number(row?.quantity || 0),
    unit_cost: Number(row?.unit_cost || 0),
  };
}