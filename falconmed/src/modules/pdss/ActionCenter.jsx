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
import { priorityBadgeStyles } from "../../utils/badgeStyles";
import StatCard from "../../components/StatCard";

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

const priorityOrder = { high: 0, medium: 1, low: 2 };

function extractDaysLeft(row) {
  const details = String(row?.details || "");
  const match = details.match(/(\d+)\s*day/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function normalizeAction(row) {
  const type = String(row?.type || "").toLowerCase();
  const action = String(row?.action || "").toLowerCase();
  const priority = String(row?.priority || "medium").toLowerCase();

  if (type.includes("transfer") || action.includes("transfer")) return "Transfer stock";
  if (type.includes("expiry") || action.includes("expiry")) return "Prioritize batch usage";
  if (type.includes("shortage") || action.includes("shortage")) {
    return priority === "high" ? "Reorder now" : "Review shortage manually";
  }
  if (priority === "low") return "Monitor only";
  return row?.action || "Review action";
}

function normalizeDetails(row) {
  const details = String(row?.details || "").trim();
  if (!details) return "Operational signal detected. Review this item for action.";
  return details;
}

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

  const prioritizedActions = useMemo(() => {
    const normalized = (actions || []).map((row) => {
      const daysLeft = extractDaysLeft(row);
      const riskValue = Number(row?.riskValue || row?.suggestedQuantity || 0);
      return {
        ...row,
        action: normalizeAction(row),
        details: normalizeDetails(row),
        _priorityRank: priorityOrder[String(row?.priority || "medium").toLowerCase()] ?? 3,
        _daysLeft: daysLeft,
        _riskValue: Number.isFinite(riskValue) ? riskValue : 0,
      };
    });

    normalized.sort((a, b) => {
      if (a._priorityRank !== b._priorityRank) return a._priorityRank - b._priorityRank;
      if (a._daysLeft !== b._daysLeft) return a._daysLeft - b._daysLeft;
      return b._riskValue - a._riskValue;
    });

    return normalized;
  }, [actions]);

  const summary = useMemo(() => buildActionSummary(prioritizedActions), [prioritizedActions]);
  const filtered = useMemo(
    () => filterActionItems(prioritizedActions, filterKey),
    [prioritizedActions, filterKey]
  );

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
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={statValue}
          label="Total Actions"
          value={summary.total ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b91c1c" }}
          label="High Priority"
          value={summary.high ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b45309" }}
          label="Medium Priority"
          value={summary.medium ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#166534" }}
          label="Low Priority"
          value={summary.low ?? 0}
        />
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
                      <span style={{ ...badge, ...(priorityBadgeStyles[row.priority] || priorityBadgeStyles.medium) }}>
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
  background: "linear-gradient(145deg, #ffffff 0%, #f7fbff 100%)",
  borderRadius: "18px",
  padding: "24px",
  boxShadow: "0 16px 32px rgba(15, 23, 42, 0.09)",
  border: "1px solid #dce6f2",
};
const title = { margin: 0, color: "#0f172a", fontSize: "28px", letterSpacing: "-0.02em" };
const subtitle = { marginTop: "8px", marginBottom: 0, color: "#5b6b85", fontSize: "14px" };
const messageBox = {
  background: "#eef5ff",
  color: "#1e40af",
  borderRadius: "12px",
  padding: "12px 14px",
  border: "1px solid #cfe0ff",
  fontSize: "14px",
};
const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "14px",
};
const statCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #f9fcff 100%)",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.07)",
  border: "1px solid #dfe8f4",
  borderTop: "4px solid #d7e3f4",
};
const statLabel = {
  color: "#6b7b94",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: "8px",
};
const statValue = { marginTop: "10px", fontSize: "30px", color: "#0f172a", fontWeight: 800 };
const filterBar = { display: "flex", flexWrap: "wrap", gap: "10px" };
const filterBtn = {
  border: "1px solid #d4deea",
  background: "#ffffff",
  color: "#334155",
  borderRadius: "999px",
  padding: "8px 15px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
};
const activeFilterBtn = {
  ...filterBtn,
  background: "#1d4ed8",
  border: "1px solid #1d4ed8",
  color: "#ffffff",
  boxShadow: "0 8px 16px rgba(29, 78, 216, 0.24)",
};
const tableCard = {
  background: "white",
  borderRadius: "16px",
  boxShadow: "0 12px 26px rgba(15, 23, 42, 0.08)",
  border: "1px solid #dfe8f4",
  overflow: "hidden",
};
const tableWrap = { width: "100%", overflowX: "auto" };
const table = { width: "100%", borderCollapse: "collapse", minWidth: "980px" };
const th = {
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#64748b",
  background: "#f4f8fd",
  borderBottom: "1px solid #dce7f4",
  padding: "13px 14px",
};
const td = {
  color: "#334155",
  padding: "13px 14px",
  borderBottom: "1px solid #edf2f8",
  fontSize: "14px",
};
const tdDrug = { ...td, fontWeight: 600, color: "#0f172a" };
const badge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "5px 11px",
};
const emptyState = { padding: "24px", color: "#64748b" };

const prBtn = {
  padding: "7px 13px",
  background: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
  color: "white",
  border: "none",
  borderRadius: "9px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
  boxShadow: "0 8px 14px rgba(37,99,235,0.24)",
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
