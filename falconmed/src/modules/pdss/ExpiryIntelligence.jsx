import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  buildExpiryMetrics,
  buildExpiryNarrative,
  calculateExpiryIntelligence,
} from "../../utils/pdss";
import { riskBadgeStyles } from "../../utils/badgeStyles";
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

export default function ExpiryIntelligence() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [expiryRes, refillRes] = await Promise.all([
        safeFetch(
          "expiry_records",
          "id,drug_name,batch_no,expiry_date,quantity,notes,created_at"
        ),
        safeFetch(
          "refill_requests",
          "drug_name,daily_usage,dispensed,quantity,request_date,created_at"
        ),
      ]);

      const expiryRecords = expiryRes.data || [];
      const refills = [
        ...(refillRes.data || []),
        ...loadLocalArray("falconmed_refills"),
      ];

      const computed = calculateExpiryIntelligence({
        expiryRecords,
        refills,
      });

      setRows(computed);

      const queryErrors = [expiryRes.error, refillRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some inventory or refill sources are unavailable. Expiry intelligence is shown using available records."
        );
      } else if (computed.length === 0) {
        setMessage("No expiry batches available yet to generate intelligence.");
      }

      setLoading(false);
    };

    void load();
  }, []);

  const metrics = useMemo(() => buildExpiryMetrics(rows), [rows]);
  const narrative = useMemo(() => buildExpiryNarrative(metrics), [metrics]);

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div>
          <div style={eyebrow}>Expiry Intelligence</div>
          <h2 style={title}>PDSS Expiry Intelligence</h2>
          <p style={subtitle}>
            System-level view of expiry exposure based on remaining shelf life versus expected consumption pace.
          </p>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={statValue}
          label="Near Expiry Batches"
          value={metrics.nearExpiryBatches ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b91c1c" }}
          label="High Expiry Risk"
          value={metrics.highExpiryRisk ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#b45309" }}
          label="Medium Expiry Risk"
          value={metrics.mediumExpiryRisk ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={{ ...statValue, color: "#166534" }}
          label="Low Expiry Risk"
          value={metrics.lowExpiryRisk ?? 0}
        />
        <StatCard
          style={statCard}
          labelStyle={statLabel}
          valueStyle={statValue}
          label="Estimated At-Risk Qty"
          value={metrics.estimatedAtRiskQuantity ?? 0}
        />
      </div>

      <div style={summaryCard}>
        <h3 style={sectionTitle}>Operational Summary</h3>
        <p style={summaryText}>{loading ? "Loading summary..." : narrative}</p>
      </div>

      <div style={tableCard}>
        {loading ? (
          <div style={emptyState}>Loading expiry intelligence...</div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>No expiry rows available.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Drug Name</th>
                  <th style={th}>Batch Number</th>
                  <th style={th}>Quantity</th>
                  <th style={th}>Expiry Date</th>
                  <th style={th}>Days To Expiry</th>
                  <th style={th}>Avg Daily Usage</th>
                  <th style={th}>Risk Level</th>
                  <th style={th}>Suggested Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={tdDrug}>{row.drugName}</td>
                    <td style={td}>{row.batchNumber}</td>
                    <td style={td}>{row.quantity}</td>
                    <td style={td}>{row.expiryDate || "-"}</td>
                    <td style={td}>{row.daysToExpiry == null ? "N/A" : row.daysToExpiry}</td>
                    <td style={td}>{row.averageDailyUsage}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...badge,
                          ...(riskBadgeStyles[row.expiryRiskLevel] || riskBadgeStyles.medium),
                        }}
                      >
                        {row.expiryRiskLevel.toUpperCase()}
                      </span>
                    </td>
                    <td style={td}>{row.suggestedAction}</td>
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

const heroCard = {
  background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
  borderRadius: "18px",
  padding: "22px",
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

const title = {
  margin: 0,
  color: "#0f172a",
};

const subtitle = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#475569",
  maxWidth: "760px",
  lineHeight: 1.6,
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
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
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
  color: "#0f172a",
  fontSize: "30px",
  fontWeight: 700,
};

const summaryCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "10px",
  color: "#0f172a",
};

const summaryText = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.7,
  fontSize: "15px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  overflow: "hidden",
};

const tableWrap = {
  width: "100%",
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "1100px",
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
  padding: "24px 18px",
  color: "#64748b",
};
