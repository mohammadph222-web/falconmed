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

function getDisplayDrugName(row) {
  return text(row?.drug_name) || text(row?.drug_code) || "Unnamed Drug";
}

function buildSearchHaystack(row) {
  return [
    text(row?.drug_name),
    text(row?.drug_code),
    text(row?.batch_no),
    text(row?.barcode),
    text(row?.expiry_date),
  ]
    .join(" ")
    .toLowerCase();
}

function getRowPriority(row, query) {
  const q = text(query).toLowerCase();
  if (!q) return 999;

  const drugName = text(row?.drug_name).toLowerCase();
  const drugCode = text(row?.drug_code).toLowerCase();
  const batchNo = text(row?.batch_no).toLowerCase();
  const barcode = text(row?.barcode).toLowerCase();

  if (drugName === q || drugCode === q) return 1;
  if (drugName.startsWith(q) || drugCode.startsWith(q)) return 2;
  if (drugName.includes(q) || drugCode.includes(q)) return 3;
  if (batchNo.includes(q) || barcode.includes(q)) return 4;
  return 5;
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
      setQuery("");
      return;
    }

    let canceled = false;

    const run = async () => {
      setLoading(true);

      try {
        const data = await fetchInventoryRowsByPharmacy(pharmacyId, "", 1000);

        if (!canceled) {
          setAllRows(Array.isArray(data) ? data : []);
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

    let filtered = allRows;

    if (q) {
      filtered = allRows.filter((row) => buildSearchHaystack(row).includes(q));
    }

    return [...filtered]
      .sort((a, b) => {
        const priorityDiff = getRowPriority(a, q) - getRowPriority(b, q);
        if (priorityDiff !== 0) return priorityDiff;

        const nameDiff = getDisplayDrugName(a).localeCompare(getDisplayDrugName(b));
        if (nameDiff !== 0) return nameDiff;

        const qtyA = Number(a?.quantity || 0);
        const qtyB = Number(b?.quantity || 0);
        return qtyB - qtyA;
      })
      .slice(0, MAX_VISIBLE_ROWS);
  }, [allRows, debouncedQuery]);

  const helper = useMemo(() => {
    if (!pharmacyId) return "Select source pharmacy first.";
    if (loading) return "Loading inventory rows...";

    if (!debouncedQuery) {
      return `${rows.length} inventory row${rows.length === 1 ? "" : "s"} loaded`;
    }

    if (allRows.length > MAX_VISIBLE_ROWS && rows.length === MAX_VISIBLE_ROWS) {
      return `${rows.length} matching rows shown (limited to first ${MAX_VISIBLE_ROWS})`;
    }

    return `${rows.length} matching inventory row${rows.length === 1 ? "" : "s"}`;
  }, [allRows.length, debouncedQuery, loading, pharmacyId, rows.length]);

  return (
    <div style={wrap}>
      <div style={topRow}>
        <label style={labelStyle}>Inventory Row Search</label>
        {selectedRow?.id ? (
          <div style={selectedBadge}>1 row selected</div>
        ) : null}
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={inputStyle}
        disabled={!pharmacyId || disabled}
        placeholder={
          pharmacyId
            ? "Search by drug name, drug code, batch, expiry, barcode"
            : "Select pharmacy first"
        }
      />

      <div style={helperStyle}>{helper}</div>

      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>Drug</th>
              <th style={th}>Code</th>
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
                <td style={emptyCell} colSpan={7}>
                  Select source pharmacy to load inventory rows.
                </td>
              </tr>
            ) : loading ? (
              <tr>
                <td style={emptyCell} colSpan={7}>
                  Loading source inventory...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td style={emptyCell} colSpan={7}>
                  No matching inventory rows found. Try drug name or drug code.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelected = selectedRow?.id === row.id;

                return (
                  <tr
                    key={row.id}
                    style={isSelected ? selectedRowStyle : undefined}
                  >
                    <td style={tdDrug}>
                      <div style={drugTitle}>{getDisplayDrugName(row)}</div>
                    </td>

                    <td style={tdCode}>{text(row?.drug_code) || "-"}</td>

                    <td style={tdQty}>{Number(row?.quantity || 0)}</td>

                    <td style={td}>{text(row?.batch_no) || "-"}</td>

                    <td style={td}>{formatExpiry(row?.expiry_date)}</td>

                    <td style={td}>{text(row?.barcode) || "-"}</td>

                    <td style={td}>
                      <button
                        type="button"
                        style={isSelected ? selectedBtn : selectBtn}
                        onClick={() => onSelect?.(row)}
                      >
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

const topRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  flexWrap: "wrap",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#0f172a",
};

const selectedBadge = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#1d4ed8",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "999px",
  padding: "4px 10px",
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
  minWidth: "900px",
};

const th = {
  textAlign: "left",
  fontSize: "12px",
  color: "#475569",
  background: "#f8fafc",
  padding: "10px",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
};

const td = {
  fontSize: "13px",
  color: "#0f172a",
  padding: "10px",
  borderBottom: "1px solid #edf2f7",
  verticalAlign: "middle",
};

const tdDrug = {
  ...td,
  minWidth: "260px",
};

const tdCode = {
  ...td,
  color: "#334155",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdQty = {
  ...td,
  fontWeight: 700,
};

const drugTitle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#0f172a",
  lineHeight: 1.4,
  wordBreak: "break-word",
};

const emptyCell = {
  fontSize: "13px",
  color: "#64748b",
  textAlign: "center",
  padding: "16px",
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

const selectedBtn = {
  ...selectBtn,
  background: "#2563eb",
  color: "#ffffff",
};

const selectedRowStyle = {
  background: "#eff6ff",
};