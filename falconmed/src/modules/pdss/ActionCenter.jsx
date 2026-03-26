import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  buildActionSummary,
  buildPdssActionItems,
  calculateExpiryIntelligence,
  calculateShortagePredictions,
  calculateSmartTransferRecommendations,
  filterActionItems,
} from "../../utils/pdss";

async function safeFetch(table, columns) {
  if (!supabase) return { data: [], error: null };

  try {
    const { data, error } = await supabase.from(table).select(columns).limit(4000);
    if (error) return { data: [], error };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: [], error };
  }
}

function loadLocalArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

const priorityStyles = {
  high: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" },
  medium: { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" },
  low: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
};

export default function ActionCenter() {
  const [actions, setActions] = useState([]);
  const [filterKey, setFilterKey] = useState("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [prStatus, setPrStatus] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRow, setModalRow] = useState(null);
  const [orderQty, setOrderQty] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [shortageRes, refillRes, expiryRes] = await Promise.all([
        safeFetch(
          "shortage_requests",
          "drug_name,quantity_requested,status,request_date,created_at"
        ),
        safeFetch(
          "refill_requests",
          "drug_name,daily_usage,dispensed,quantity,request_date,created_at"
        ),
        safeFetch(
          "expiry_records",
          "id,drug_name,batch_no,expiry_date,quantity,notes,created_at"
        ),
      ]);

      const shortages = [
        ...(shortageRes.data || []),
        ...loadLocalArray("falconmed_shortages"),
      ];
      const refills = [
        ...(refillRes.data || []),
        ...loadLocalArray("falconmed_refills"),
      ];
      const expiryRecords = expiryRes.data || [];

      const shortageRows = calculateShortagePredictions({
        shortages,
        refills,
        expiryRecords,
      });

      const expiryRows = calculateExpiryIntelligence({
        expiryRecords,
        refills,
      });

      const transferRows = calculateSmartTransferRecommendations({
        shortages,
        refills,
        expiryRecords,
      });

      const normalized = buildPdssActionItems({
        shortageRows,
        expiryRows,
        transferRows,
      });

      setActions(normalized);

      const queryErrors = [shortageRes.error, refillRes.error, expiryRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some PDSS sources are unavailable. Action Center is showing best-effort operational actions."
        );
      }

      setLoading(false);
    };

    void load();
  }, []);

  const summary = useMemo(() => buildActionSummary(actions), [actions]);
  const filtered = useMemo(() => filterActionItems(actions, filterKey), [actions, filterKey]);

  const openModal = (row) => {
    setModalRow(row);
    setOrderQty(String(row.suggestedQuantity || 1));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalRow(null);
    setOrderQty("");
  };

  const handleCreatePurchaseRequest = async () => {
    if (!supabase || !modalRow) return;
    const drugName = modalRow.drugName || modalRow.drug_name || modalRow.drug || modalRow.name || "";
    if (!drugName) return;
    const qty = parseInt(orderQty, 10);
    if (!qty || qty <= 0) return;
    setPrStatus((prev) => ({ ...prev, [modalRow.id]: "creating" }));
    try {
      const { error } = await supabase.from("purchase_requests").insert([{
        drug_name: drugName,
        suggested_qty: qty,
        priority: modalRow.priority,
        reason: modalRow.action || "",
        status: "pending",
      }]);
      if (error) throw error;
      setPrStatus((prev) => ({ ...prev, [modalRow.id]: "idle" }));
      closeModal();
      setMessage("Purchase request created successfully.");
    } catch (err) {
      setPrStatus((prev) => ({ ...prev, [modalRow.id]: "idle" }));
    }
  };

  return (
    <div style={wrap}>
      {modalOpen && modalRow && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={modalTitle}>Create Purchase Request</h3>
            <div style={modalField}>
              <span style={modalLabel}>Drug Name</span>
              <span style={modalValue}>
                {modalRow.drugName || modalRow.drug_name || modalRow.drug || modalRow.name || "—"}
              </span>
            </div>
            <div style={modalField}>
              <span style={modalLabel}>Suggested Quantity</span>
              <span style={modalValue}>{modalRow.suggestedQuantity || 0}</span>
            </div>
            <div style={modalField}>
              <label style={modalLabel} htmlFor="order-qty">Order Quantity</label>
              <input
                id="order-qty"
                type="number"
                min="1"
                style={modalInput}
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
              />
            </div>
            <div style={modalActions}>
              <button type="button" style={cancelBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
                style={confirmBtn}
                disabled={prStatus[modalRow.id] === "creating" || !orderQty || parseInt(orderQty, 10) <= 0}
                onClick={handleCreatePurchaseRequest}
              >
                {prStatus[modalRow.id] === "creating" ? "Creating..." : "Create Purchase Request"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={headerCard}>
        <h2 style={title}>Action Center</h2>
        <p style={subtitle}>
          Unified operational actions from shortage, expiry, and transfer intelligence.
        </p>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <div style={statCard}><div style={statLabel}>Total Actions</div><div style={statValue}>{summary.total ?? 0}</div></div>
        <div style={statCard}><div style={statLabel}>High Priority</div><div style={{ ...statValue, color: "#b91c1c" }}>{summary.high ?? 0}</div></div>
        <div style={statCard}><div style={statLabel}>Medium Priority</div><div style={{ ...statValue, color: "#b45309" }}>{summary.medium ?? 0}</div></div>
        <div style={statCard}><div style={statLabel}>Low Priority</div><div style={{ ...statValue, color: "#166534" }}>{summary.low ?? 0}</div></div>
      </div>

      <div style={filterBar}>
        {[
          ["all", "All"],
          ["shortage", "Shortage"],
          ["expiry", "Expiry"],
          ["transfer", "Transfer"],
          ["high-priority", "High Priority"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            style={filterKey === key ? activeFilterBtn : filterBtn}
            onClick={() => setFilterKey(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={tableCard}>
        {loading ? (
          <div style={emptyState}>Loading actions...</div>
        ) : filtered.length === 0 ? (
          <div style={emptyState}>No actions match the selected filter.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Priority</th>
                  <th style={th}>Type</th>
                  <th style={th}>Action</th>
                  <th style={th}>Drug Name</th>
                  <th style={th}>Details</th>
                  <th style={th}>Suggested Quantity</th>
                  <th style={th}>Create PR</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>
                      <span style={{ ...badge, ...(priorityStyles[row.priority] || priorityStyles.medium) }}>
                        {String(row.priority || "medium").toUpperCase()}
                      </span>
                    </td>
                    <td style={td}>{row.type}</td>
                    <td style={td}>{row.action}</td>
                    <td style={tdDrug}>{row.drugName}</td>
                    <td style={td}>{row.details}</td>
                    <td style={td}>{row.suggestedQuantity || 0}</td>
                    <td style={td}>
                      <button
                        type="button"
                        style={prBtn}
                        onClick={() => openModal(row)}
                      >
                        Create PR
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const wrap = { display: "grid", gap: "16px" };
const headerCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  border: "1px solid #e2e8f0",
};
const title = { margin: 0, color: "#0f172a" };
const subtitle = { marginTop: "8px", marginBottom: 0, color: "#475569" };
const messageBox = {
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: "12px",
  padding: "12px 14px",
  border: "1px solid #bfdbfe",
  fontSize: "14px",
};
const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};
const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e2e8f0",
  borderTop: "3px solid #e2e8f0",
};
const statLabel = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "8px",
};
const statValue = { marginTop: "10px", fontSize: "28px", color: "#0f172a", fontWeight: 700 };
const filterBar = { display: "flex", flexWrap: "wrap", gap: "10px" };
const filterBtn = {
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
  borderRadius: "999px",
  padding: "8px 14px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};
const activeFilterBtn = {
  ...filterBtn,
  background: "#2563eb",
  border: "1px solid #2563eb",
  color: "#ffffff",
};
const tableCard = {
  background: "white",
  borderRadius: "16px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};
const tableWrap = { width: "100%", overflowX: "auto" };
const table = { width: "100%", borderCollapse: "collapse", minWidth: "980px" };
const th = {
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
  background: "#f8fafc",
  borderBottom: "2px solid #e2e8f0",
  padding: "12px 14px",
};
const td = {
  color: "#334155",
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "14px",
};
const tdDrug = { ...td, fontWeight: 600, color: "#0f172a" };
const badge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "5px 10px",
};
const emptyState = { padding: "24px", color: "#64748b" };

const prBtn = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modalBox = {
  background: "white",
  borderRadius: "16px",
  padding: "28px 24px",
  width: "100%",
  maxWidth: "420px",
  boxShadow: "0 20px 60px rgba(15, 23, 42, 0.18)",
  border: "1px solid #e2e8f0",
  display: "grid",
  gap: "16px",
};
const modalTitle = {
  margin: 0,
  fontSize: "17px",
  fontWeight: 700,
  color: "#0f172a",
};
const modalField = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};
const modalLabel = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
};
const modalValue = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#0f172a",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "8px 12px",
};
const modalInput = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#0f172a",
  background: "white",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "8px 12px",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const modalActions = {
  display: "flex",
  gap: "10px",
  justifyContent: "flex-end",
  marginTop: "4px",
};
const cancelBtn = {
  padding: "8px 16px",
  background: "white",
  color: "#334155",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};
const confirmBtn = {
  padding: "8px 16px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "8px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};
