import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { buildPdssSummary, calculateShortagePredictions } from "../../utils/pdss";
import { riskBadgeStyles } from "../../utils/badgeStyles";
import StatCard from "../../components/StatCard";

async function safeFetch(table, columns) {
  if (!supabase) return { data: [], error: null };

  try {
    const { data, error } = await supabase.from(table).select(columns).limit(2000);
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

export default function ShortageIntelligence() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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
        safeFetch("expiry_records", "drug_name,quantity,created_at"),
      ]);

      const shortageData = [
        ...(shortageRes.data || []),
        ...loadLocalArray("falconmed_shortages"),
      ];
      const refillData = [
        ...(refillRes.data || []),
        ...loadLocalArray("falconmed_refills"),
      ];
      const expiryData = expiryRes.data || [];

      const results = calculateShortagePredictions({
        shortages: shortageData,
        refills: refillData,
        expiryRecords: expiryData,
      });

      setRows(results);

      const queryErrors = [shortageRes.error, refillRes.error, expiryRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some data sources are unavailable. Showing best-effort PDSS results using available records."
        );
      } else if (results.length === 0) {
        setMessage("No usage or shortage history available yet to generate predictions.");
      }

      setLoading(false);
    };

    void load();
  }, []);

  const summary = useMemo(() => buildPdssSummary(rows), [rows]);

  return (
    <div style={wrap}>
      <div style={headerCard}>
        <div>
          <h2 style={title}>PDSS - Shortage Intelligence</h2>
          <p style={subtitle}>
            Predict potential stock shortages from refill, shortage, and inventory history.
          </p>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={statValue}
          label="Tracked Drugs"
          value={summary.total ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b91c1c" }}
          label="High Risk"
          value={summary.high ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b45309" }}
          label="Medium Risk"
          value={summary.medium ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#166534" }}
          label="Low Risk"
          value={summary.low ?? 0}
        />
      </div>

      <div style={tableCard}>
        {loading ? (
          <div style={emptyState}>Loading PDSS predictions...</div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>No prediction rows yet. Add refill/shortage records to start.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Drug Name</th>
                  <th style={th}>Current Stock</th>
                  <th style={th}>Avg Daily Usage</th>
                  <th style={th}>Days Left</th>
                  <th style={th}>Risk Level</th>
                  <th style={th}>Suggested Reorder Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.drugName}>
                    <td style={tdDrug}>{row.drugName}</td>
                    <td style={td}>{row.currentStock}</td>
                    <td style={td}>{row.averageDailyUsage}</td>
                    <td style={td}>{row.daysLeft == null ? "N/A" : row.daysLeft}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...riskBadge,
                          ...(riskBadgeStyles[row.shortageRiskLevel] || riskBadgeStyles.medium),
                        }}
                      >
                        {row.shortageRiskLevel.toUpperCase()}
                      </span>
                    </td>
                    <td style={td}>{row.suggestedReorderQuantity}</td>
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
  minWidth: "920px",
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
};

const tdDrug = {
  ...td,
  fontWeight: 600,
  color: "#0f172a",
};

const riskBadge = {
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
