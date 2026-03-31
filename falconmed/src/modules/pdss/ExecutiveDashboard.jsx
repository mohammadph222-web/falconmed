import { useEffect, useMemo, useState } from "react";
import SkeletonCard from "../../components/SkeletonCard";
import StatCard from "../../components/StatCard";
import { useAnimatedCounter } from "../../hooks/useAnimatedCounter";
import {
  buildExecutiveMetrics,
  buildExecutiveNarrative,
  calculateExpiryIntelligence,
  calculateFinancialKpis,
  calculateInventoryFinancials,
  calculateShortagePredictions,
  calculateSmartTransferRecommendations,
} from "../../utils/pdss";
import { buildDrugPriceMap } from "../../utils/drugPricing";
import { loadLocalArray, safeFetch } from "../../utils/pdssHelpers";
import { riskBadgeStyles } from "../../utils/badgeStyles";

export default function ExecutiveDashboard() {
  const [shortageRows, setShortageRows] = useState([]);
  const [transferRows, setTransferRows] = useState([]);
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
          "id,drug_name,quantity,unit_cost,expiry_date,batch_no,pharmacy_id",
          3000
        ),
        safeFetch("purchase_requests", "id,status,drug_name,created_at", 3000),
      ]);

      const localShortages = loadLocalArray("falconmed_shortages");
      const localRefills = loadLocalArray("falconmed_refills");

      const shortages = [...(shortageRes.data || []), ...localShortages];
      const refills = [...(refillRes.data || []), ...localRefills];
      const expiryRecords = expiryRes.data || [];
      const pharmacies = pharmacyRes.data || [];
      const inventoryRecords = inventoryRes.data || [];
      const purchaseRequests = purchaseRes.data || [];

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

      setFinancialKpis(
        calculateFinancialKpis({
          expiryRows: computedExpiryRows,
          shortageRows: computedShortageRows,
          drugPriceMap,
        })
      );

      setInventoryFinancials(
        calculateInventoryFinancials({
          expiryRows: computedExpiryRows,
          drugPriceMap,
        })
      );

      setSnapshotCounts({
        activeSites: pharmacies.length,
        inventoryRecords: inventoryRecords.length,
        nearExpiryItems: expiryRecords.length,
        shortageRequests: shortages.length,
        purchaseRequests: purchaseRequests.length,
        refillRequests: refills.length,
      });

      const queryErrors = [
        shortageRes.error,
        refillRes.error,
        expiryRes.error,
        pharmacyRes.error,
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
            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#3b82f6"
              label="Active Sites"
              value={animActiveSites}
              labelStyle={statLabel}
              valueStyle={statValue}
            />

            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#8b5cf6"
              label="Inventory Records"
              value={animInventoryRecords}
              labelStyle={statLabel}
              valueStyle={statValue}
            />

            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#f59e0b"
              label="Near Expiry Items"
              value={animNearExpiryItems}
              labelStyle={statLabel}
              valueStyle={statValue}
            />

            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#ef4444"
              label="Shortage Requests"
              value={animShortageRequests}
              labelStyle={statLabel}
              valueStyle={statValue}
            />

            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#10b981"
              label="Purchase Requests"
              value={animPurchaseRequests}
              labelStyle={statLabel}
              valueStyle={statValue}
            />

            <StatCard
              className="ui-hover-lift"
              style={statCard}
              accentColor="#06b6d4"
              label="Refill Requests"
              value={animRefillRequests}
              labelStyle={statLabel}
              valueStyle={statValue}
            />
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
              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="Tracked Drugs"
                value={animTrackedDrugs}
                labelStyle={statLabel}
                valueStyle={statValue}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="High Risk Shortages"
                value={animHighRisk}
                labelStyle={statLabel}
                valueStyle={{ ...statValue, color: "#b91c1c" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="Medium Risk Shortages"
                value={animMedRisk}
                labelStyle={statLabel}
                valueStyle={{ ...statValue, color: "#b45309" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="Low Risk Shortages"
                value={animLowRisk}
                labelStyle={statLabel}
                valueStyle={{ ...statValue, color: "#166534" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="Transfer Opportunities"
                value={animTransferOpp}
                labelStyle={statLabel}
                valueStyle={statValue}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                label="Suggested Transfer Qty"
                value={animTransferQty}
                labelStyle={statLabel}
                valueStyle={statValue}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#f59e0b"
                label="Expiry Loss (Est.)"
                value={`AED ${animExpiryLoss.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#92400e" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#b45309" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#f59e0b"
                label="At-Risk Inventory"
                value={`AED ${animAtRisk.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#92400e" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#b45309" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#ef4444"
                label="Shortage Exposure (High)"
                value={`AED ${animShortageExposure.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#991b1b" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#b91c1c" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#0ea5e9"
                label="Total Inventory Value"
                value={`AED ${animTotalInvValue.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#0369a1" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#075985" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#f59e0b"
                label="Near-Expiry Risk Value"
                value={`AED ${animNearExpiryRisk.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#92400e" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#b45309" }}
              />

              <StatCard
                className="ui-hover-lift"
                style={statCard}
                accentColor="#dc2626"
                label="Dead Stock Value"
                value={`AED ${animDeadStock.toLocaleString()}`}
                labelStyle={{ ...statLabel, color: "#991b1b" }}
                valueStyle={{ ...statValue, fontSize: "22px", color: "#991b1b" }}
              />
            </>
          )}
      </div>

      <div className="ui-hover-lift" style={summaryCard}>
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
            <h3 style={sectionTitle}>Executive Summary</h3>
            <p style={summaryText}>{executiveNarrative}</p>
          </>
        )}
      </div>

      <div style={tablesGrid}>
        <div className="ui-hover-lift" style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Top High-Risk Drugs</h3>
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

        <div className="ui-hover-lift" style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Top Transfer Opportunities</h3>
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