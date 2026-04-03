import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

function normalize(value) {
  return String(value || "").trim();
}

function getDisplayName(drug) {
  const primary = normalize(drug?.drug_name || drug?.brand_name || drug?.generic_name);
  const strength = normalize(drug?.strength);
  return [primary, strength].filter(Boolean).join(" ");
}

export default function DrugMasterPicker({
  label = "Drug Master Search",
  value,
  onSelect,
  required = false,
  disabled = false,
}) {
  const [query, setQuery] = useState(() => normalize(value?.drug_name || value?.display_name));
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setQuery(normalize(value?.drug_name || value?.display_name));
  }, [value?.drug_name, value?.display_name]);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      const q = normalize(query);
      if (!q || q.length < 2 || disabled || !supabase) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const like = `%${q}%`;
        const { data, error } = await supabase
          .from("drug_master")
          .select("id, drug_name, brand_name, generic_name, drug_code, barcode, strength, dosage_form, unit, unit_cost, unit_price_pharmacy, unit_price_public, public_price, pharmacy_price")
          .or(`drug_name.ilike.${like},brand_name.ilike.${like},generic_name.ilike.${like},barcode.ilike.${like},drug_code.ilike.${like}`)
          .order("drug_name", { ascending: true })
          .limit(100);

        if (error) {
          throw error;
        }

        if (canceled) return;

        const deduped = [];
        const seen = new Set();
        for (const row of data || []) {
          const key = normalize(row?.drug_code) || `${normalize(row?.drug_name)}::${normalize(row?.barcode)}`;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          deduped.push({
            ...row,
            display_name: getDisplayName(row),
          });
        }

        setResults(deduped);
      } catch {
        if (!canceled) setResults([]);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [query, disabled]);

  const helper = useMemo(() => {
    if (disabled) return "Enable Receive workflow to search drug master.";
    if (!query || query.trim().length < 2) return "Type at least 2 characters to search by name or barcode.";
    if (loading) return "Searching drug master...";
    return `${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [disabled, loading, query, results.length]);

  return (
    <div style={wrap}>
      <label style={labelStyle}>{label}</label>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by drug name, brand, generic, code, or barcode"
        style={inputStyle}
        disabled={disabled}
        required={required}
      />
      <div style={helperStyle}>{helper}</div>

      {!disabled && query.trim().length >= 2 ? (
        <div style={resultsWrap}>
          {results.length === 0 ? (
            <div style={emptyRow}>No matching drug master records.</div>
          ) : (
            results.map((drug, index) => (
              <button
                key={`${drug.id || "x"}-${drug.drug_code || drug.drug_name || index}`}
                type="button"
                style={resultButton}
                onClick={() => onSelect?.(drug)}
              >
                <div style={resultTitle}>{drug.display_name || normalize(drug?.drug_name) || "Unnamed drug"}</div>
                <div style={resultMeta}>
                  Code: {normalize(drug?.drug_code) || "-"} | Barcode: {normalize(drug?.barcode) || "-"}
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

const wrap = {
  display: "grid",
  gap: "8px",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#0f172a",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  boxSizing: "border-box",
};

const helperStyle = {
  fontSize: "12px",
  color: "#64748b",
};

const resultsWrap = {
  border: "1px solid #dbe3ef",
  borderRadius: "12px",
  maxHeight: "260px",
  overflowY: "auto",
  background: "#ffffff",
};

const resultButton = {
  width: "100%",
  border: "none",
  borderBottom: "1px solid #edf2f7",
  textAlign: "left",
  background: "#ffffff",
  cursor: "pointer",
  padding: "10px 12px",
};

const resultTitle = {
  fontSize: "13px",
  color: "#0f172a",
  fontWeight: 700,
};

const resultMeta = {
  marginTop: "4px",
  fontSize: "12px",
  color: "#475569",
};

const emptyRow = {
  padding: "12px",
  fontSize: "13px",
  color: "#64748b",
};
