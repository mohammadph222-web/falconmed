import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  buildExecutiveMetrics,
  buildExecutiveNarrative,
  calculateExpiryIntelligence,
  calculateFinancialKpis,
  calculateShortagePredictions,
  calculateSmartTransferRecommendations,
} from "../../utils/pdss";
import { buildDrugPriceMap } from "../../utils/drugPricing";

async function safeFetch(table, columns) {
  if (!supabase) return { data: [], error: null };

  try {
    const { data, error } = await supabase.from(table).select(columns).limit(3000);
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

const riskStyles = {
  high: {
    background: "#fee2e2",
    color: "#991b1b",
  },
  medium: {
    background: "#fef3c7",
    color: "#92400e",
  },
  low: {
    background: "#dcfce7",
    color: "#166534",
  },
};

export default function ExecutiveDashboard() {
  const [shortageRows, setShortageRows] = useState([]);
  const [transferRows, setTransferRows] = useState([]);
  const [financialKpis, setFinancialKpis] = useState({
    estimatedExpiryLoss: 0,
    atRiskInventoryValue: 0,
    highRiskShortageExposure: 0,
  });
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
        safeFetch("expiry_records", "drug_name,quantity,location,batch_no,expiry_date,created_at"),
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

      const computedShortageRows = calculateShortagePredictions({
        shortages,
        refills,
        expiryRecords,
      });
      const computedTransferRows = calculateSmartTransferRecommendations({
        shortages,
        refills,
        expiryRecords,
      });
      const computedExpiryRows = calculateExpiryIntelligence({
        expiryRecords,
        refills,
      });

      setShortageRows(computedShortageRows);
      setTransferRows(computedTransferRows);
      setFinancialKpis(
        calculateFinancialKpis({
          expiryRows: computedExpiryRows,
          shortageRows: computedShortageRows,
          drugPriceMap: buildDrugPriceMap(),
        })
      );

      const queryErrors = [shortageRes.error, refillRes.error, expiryRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some operational data sources are unavailable. Executive insights below use the best available records."
        );
      }

      setLoading(false);
    };

    void load();
  }, []);

  const metrics = useMemo(
    () => buildExecutiveMetrics(shortageRows, transferRows),
    [shortageRows, transferRows]
  );

  const executiveNarrative = useMemo(
    () => buildExecutiveNarrative(metrics),
    [metrics]
  );

  const topHighRiskDrugs = useMemo(() => {
    return shortageRows
      .filter((row) => row.shortageRiskLevel === "high")
      .slice(0, 5);
  }, [shortageRows]);

  const topTransferOpportunities = useMemo(() => {
    return transferRows.slice(0, 5);
  }, [transferRows]);

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div>
          <div style={eyebrow}>Executive Intelligence</div>
          <h2 style={title}>PDSS Executive Dashboard</h2>
          <p style={subtitle}>
            A concise operational view of shortage pressure, internal balancing opportunities, and near-term supply risk.
          </p>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Tracked Drugs</div>
          <div style={statValue}>{metrics.trackedDrugs}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>High Risk Shortages</div>
          <div style={{ ...statValue, color: "#b91c1c" }}>{metrics.highRiskShortages}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Medium Risk Shortages</div>
          <div style={{ ...statValue, color: "#b45309" }}>{metrics.mediumRiskShortages}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Low Risk Shortages</div>
          <div style={{ ...statValue, color: "#166534" }}>{metrics.lowRiskShortages}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Transfer Opportunities</div>
          <div style={statValue}>{metrics.transferOpportunities}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Suggested Transfer Qty</div>
          <div style={statValue}>{metrics.totalSuggestedTransferQuantity}</div>
        </div>

        <div style={{ ...statCard, borderTop: "3px solid #f59e0b" }}>
          <div style={{ ...statLabel, color: "#92400e" }}>Expiry Loss (Est.)</div>
          <div style={{ ...statValue, fontSize: "22px", color: "#b45309" }}>
            {loading ? "—" : `AED ${financialKpis.estimatedExpiryLoss.toLocaleString()}`}
          </div>
        </div>

        <div style={{ ...statCard, borderTop: "3px solid #f59e0b" }}>
          <div style={{ ...statLabel, color: "#92400e" }}>At-Risk Inventory</div>
          <div style={{ ...statValue, fontSize: "22px", color: "#b45309" }}>
            {loading ? "—" : `AED ${financialKpis.atRiskInventoryValue.toLocaleString()}`}
          </div>
        </div>

        <div style={{ ...statCard, borderTop: "3px solid #ef4444" }}>
          <div style={{ ...statLabel, color: "#991b1b" }}>Shortage Exposure (High)</div>
          <div style={{ ...statValue, fontSize: "22px", color: "#b91c1c" }}>
            {loading ? "—" : `AED ${financialKpis.highRiskShortageExposure.toLocaleString()}`}
          </div>
        </div>
      </div>

      <div style={summaryCard}>
        <h3 style={sectionTitle}>Executive Summary</h3>
        <p style={summaryText}>
          {loading ? "Loading executive insight..." : executiveNarrative}
        </p>
      </div>

      <div style={tablesGrid}>
        <div style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Top High-Risk Drugs</h3>
          </div>

          {loading ? (
            <div style={emptyState}>Loading shortage priorities...</div>
          ) : topHighRiskDrugs.length === 0 ? (
            <div style={emptyState}>No high-risk drugs at the moment.</div>
          ) : (
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Drug Name</th>
                    <th style={th}>Current Stock</th>
                    <th style={th}>Avg Daily Usage</th>
                    <th style={th}>Days Left</th>
                    <th style={th}>Reorder Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {topHighRiskDrugs.map((row) => (
                    <tr key={row.drugName}>
                      <td style={tdDrug}>{row.drugName}</td>
                      <td style={td}>{row.currentStock}</td>
                      <td style={td}>{row.averageDailyUsage}</td>
                      <td style={td}>{row.daysLeft == null ? "N/A" : row.daysLeft}</td>
                      <td style={td}>{row.suggestedReorderQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Top Transfer Opportunities</h3>
          </div>

          {loading ? (
            <div style={emptyState}>Loading transfer opportunities...</div>
          ) : topTransferOpportunities.length === 0 ? (
            <div style={emptyState}>No transfer opportunities at the moment.</div>
          ) : (
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Drug Name</th>
                    <th style={th}>From</th>
                    <th style={th}>To</th>
                    <th style={th}>Qty</th>
                    <th style={th}>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {topTransferOpportunities.map((row, index) => (
                    <tr key={`${row.drugName}-${row.fromBranch}-${row.toBranch}-${index}`}>
                      <td style={tdDrug}>{row.drugName}</td>
                      <td style={td}>{row.fromBranch}</td>
                      <td style={td}>{row.toBranch}</td>
                      <td style={td}>{row.suggestedTransferQuantity}</td>
                      <td style={td}>
                        <span
                          style={{
                            ...badge,
                            ...(riskStyles[row.priority] || riskStyles.medium),
                          }}
                        >
                          {row.priority.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
  padding: "18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
};

const statLabel = {
  color: "#64748b",
  fontSize: "13px",
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

const sectionTitleLeft = {
  margin: 0,
  color: "#0f172a",
};

const summaryText = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.7,
  fontSize: "15px",
};

const tablesGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: "16px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  overflow: "hidden",
};

const tableHead = {
  padding: "18px 18px 0 18px",
};

const tableWrap = {
  width: "100%",
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "520px",
};

const th = {
  textAlign: "left",
  fontSize: "13px",
  color: "#334155",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  padding: "12px",
};

const td = {
  color: "#334155",
  padding: "12px",
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
