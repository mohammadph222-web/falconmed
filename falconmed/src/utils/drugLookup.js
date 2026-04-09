import { supabase } from "../lib/supabaseClient";

const SEARCH_LIMIT = 20;
const DRUG_SELECT_FIELDS =
  "drug_code, brand_name, generic_name, strength, dosage_form, display_name, package_size, normalized_pack_size, pharmacy_price, public_price";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeDrugRow(row) {
  if (!row) return null;

  return {
    drug_code: row.drug_code || "",
    brand_name: row.brand_name || "",
    generic_name: row.generic_name || "",
    strength: row.strength || "",
    dosage_form: row.dosage_form || "",
    display_name: row.display_name || "",
    package_size: row.package_size || "",
    normalized_pack_size: row.normalized_pack_size ?? null,
    pharmacy_price: row.pharmacy_price ?? null,
    public_price: row.public_price ?? null,
  };
}

export async function getDrugByCode(drugCode) {
  const code = normalize(drugCode);
  if (!code || !supabase) return null;

  const { data, error } = await supabase
    .from("drug_master")
    .select(DRUG_SELECT_FIELDS)
    .eq("drug_code", code)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to lookup drug code.");
  }

  return normalizeDrugRow(data);
}

export async function searchDrugs(query) {
  const q = normalize(query);
  if (!q || q.length < 2 || !supabase) return [];

  const like = `%${q}%`;

  const { data, error } = await supabase
    .from("drug_master")
    .select(DRUG_SELECT_FIELDS)
    .or(
      `drug_code.ilike.${like},brand_name.ilike.${like},generic_name.ilike.${like},display_name.ilike.${like}`
    )
    .order("drug_code", { ascending: true })
    .limit(SEARCH_LIMIT);

  if (error) {
    throw new Error(error.message || "Failed to search drugs.");
  }

  return Array.isArray(data)
    ? data.slice(0, SEARCH_LIMIT).map((row) => normalizeDrugRow(row))
    : [];
}