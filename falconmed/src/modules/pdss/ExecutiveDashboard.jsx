import { useEffect, useMemo, useState } from "react";
import SkeletonCard from "../../components/SkeletonCard";
import StatCard from "../../components/StatCard";
import { useAnimatedCounter } from "../../hooks/useAnimatedCounter";
import {
  buildExecutiveMetrics,
  buildExecutiveNarrative,
  calculateExpiryIntelligence,
  calculateFinancialKpis,
  calculateShortagePredictions,
  calculateSmartTransferRecommendations,
} from "../../utils/pdss";
import { buildDrugPriceMap } from "../../utils/drugPricing";
import { generateAiRecommendations } from "../../utils/recommendationEngine";
import { loadLocalArray, safeFetch } from "../../utils/pdssHelpers";
import { riskBadgeStyles } from "../../utils/badgeStyles";
import { subscribeInventoryUpdated } from "../../utils/inventoryEvents";

export default function ExecutiveDashboard() {
  const [shortageRows, setShortageRows] = useState([]);
  const [transferRows, setTransferRows] = useState([]);
  const [expiryRows, setExpiryRows] = useState([]);
  const [financialKpis, setFinancialKpis] = useState({
    estimatedExpiryLoss: 0,
    atRiskInventoryValue: 0,
    highRiskShortageExposure: 0,
  });
  const [inventoryFinancials, setInventoryFinancials] = useState({
    totalInventoryValue: 0,
    nearExpiryRiskValue: 0,
    deadStockValue: 0,
  });
  const [snapshotCounts, setSnapshotCounts] = useState({
    activeSites: 0,
    inventoryRecords: 0,
    nearExpiryItems: 0,
    shortageRequests: 0,
    purchaseRequests: 0,
    refillRequests: 0,
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const computeInventorySnapshot = (inventoryRows = []) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nearExpiryLimit = new Date(today);
    nearExpiryLimit.setDate(nearExpiryLimit.getDate() + 180);

    let totalInventoryValue = 0;
    let nearExpiryRiskValue = 0;
    let deadStockValue = 0;
    let nearExpiryItems = 0;
    const activeSites = new Set();

    (inventoryRows || []).forEach((row) => {
      const pharmacyId = String(row?.pharmacy_id || "").trim();
      if (pharmacyId) {
        activeSites.add(pharmacyId);
      }

      const qty = Number(row?.quantity || 0);
      const unitCost = Number(row?.unit_cost || 0);
      const lineValue = Math.max(0, qty) * Math.max(0, unitCost);
      totalInventoryValue += lineValue;

      const expiryRaw = row?.expiry_date;
      if (!expiryRaw) return;
      const expiryDate = new Date(expiryRaw);
      if (Number.isNaN(expiryDate.getTime())) return;

      if (expiryDate >= today && expiryDate <= nearExpiryLimit) {
        nearExpiryItems += 1;
        nearExpiryRiskValue += lineValue;
      }

      if (expiryDate < today) {
        deadStockValue += lineValue;
      }
    });

    return {
      activeSites: activeSites.size,
      nearExpiryItems,
      totalInventoryValue,
      nearExpiryRiskValue,
      deadStockValue,
    };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [
        shortageRes,
        refillRes,
        expiryRes,
        pharmacyRes,
        inventoryRes,
        purchaseRes,
      ] = await Promise.all([
        safeFetch(
          "shortage_requests",
          "drug_name,quantity_requested,status,request_date,created_at",
          3000
        ),
        safeFetch(
          "refill_requests",
          "drug_name,daily_usage,dispensed,quantity,request_date,created_at",
          3000
        ),
        safeFetch(
          "expiry_records",
          "drug_name,quantity,location,batch_no,expiry_date,created_at",
          3000
        ),
        safeFetch("pharmacies", "id,name", 3000),
        safeFetch(
          "pharmacy_inventory",
          "pharmacy_id,quantity,unit_cost,expiry_date",
          30000
        ),
        safeFetch("purchase_requests", "id,status,drug_name,created_at", 3000),
      ]);

      const localShortages = loadLocalArray("falconmed_shortages");
      const localRefills = loadLocalArray("falconmed_refills");

      const shortages = [...(shortageRes.data || []), ...localShortages];
      const refills = [...(refillRes.data || []), ...localRefills];
      const expiryRecords = expiryRes.data || [];
      const inventoryRecords = inventoryRes.data || [];
      const purchaseRequests = purchaseRes.data || [];
      const inventorySnapshot = computeInventorySnapshot(inventoryRecords);

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

      const drugPriceMap = buildDrugPriceMap();

      setShortageRows(computedShortageRows);
      setTransferRows(computedTransferRows);
      setExpiryRows(computedExpiryRows);

      setFinancialKpis(
        calculateFinancialKpis({
          expiryRows: computedExpiryRows,
          shortageRows: computedShortageRows,
          drugPriceMap,
        })
      );

      setInventoryFinancials({
        totalInventoryValue: inventorySnapshot.totalInventoryValue,
        nearExpiryRiskValue: inventorySnapshot.nearExpiryRiskValue,
        deadStockValue: inventorySnapshot.deadStockValue,
      });

      setSnapshotCounts({
        activeSites: inventorySnapshot.activeSites,
        inventoryRecords: inventoryRecords.length,
        nearExpiryItems: inventorySnapshot.nearExpiryItems,
        shortageRequests: shortages.length,
        purchaseRequests: purchaseRequests.length,
        refillRequests: refills.length,
      });

      const queryErrors = [
        shortageRes.error,
        refillRes.error,
        expiryRes.error,
        inventoryRes.error,
        purchaseRes.error,
      ].filter(Boolean);

      if (queryErrors.length > 0) {
        setMessage(
          "Some operational data sources are unavailable. Executive insights below use the best available records."
        );
      }

      setLoading(false);
    };

    void load();

    const unsubscribe = subscribeInventoryUpdated(() => {
      void load();
    });

    return unsubscribe;
  }, []);

  const metrics = useMemo(
    () => buildExecutiveMetrics(shortageRows, transferRows),
    [shortageRows, transferRows]
  );

  const executiveNarrative = useMemo(
    () =>
      buildExecutiveNarrative({
        ...metrics,
        activeSites: snapshotCounts.activeSites,
        inventoryRecords: snapshotCounts.inventoryRecords,
        nearExpiryItems: snapshotCounts.nearExpiryItems,
        purchaseRequests: snapshotCounts.purchaseRequests,
        refillRequests: snapshotCounts.refillRequests,
      }),
    [metrics, snapshotCounts]
  );

  const topHighRiskDrugs = useMemo(() => {
    return shortageRows.filter((row) => row.shortageRiskLevel === "high").slice(0, 5);
  }, [shortageRows]);

  const topTransferOpportunities = useMemo(() => {
    return transferRows.slice(0, 5);
  }, [transferRows]);

  const recommendations = useMemo(
    () =>
      generateAiRecommendations({
        shortageRows,
        transferRows,
        expiryRows,
        maxRecommendations: 3,
      }),
    [shortageRows, transferRows, expiryRows]
  );

  const animActiveSites = useAnimatedCounter(snapshotCounts.activeSites);
  const animInventoryRecords = useAnimatedCounter(snapshotCounts.inventoryRecords);
  const animNearExpiryItems = useAnimatedCounter(snapshotCounts.nearExpiryItems);
  const animShortageRequests = useAnimatedCounter(snapshotCounts.shortageRequests);
  const animPurchaseRequests = useAnimatedCounter(snapshotCounts.purchaseRequests);
  const animRefillRequests = useAnimatedCounter(snapshotCounts.refillRequests);

  const animTrackedDrugs = useAnimatedCounter(metrics.trackedDrugs);
  const animHighRisk = useAnimatedCounter(metrics.highRiskShortages);
  const animMedRisk = useAnimatedCounter(metrics.mediumRiskShortages);
  const animLowRisk = useAnimatedCounter(metrics.lowRiskShortages);
  const animTransferOpp = useAnimatedCounter(metrics.transferOpportunities);
  const animTransferQty = useAnimatedCounter(metrics.totalSuggestedTransferQuantity);
  const animExpiryLoss = useAnimatedCounter(financialKpis.estimatedExpiryLoss);
  const animAtRisk = useAnimatedCounter(financialKpis.atRiskInventoryValue);
  const animShortageExposure = useAnimatedCounter(financialKpis.highRiskShortageExposure);
  const animTotalInvValue = useAnimatedCounter(inventoryFinancials.totalInventoryValue);
  const animNearExpiryRisk = useAnimatedCounter(inventoryFinancials.nearExpiryRiskValue);
  const animDeadStock = useAnimatedCounter(inventoryFinancials.deadStockValue);

  const statusMeta = {
    stable: {
      label: "STABLE",
      accent: "#22c55e",
      badge: {
        color: "#166534",
        background: "#dcfce7",
        border: "1px solid #86efac",
      },
    },
    warning: {
      label: "WARNING",
      accent: "#f59e0b",
      badge: {
        color: "#92400e",
        background: "#fef3c7",
        border: "1px solid #fcd34d",
      },
    },
    critical: {
      label: "CRITICAL",
      accent: "#ef4444",
      badge: {
        color: "#991b1b",
        background: "#fee2e2",
        border: "1px solid #fca5a5",
      },
    },
  };

  const renderStatusCard = ({ label, value, status = "stable", valueStyle = statValue }) => {
    const currentStatus = statusMeta[status] || statusMeta.stable;

    return (
      <StatCard
        className="ui-hover-lift pdss-card"
        style={statCard}
        accentColor={currentStatus.accent}
        accentBorderWidth={3}
        label={
          <div style={cardHeaderRow}>
            <span style={statLabelInline}>{label}</span>
            <span style={{ ...statusBadge, ...currentStatus.badge }}>[ {currentStatus.label} ]</span>
          </div>
        }
        value={value}
        valueStyle={valueStyle}
      />
    );
  };

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div>
          <div style={eyebrow}>Executive Intelligence</div>
          <h2 style={title}>PDSS Executive Dashboard</h2>
          <p style={subtitle}>
            A concise operational view of shortage pressure, internal balancing
            opportunities, and near-term supply risk.
          </p>
        </div>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <SkeletonCard
              key={`snapshot-skeleton-${index}`}
              style={{ ...statCard, borderTop: "3px solid #e2e8f0", minHeight: 118 }}
              blocks={[
                { width: "54%", height: 10, gap: 12 },
                { width: "42%", height: 30, gap: 0 },
              ]}
            />
          ))
        ) : (
          <>
            {renderStatusCard({ label: "Active Sites", value: animActiveSites, status: "stable" })}
            {renderStatusCard({ label: "Inventory Records", value: animInventoryRecords, status: "stable" })}
            {renderStatusCard({ label: "Near Expiry Items", value: animNearExpiryItems, status: "warning" })}
            {renderStatusCard({ label: "Shortage Requests", value: animShortageRequests, status: "critical" })}
            {renderStatusCard({ label: "Purchase Requests", value: animPurchaseRequests, status: "warning" })}
            {renderStatusCard({ label: "Refill Requests", value: animRefillRequests, status: "stable" })}
          </>
        )}
      </div>

      <div style={statsGrid}>
        {loading
          ? Array.from({ length: 12 }).map((_, index) => (
              <SkeletonCard
                key={`pdss-stat-skeleton-${index}`}
                style={{ ...statCard, borderTop: "3px solid #e2e8f0", minHeight: 118 }}
                blocks={[
                  { width: "52%", height: 10, gap: 12 },
                  { width: index >= 6 ? "74%" : "48%", height: 30, gap: 0 },
                ]}
              />
            ))
          : (
            <>
              {renderStatusCard({ label: "Tracked Drugs", value: animTrackedDrugs, status: "stable" })}
              {renderStatusCard({
                label: "High Risk Shortages",
                value: animHighRisk,
                status: "critical",
                valueStyle: { ...statValue, color: "#b91c1c" },
              })}
              {renderStatusCard({
                label: "Medium Risk Shortages",
                value: animMedRisk,
                status: "warning",
                valueStyle: { ...statValue, color: "#b45309" },
              })}
              {renderStatusCard({
                label: "Low Risk Shortages",
                value: animLowRisk,
                status: "stable",
                valueStyle: { ...statValue, color: "#166534" },
              })}
              {renderStatusCard({ label: "Transfer Opportunities", value: animTransferOpp, status: "warning" })}
              {renderStatusCard({ label: "Suggested Transfer Qty", value: animTransferQty, status: "warning" })}
              {renderStatusCard({
                label: "Expiry Loss (Est.)",
                value: `AED ${animExpiryLoss.toLocaleString()}`,
                status: "critical",
                valueStyle: { ...statValue, fontSize: "22px", color: "#b45309" },
              })}
              {renderStatusCard({
                label: "At-Risk Inventory",
                value: `AED ${animAtRisk.toLocaleString()}`,
                status: "warning",
                valueStyle: { ...statValue, fontSize: "22px", color: "#b45309" },
              })}
              {renderStatusCard({
                label: "Shortage Exposure (High)",
                value: `AED ${animShortageExposure.toLocaleString()}`,
                status: "critical",
                valueStyle: { ...statValue, fontSize: "22px", color: "#b91c1c" },
              })}
              {renderStatusCard({
                label: "Total Inventory Value",
                value: `AED ${animTotalInvValue.toLocaleString()}`,
                status: "stable",
                valueStyle: { ...statValue, fontSize: "22px", color: "#075985" },
              })}
              {renderStatusCard({
                label: "Near-Expiry Risk Value",
                value: `AED ${animNearExpiryRisk.toLocaleString()}`,
                status: "warning",
                valueStyle: { ...statValue, fontSize: "22px", color: "#b45309" },
              })}
              {renderStatusCard({
                label: "Dead Stock Value",
                value: `AED ${animDeadStock.toLocaleString()}`,
                status: "critical",
                valueStyle: { ...statValue, fontSize: "22px", color: "#991b1b" },
              })}
            </>
          )}
      </div>

      <div className="ui-hover-lift pdss-card stable" style={{ ...summaryCard, borderTop: "3px solid #22c55e" }}>
        {loading ? (
          <SkeletonCard
            style={{
              background: "transparent",
              border: "none",
              boxShadow: "none",
              padding: 0,
              minHeight: 88,
            }}
            blocks={[
              { width: "26%", height: 16, gap: 16, radius: 10 },
              { width: "100%", height: 12, gap: 10, radius: 10 },
              { width: "94%", height: 12, gap: 10, radius: 10 },
              { width: "88%", height: 12, gap: 0, radius: 10 },
            ]}
          />
        ) : (
          <>
            <div style={sectionHeaderRow}>
              <h3 style={sectionTitle}>Executive Summary</h3>
              <span style={{ ...statusBadge, ...statusMeta.stable.badge }}>[ {statusMeta.stable.label} ]</span>
            </div>
            <p style={summaryText}>{executiveNarrative}</p>
          </>
        )}
      </div>

      <div className="ui-hover-lift pdss-card warning" style={{ ...summaryCard, borderTop: "3px solid #f59e0b" }}>
        {loading ? (
          <SkeletonCard
            style={{
              background: "transparent",
              border: "none",
              boxShadow: "none",
              padding: 0,
              minHeight: 96,
            }}
            blocks={[
              { width: "34%", height: 16, gap: 14, radius: 10 },
              { width: "100%", height: 14, gap: 10, radius: 10 },
              { width: "92%", height: 14, gap: 10, radius: 10 },
              { width: "96%", height: 14, gap: 0, radius: 10 },
            ]}
          />
        ) : (
          <>
            <div style={sectionHeaderRow}>
              <h3 style={sectionTitle}>FalconMed Recommendations</h3>
              <span style={{ ...statusBadge, ...statusMeta.warning.badge }}>[ {statusMeta.warning.label} ]</span>
            </div>
            {recommendations.length === 0 ? (
              <p style={summaryText}>No recommendation is available from current operational data.</p>
            ) : (
              <div style={recommendationList}>
                {recommendations.map((item, index) => (
                  <div key={`${item.kind}-${index}`} style={recommendationItem}>
                    <div style={recommendationTitle}>{item.title}</div>
                    <div style={recommendationAction}>{item.action}</div>
                    <div style={recommendationReason}>Reason: {item.reason}</div>
                    <div style={recommendationSaving}>
                      Estimated saving: AED {Number(item.estimatedFinancialImpact || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={tablesGrid}>
        <div className="ui-hover-lift pdss-card critical" style={{ ...tableCard, borderTop: "3px solid #ef4444" }}>
          <div style={tableHead}>
            <div style={sectionHeaderRow}>
              <h3 style={sectionTitleLeft}>Top High-Risk Drugs</h3>
              <span style={{ ...statusBadge, ...statusMeta.critical.badge }}>[ {statusMeta.critical.label} ]</span>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "18px" }}>
              <SkeletonCard
                style={{
                  background: "transparent",
                  border: "none",
                  boxShadow: "none",
                  padding: 0,
                  minHeight: 212,
                }}
                blocks={[
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 0, radius: 10 },
                ]}
              />
            </div>
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

        <div className="ui-hover-lift pdss-card warning" style={{ ...tableCard, borderTop: "3px solid #f59e0b" }}>
          <div style={tableHead}>
            <div style={sectionHeaderRow}>
              <h3 style={sectionTitleLeft}>Top Transfer Opportunities</h3>
              <span style={{ ...statusBadge, ...statusMeta.warning.badge }}>[ {statusMeta.warning.label} ]</span>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "18px" }}>
              <SkeletonCard
                style={{
                  background: "transparent",
                  border: "none",
                  boxShadow: "none",
                  padding: 0,
                  minHeight: 212,
                }}
                blocks={[
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 10, radius: 10 },
                  { width: "100%", height: 34, gap: 0, radius: 10 },
                ]}
              />
            </div>
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
                    <tr
                      key={`${row.drugName}-${row.fromBranch}-${row.toBranch}-${index}`}
                    >
                      <td style={tdDrug}>{row.drugName}</td>
                      <td style={td}>{row.fromBranch}</td>
                      <td style={td}>{row.toBranch}</td>
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

const statLabelInline = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const cardHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  marginBottom: "8px",
};

const sectionHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "10px",
};

const statusBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "11px",
  fontWeight: 600,
  padding: "3px 8px",
  borderRadius: "999px",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
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
  marginBottom: 0,
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

const recommendationList = {
  display: "grid",
  gap: "12px",
};

const recommendationItem = {
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "12px 14px",
  background: "#f8fafc",
};

const recommendationTitle = {
  color: "#0f172a",
  fontWeight: 700,
  marginBottom: "4px",
};

const recommendationAction = {
  color: "#1e293b",
  fontSize: "14px",
  marginBottom: "4px",
};

const recommendationReason = {
  color: "#475569",
  fontSize: "13px",
};

const recommendationSaving = {
  marginTop: "6px",
  color: "#0f766e",
  fontSize: "13px",
  fontWeight: 700,
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