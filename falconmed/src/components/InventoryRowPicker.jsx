import { useEffect, useMemo, useState } from "react";
import { fetchInventoryRowsByPharmacy } from "../lib/stockMovementService";

const QUERY_DEBOUNCE_MS = 180;
const MAX_VISIBLE_ROWS = 250;

function text(value) {
  return String(value || "").trim();
}

function formatExpiry(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value) || "-";
  return date.toLocaleDateString();
}

export default function InventoryRowPicker({
  pharmacyId,
  selectedRow,
  onSelect,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, QUERY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!pharmacyId) {
      setAllRows([]);
      return;
    }

    let canceled = false;

    const run = async () => {
      setLoading(true);
      try {
        const data = await fetchInventoryRowsByPharmacy(pharmacyId, "", 1000);
        if (!canceled) {
          setAllRows(data || []);
        }
      } catch {
        if (!canceled) {
          setAllRows([]);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [pharmacyId]);

  const rows = useMemo(() => {
    const q = text(debouncedQuery).toLowerCase();
    if (!q) return allRows.slice(0, MAX_VISIBLE_ROWS);

    return allRows
      .filter((row) => {
        const haystack = [
          text(row?.drug_name),
          text(row?.batch_no),
          text(row?.barcode),
          text(row?.expiry_date),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, MAX_VISIBLE_ROWS);
  }, [allRows, debouncedQuery]);

  const helper = useMemo(() => {
    if (!pharmacyId) return "Select source pharmacy first.";
    if (loading) return "Loading inventory rows...";
    if (allRows.length > MAX_VISIBLE_ROWS && rows.length === MAX_VISIBLE_ROWS) {
      return `${rows.length} matching inventory rows (showing first ${MAX_VISIBLE_ROWS})`;
    }
    return `${rows.length} matching inventory row${rows.length === 1 ? "" : "s"}`;
  }, [allRows.length, loading, pharmacyId, rows.length]);

  return (
    <div style={wrap}>
      <label style={labelStyle}>Inventory Row Search</label>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={inputStyle}
        disabled={!pharmacyId || disabled}
        placeholder={pharmacyId ? "Search by drug, batch, expiry, barcode" : "Select pharmacy first"}
      />
      <div style={helperStyle}>{helper}</div>

      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Drug</th>
              <th style={th}>Available</th>
              <th style={th}>Batch</th>
              <th style={th}>Expiry</th>
              <th style={th}>Barcode</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {!pharmacyId ? (
              <tr>
                <td style={emptyCell} colSpan={6}>Select source pharmacy to load inventory rows.</td>
              </tr>
            ) : loading ? (
              <tr>
                <td style={emptyCell} colSpan={6}>Loading source inventory...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td style={emptyCell} colSpan={6}>No matching inventory rows found.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectedRow?.id === row.id;
                return (
                  <tr key={row.id} style={isSelected ? selectedRowStyle : undefined}>
                    <td style={td}>{text(row?.drug_name) || "-"}</td>
                    <td style={td}>{Number(row?.quantity || 0)}</td>
                    <td style={td}>{text(row?.batch_no) || "-"}</td>
                    <td style={td}>{formatExpiry(row?.expiry_date)}</td>
                    <td style={td}>{text(row?.barcode) || "-"}</td>
                    <td style={td}>
                      <button type="button" style={selectBtn} onClick={() => onSelect?.(row)}>
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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

const tableWrap = {
  border: "1px solid #dbe3ef",
  borderRadius: "12px",
  overflowX: "auto",
  background: "#ffffff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  textAlign: "left",
  fontSize: "12px",
  color: "#475569",
  background: "#f8fafc",
  padding: "10px",
  borderBottom: "1px solid #e2e8f0",
};

const td = {
  fontSize: "13px",
  color: "#0f172a",
  padding: "10px",
  borderBottom: "1px solid #edf2f7",
};

const emptyCell = {
  fontSize: "13px",
  color: "#64748b",
  textAlign: "center",
  padding: "14px",
};

const selectBtn = {
  border: "1px solid #2563eb",
  color: "#1d4ed8",
  background: "#eff6ff",
  borderRadius: "8px",
  fontWeight: 700,
  fontSize: "12px",
  padding: "6px 10px",
  cursor: "pointer",
};

const selectedRowStyle = {
  background: "#eff6ff",
};
