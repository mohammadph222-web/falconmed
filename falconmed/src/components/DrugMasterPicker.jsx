import { useEffect, useMemo, useState } from "react";
import {
  getDrugDisplayName,
  loadDrugMaster,
  searchDrugMaster,
} from "../utils/drugMasterLoader";

const QUERY_DEBOUNCE_MS = 180;
const MAX_VISIBLE_RESULTS = 20;

function normalize(value) {
  return String(value || "").trim();
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export default function DrugMasterPicker({
  label = "Drug Master Search",
  value,
  onSelect,
  required = false,
  disabled = false,
}) {
  const [query, setQuery] = useState(() => normalize(value?.drug_name || value?.display_name));
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [allDrugs, setAllDrugs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let canceled = false;

    setLoading(true);

    loadDrugMaster()
      .then((rows) => {
        if (!canceled) {
          setAllDrugs(rows || []);
        }
      })
      .catch(() => {
        if (!canceled) {
          setAllDrugs([]);
        }
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    setQuery(normalize(value?.drug_name || value?.display_name));
  }, [value?.drug_name, value?.display_name]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(normalizeSearchText(query));
    }, QUERY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  const normalizedQuery = useMemo(() => normalizeSearchText(debouncedQuery), [debouncedQuery]);

  const results = useMemo(() => {
    if (disabled) return [];
    const q = normalizedQuery;
    if (!q || q.length < 2) return [];
    return searchDrugMaster(allDrugs, q, MAX_VISIBLE_RESULTS).slice(0, MAX_VISIBLE_RESULTS);
  }, [allDrugs, disabled, normalizedQuery]);

  const helper = useMemo(() => {
    if (disabled) return "Enable Receive workflow to search drug master.";
    if (!query || query.trim().length < 2) return "Type at least 2 characters to search by name or barcode.";
    if (loading) return "Loading drug master...";
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
                <div style={resultTitle}>{drug.display_name || getDrugDisplayName(drug) || "Unnamed drug"}</div>
                <div style={resultMeta}>
                  Code: {normalize(drug?.drug_code) || "-"} | Pack: {normalize(drug?.package_size_raw || drug?.package_size) || "-"}
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