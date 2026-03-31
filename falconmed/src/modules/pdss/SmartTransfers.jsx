import { useEffect, useMemo, useState } from "react";
import { calculateSmartTransferRecommendations } from "../../utils/pdss";
import { loadLocalArray, safeFetch } from "../../utils/pdssHelpers";
import { riskBadgeStyles } from "../../utils/badgeStyles";
import StatCard from "../../components/StatCard";

export default function SmartTransfers() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [expiryRes, refillRes, shortageRes] = await Promise.all([
        safeFetch("expiry_records", "drug_name,quantity,location,created_at", 3000),
        safeFetch(
          "refill_requests",
          "drug_name,daily_usage,dispensed,quantity,request_date,created_at",
          3000
        ),
        safeFetch(
          "shortage_requests",
          "drug_name,quantity_requested,status,request_date,created_at",
          3000
        ),
      ]);

      const recommendations = calculateSmartTransferRecommendations({
        expiryRecords: expiryRes.data || [],
        refills: [...(refillRes.data || []), ...loadLocalArray("falconmed_refills")],
        shortages: [...(shortageRes.data || []), ...loadLocalArray("falconmed_shortages")],
      });

      setRows(recommendations);

      const queryErrors = [expiryRes.error, refillRes.error, shortageRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some branch or usage sources are unavailable. Recommendations below use the best available records."
        );
      } else if (recommendations.length === 0) {
        setMessage(
          "No safe transfer suggestions available yet. Add branch locations to expiry records and maintain refill/shortage history to improve recommendations."
        );
      }

      setLoading(false);
    };

    void load();
  }, []);

  const summary = useMemo(() => {
    return {
      total: rows.length,
      high: rows.filter((row) => row.priority === "high").length,
      medium: rows.filter((row) => row.priority === "medium").length,
      quantity: rows.reduce((sum, row) => sum + Number(row.suggestedTransferQuantity || 0), 0),
    };
  }, [rows]);

  return (
    <div style={wrap}>
      <div style={headerCard}>
        <h2 style={title}>Smart Transfers</h2>
        <p style={subtitle}>
          Read-only inter-branch transfer suggestions based on branch stock coverage and safe sender thresholds.
        </p>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={statValue}
          label="Suggestions"
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
          valueStyle={statValue}
          label="Total Transfer Qty"
          value={summary.quantity ?? 0}
        />
      </div>

      <div style={tableCard}>
        {loading ? (
          <div style={emptyState}>Loading transfer suggestions...</div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>No transfer recommendations available.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Drug Name</th>
                  <th style={th}>From Branch</th>
                  <th style={th}>To Branch</th>
                  <th style={th}>Sender Stock</th>
                  <th style={th}>Sender Days Left</th>
                  <th style={th}>Receiver Stock</th>
                  <th style={th}>Receiver Days Left</th>
                  <th style={th}>Suggested Transfer Qty</th>
                  <th style={th}>Priority</th>
                  <th style={th}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.drugName}-${row.fromBranch}-${row.toBranch}-${index}`}>
                    <td style={tdDrug}>{row.drugName}</td>
                    <td style={td}>{row.fromBranch}</td>
                    <td style={td}>{row.toBranch}</td>
                    <td style={td}>{row.senderStock}</td>
                    <td style={td}>{row.senderDaysLeft}</td>
                    <td style={td}>{row.receiverStock}</td>
                    <td style={td}>{row.receiverDaysLeft}</td>
                    <td style={td}>{row.suggestedTransferQuantity}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...badge,
                          ...(riskBadgeStyles[row.priority] || riskBadgeStyles.medium),
                        }}
                      >
                        {row.priority.toUpperCase()}
                      </span>
                    </td>
                    <td style={tdReason}>{row.reason}</td>
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

const wrap = {
  display: "grid",
  gap: "16px",
};

const headerCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  border: "1px solid #e2e8f0",
};

const title = {
  margin: 0,
  color: "#0f172a",
};

const subtitle = {
  marginTop: "8px",
  marginBottom: 0,
  color: "#475569",
};

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

const statValue = {
  marginTop: "10px",
  fontSize: "28px",
  color: "#0f172a",
  fontWeight: 700,
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

const tableWrap = {
  width: "100%",
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "1440px",
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
  verticalAlign: "top",
};

const tdDrug = {
  ...td,
  fontWeight: 600,
  color: "#0f172a",
};

const tdReason = {
  ...td,
  minWidth: "320px",
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
  padding: "5px 10px",
};

const emptyState = {
  padding: "24px",
  color: "#64748b",
};
