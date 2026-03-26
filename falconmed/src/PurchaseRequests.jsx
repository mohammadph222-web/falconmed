import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

const priorityStyles = {
  high: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" },
  medium: { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" },
  low: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
};

const statusStyles = {
  pending: { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" },
  approved: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" },
  ordered: { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" },
  received: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
};

export default function PurchaseRequests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [updating, setUpdating] = useState(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("purchase_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      setMessage(`Failed to load: ${err.message}`);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const updateStatus = async (id, status) => {
    setUpdating(id);
    setMessage("");
    try {
      if (!supabase) throw new Error("Supabase not configured.");
      const { error } = await supabase
        .from("purchase_requests")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    } catch (err) {
      setMessage(`Update failed: ${err.message}`);
    }
    setUpdating(null);
  };

  const renderActions = (row) => {
    const busy = updating === row.id;
    return (
      <div style={actionGroup}>
        {row.status === "pending" && (
          <button
            type="button"
            style={btnApprove}
            disabled={busy}
            onClick={() => updateStatus(row.id, "approved")}
          >
            Approve
          </button>
        )}
        {(row.status === "pending" || row.status === "approved") && (
          <button
            type="button"
            style={btnOrdered}
            disabled={busy}
            onClick={() => updateStatus(row.id, "ordered")}
          >
            Mark Ordered
          </button>
        )}
        {row.status === "ordered" && (
          <button
            type="button"
            style={btnReceived}
            disabled={busy}
            onClick={() => updateStatus(row.id, "received")}
          >
            Mark Received
          </button>
        )}
        {row.status === "received" && (
          <span style={completedLabel}>Completed</span>
        )}
      </div>
    );
  };

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div style={eyebrow}>Procurement</div>
        <h2 style={title}>Purchase Requests</h2>
        <p style={subtitle}>
          Manage pharmacy reorder requests from pending approval through to received stock.
        </p>
      </div>

      {message ? (
        <div
          style={{
            ...messageBox,
            background: message.startsWith("Failed") || message.startsWith("Update")
              ? "#fef2f2"
              : "#eff6ff",
            color: message.startsWith("Failed") || message.startsWith("Update")
              ? "#b91c1c"
              : "#1d4ed8",
            border: message.startsWith("Failed") || message.startsWith("Update")
              ? "1px solid #fecaca"
              : "1px solid #bfdbfe",
          }}
        >
          {message}
        </div>
      ) : null}

      <div style={tableCard}>
        {loading ? (
          <div style={emptyState}>Loading purchase requests...</div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>
            <div style={emptyTitle}>No purchase requests yet.</div>
            <div style={emptyText}>
              Create requests from the PDSS Action Center to get started.
            </div>
          </div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Drug Name</th>
                  <th style={th}>Suggested Qty</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Status</th>
                  <th style={th}>Created At</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdDrug}>{row.drug_name}</td>
                    <td style={td}>{row.suggested_qty ?? 0}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...badge,
                          ...(priorityStyles[String(row.priority || "medium").toLowerCase()] || priorityStyles.medium),
                        }}
                      >
                        {String(row.priority || "MEDIUM").toUpperCase()}
                      </span>
                    </td>
                    <td style={tdReason}>{row.reason || "-"}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...badge,
                          ...(statusStyles[row.status] || statusStyles.pending),
                        }}
                      >
                        {String(row.status || "pending").toUpperCase()}
                      </span>
                    </td>
                    <td style={td}>
                      {row.created_at
                        ? new Date(row.created_at).toLocaleDateString()
                        : "-"}
                    </td>
                    <td style={td}>{renderActions(row)}</td>
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

const heroCard = {
  background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
  borderRadius: "18px",
  padding: "26px 28px",
  border: "1px solid #dbe7f5",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

const eyebrow = {
  display: "inline-flex",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#e0ecff",
  color: "#1d4ed8",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "12px",
};

const title = { margin: 0, color: "#0f172a" };

const subtitle = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#475569",
  lineHeight: 1.6,
};

const messageBox = {
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "14px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  overflow: "hidden",
};

const tableWrap = { width: "100%", overflowX: "auto" };

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "1080px",
};

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
  verticalAlign: "middle",
};

const tdDrug = {
  ...td,
  fontWeight: 600,
  color: "#0f172a",
};

const tdReason = {
  ...td,
  maxWidth: "280px",
  lineHeight: 1.5,
};

const badge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "4px 10px",
};

const actionGroup = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

const btnBase = {
  padding: "6px 12px",
  border: "none",
  borderRadius: "8px",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const btnApprove = {
  ...btnBase,
  background: "#2563eb",
  color: "white",
};

const btnOrdered = {
  ...btnBase,
  background: "#f59e0b",
  color: "white",
};

const btnReceived = {
  ...btnBase,
  background: "#16a34a",
  color: "white",
};

const completedLabel = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#166534",
};

const emptyState = {
  padding: "48px 24px",
  textAlign: "center",
  color: "#64748b",
};

const emptyTitle = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#0f172a",
  marginBottom: "8px",
};

const emptyText = {
  fontSize: "14px",
  color: "#64748b",
  lineHeight: 1.6,
};
