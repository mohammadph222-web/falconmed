import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import WorkspacePharmacySelector from "./components/WorkspacePharmacySelector";
import {
  resolveWorkspacePharmacies,
  resolveWorkspaceSelection,
  writeWorkspacePharmacyId,
} from "./lib/workspacePharmacy";
import { formatAed, formatQty, isNearExpiry } from "./utils/inventoryAnalytics";
import { MetricCard, PageHeader, StatusPill } from "./ui";

function isLowStock(value) {
  const qty = Number(value || 0);
  return Number.isFinite(qty) && qty > 0 && qty <= 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMovementTone(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("receive") || t.includes("in")) return "positive";
  if (t.includes("dispense") || t.includes("out") || t.includes("remove")) return "negative";
  return "neutral";
}

function getMovementCategory(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("dispense") || t.includes("out") || t.includes("remove")) return "DISPENSE";
  if (t.includes("receive") || t.includes("in")) return "RECEIVE";
  if (t.includes("import") || t.includes("upload") || t.includes("bulk")) return "IMPORT";
  return "MOVEMENT";
}

function formatMovementTime(value) {
  if (!value) return "No timestamp";
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return "No timestamp";

  const now = Date.now();
  const diffMs = now - ts.getTime();
  const min = Math.floor(diffMs / 60000);
  const hrs = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  if (hrs < 24) return `${hrs} hr ago`;
  if (days < 7) return `${days} day ago`;
  return ts.toLocaleDateString();
}

export default function SinglePharmacyDashboard() {
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [inventoryRows, setInventoryRows] = useState([]);
  const [recentMovements, setRecentMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");

      try {
        if (!supabase) {
          const options = resolveWorkspacePharmacies([]);
          setPharmacies(options);
          const selected = resolveWorkspaceSelection(options, "");
          setSelectedPharmacyId(selected);
          setInventoryRows([]);
          setRecentMovements([]);
          return;
        }

        const [{ data: pharmacyRows }, { data: inventory }, { data: movements }] = await Promise.all([
          supabase.from("pharmacies").select("id,name,location").order("name", { ascending: true }),
          supabase
            .from("pharmacy_inventory")
            .select("pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
            .order("created_at", { ascending: false })
            .limit(5000),
          supabase
            .from("stock_movements")
            .select("id,movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

        const options = resolveWorkspacePharmacies(pharmacyRows || []);
        const selected = resolveWorkspaceSelection(options, selectedPharmacyId);
        setPharmacies(options);
        setSelectedPharmacyId(selected);

        const filteredInventory = (inventory || []).filter(
          (row) => String(row?.pharmacy_id || "").trim() === selected
        );

        const selectedName = options.find((option) => option.id === selected)?.name || "";

        const filteredMovements = (movements || []).filter((row) => {
          const fromName = String(row?.from_pharmacy || "").trim();
          const toName = String(row?.to_pharmacy || "").trim();
          if (!selectedName) return false;
          return fromName === selectedName || toName === selectedName;
        });

        setInventoryRows(filteredInventory);
        setRecentMovements(filteredMovements.slice(0, 8));
      } catch {
        setError("Unable to load single pharmacy dashboard right now.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const onSelectPharmacy = (pharmacyId) => {
    setSelectedPharmacyId(pharmacyId);
    writeWorkspacePharmacyId(pharmacyId);

    if (!supabase) return;

    const loadForPharmacy = async () => {
      setLoading(true);
      try {
        const [{ data: inventory }, { data: movements }] = await Promise.all([
          supabase
            .from("pharmacy_inventory")
            .select("pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
            .eq("pharmacy_id", pharmacyId)
            .order("created_at", { ascending: false })
            .limit(5000),
          supabase
            .from("stock_movements")
            .select("id,movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

        const selectedName = pharmacies.find((item) => item.id === pharmacyId)?.name || "";
        const filteredMovements = (movements || []).filter((row) => {
          const fromName = String(row?.from_pharmacy || "").trim();
          const toName = String(row?.to_pharmacy || "").trim();
          if (!selectedName) return false;
          return fromName === selectedName || toName === selectedName;
        });

        setInventoryRows(inventory || []);
        setRecentMovements(filteredMovements.slice(0, 8));
      } catch {
        setError("Unable to refresh selected pharmacy data.");
      } finally {
        setLoading(false);
      }
    };

    void loadForPharmacy();
  };

  const metrics = useMemo(() => {
    const totalQty = inventoryRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
    const totalValue = inventoryRows.reduce(
      (sum, row) => sum + Number(row?.quantity || 0) * Number(row?.unit_cost || 0),
      0
    );
    const nearExpiryCount = inventoryRows.reduce(
      (sum, row) => sum + (isNearExpiry(row?.expiry_date) ? 1 : 0),
      0
    );
    const lowStockCount = inventoryRows.reduce(
      (sum, row) => sum + (isLowStock(row?.quantity) ? 1 : 0),
      0
    );

    return {
      totalQty,
      totalValue,
      nearExpiryCount,
      lowStockCount,
    };
  }, [inventoryRows]);

  const executiveSignals = useMemo(() => {
    const totalRows = inventoryRows.length;
    const lowRatio = totalRows > 0 ? metrics.lowStockCount / totalRows : 0;
    const expiryRatio = totalRows > 0 ? metrics.nearExpiryCount / totalRows : 0;

    const healthScore = clamp(Math.round(100 - lowRatio * 45 - expiryRatio * 55), 0, 100);

    let riskLabel = "Low";
    if (healthScore < 55) riskLabel = "High";
    else if (healthScore < 75) riskLabel = "Moderate";

    return {
      healthScore,
      riskLabel,
      totalRows,
      monitoredPressure: Math.round((lowRatio + expiryRatio) * 100),
    };
  }, [inventoryRows.length, metrics.lowStockCount, metrics.nearExpiryCount]);

  const activePharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || null,
    [pharmacies, selectedPharmacyId]
  );

  const activePharmacyName = activePharmacy?.name || "No pharmacy selected";
  const activePharmacyLocation = activePharmacy?.location || "Location unavailable";

  const inventoryCoverage = useMemo(() => {
    if (!executiveSignals.totalRows) return "0%";
    const healthyRows = Math.max(
      executiveSignals.totalRows - metrics.lowStockCount - metrics.nearExpiryCount,
      0
    );
    const pct = Math.round((healthyRows / executiveSignals.totalRows) * 100);
    return `${pct}%`;
  }, [executiveSignals.totalRows, metrics.lowStockCount, metrics.nearExpiryCount]);

  const healthTone =
    executiveSignals.riskLabel === "Low"
      ? healthToneLow
      : executiveSignals.riskLabel === "Moderate"
      ? healthToneModerate
      : healthToneHigh;

  return (
    <div style={pageWrap}>
      <div style={heroCard}>
        <div style={heroGlow} />
        <div style={heroContent}>
          <div style={heroTopBar}>
            <div style={heroEyebrow}>Operations Command</div>
            <span style={heroLivePill}>Live Monitoring</span>
          </div>
          <h1 style={heroTitle}>Pharmacy Mission Control</h1>
          <p style={heroSub}>
            Live operational command center for stock posture, movement velocity, and risk diagnostics.
          </p>

          <div style={heroMetaRow}>
            <div style={heroMetaChip}>
              <span style={heroMetaLabel}>Active Site</span>
              <span style={heroMetaValue}>{activePharmacyName}</span>
            </div>
            <div style={heroMetaChip}>
              <span style={heroMetaLabel}>Location</span>
              <span style={heroMetaValue}>{activePharmacyLocation}</span>
            </div>
            <div style={heroMetaChip}>
              <span style={heroMetaLabel}>Inventory Lines</span>
              <span style={heroMetaValue}>{formatQty(executiveSignals.totalRows)}</span>
            </div>
            <div style={heroMetaChip}>
              <span style={heroMetaLabel}>Coverage</span>
              <span style={heroMetaValue}>{inventoryCoverage}</span>
            </div>
            <div style={{ ...heroMetaChip, ...healthTone }}>
              <span style={heroMetaLabel}>System Health</span>
              <span style={heroMetaValue}>{executiveSignals.riskLabel}</span>
            </div>
          </div>
        </div>

        <div style={selectorWrap}>
          <WorkspacePharmacySelector
            options={pharmacies}
            value={selectedPharmacyId}
            onChange={onSelectPharmacy}
            label="Active Pharmacy"
          />
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <PageHeader
        title="Executive Snapshot"
        subtitle="High-signal inventory KPIs for immediate leadership scanning."
        style={sectionHeaderRow}
      />

      <div style={kpiGrid}>
        <MetricCard
          className="ui-hover-lift"
          accent="primary"
          icon="QTY"
          label="Total Stock Qty"
          meta="Units"
          value={formatQty(metrics.totalQty)}
          helper="All tracked quantities in active inventory"
        />

        <MetricCard
          className="ui-hover-lift"
          accent="info"
          icon="AED"
          label="Total Stock Value"
          meta="AED"
          value={formatAed(metrics.totalValue)}
          helper="Book value from quantity x unit cost"
        />

        <MetricCard
          className="ui-hover-lift"
          accent="warning"
          icon="EXP"
          label="Near Expiry"
          meta="Risk"
          value={formatQty(metrics.nearExpiryCount)}
          helper="Lines approaching expiry threshold"
        />

        <MetricCard
          className="ui-hover-lift"
          accent="danger"
          icon="LOW"
          label="Low Stock"
          meta="Watchlist"
          value={formatQty(metrics.lowStockCount)}
          helper="Rows at or below operational low-stock level"
        />
      </div>

      {loading ? (
        <div style={kpiGrid}>
          <div style={skeletonCard} />
          <div style={skeletonCard} />
          <div style={skeletonCard} />
          <div style={skeletonCard} />
        </div>
      ) : null}

      <div style={sectionHeaderRow}>
        <div>
          <h2 style={sectionTitle}>Operational Intelligence</h2>
          <p style={sectionSub}>Executive scoring and exposure view for proactive decisions.</p>
        </div>
      </div>

      <div style={intelligenceGrid}>
        <div style={intelligenceCard} className="ui-hover-lift">
          <div style={intelHeaderRow}>
            <div style={kpiLabel}>Inventory Health Score</div>
            <div style={intelBadge}>Composite</div>
          </div>

          <div style={healthScoreRow}>
            <div style={healthScoreValue}>{executiveSignals.healthScore}</div>
            <div style={healthScoreMeta}>/ 100</div>
          </div>

          <div style={meterWrap}>
            <div style={{ ...meterFill, width: `${executiveSignals.healthScore}%` }} />
          </div>

          <div style={intelligenceHint}>
            Blended score from low-stock and near-expiry pressure across monitored rows.
          </div>
          <div style={diagnosticLine}>
            Diagnostic: Score continuously recalculates from live inventory risk signals.
          </div>
        </div>

        <div style={intelligenceCard} className="ui-hover-lift">
          <div style={intelHeaderRow}>
            <div style={kpiLabel}>Operational Risk</div>
            <div style={intelBadge}>Exposure</div>
          </div>

          <div style={riskPillRow}>
            <StatusPill
              variant={
                executiveSignals.riskLabel === "Low"
                  ? "success"
                  : executiveSignals.riskLabel === "Moderate"
                  ? "warning"
                  : "danger"
              }
            >
              {executiveSignals.riskLabel}
            </StatusPill>
          </div>

          <div style={riskStatRow}>
            <div style={riskStatCard}>
              <div style={riskStatLabel}>Pressure Index</div>
              <div style={riskStatValue}>{executiveSignals.monitoredPressure}%</div>
            </div>
            <div style={riskStatCard}>
              <div style={riskStatLabel}>Coverage</div>
              <div style={riskStatValue}>{formatQty(executiveSignals.totalRows)}</div>
            </div>
          </div>

          <div style={intelligenceHint}>
            Risk tier adjusts dynamically as shortage and expiry pressure shifts.
          </div>
          <div style={diagnosticLine}>
            Monitoring: Alerts intensify as pressure index rises beyond safe operating thresholds.
          </div>
        </div>
      </div>

      <div style={sectionHeaderRow}>
        <div>
          <h2 style={sectionTitle}>Execution Workspace</h2>
          <p style={sectionSub}>Real-time activity feed and workflow shortcuts for daily operations.</p>
        </div>
      </div>

      <div style={contentGrid}>
        <div style={panel}>
          <div style={panelHeadRow}>
            <h3 style={panelTitle}>Recent Stock Movements</h3>
            <div style={panelMeta}>Last 8 events</div>
          </div>

          {loading ? (
            <div style={empty}>Loading recent movements...</div>
          ) : recentMovements.length === 0 ? (
            <div style={empty}>No recent movement found for the selected pharmacy.</div>
          ) : (
            <div style={listWrap} className="movements-feed">
              {recentMovements.map((item) => {
                const tone = getMovementTone(item.movement_type);
                const category = getMovementCategory(item.movement_type);
                return (
                  <div
                    key={item.id}
                    style={{
                      ...listItem,
                      ...(tone === "positive"
                        ? movementItemPositive
                        : tone === "negative"
                        ? movementItemNegative
                        : movementItemNeutral),
                    }}
                    className="movements-feed-item"
                  >
                    <div style={movementTopRow}>
                      <span
                        style={{
                          ...movementTypePill,
                          ...(tone === "positive"
                            ? movementTypePositive
                            : tone === "negative"
                            ? movementTypeNegative
                            : movementTypeNeutral),
                        }}
                      >
                        {category}
                      </span>

                      <span style={movementTime}>{formatMovementTime(item.created_at)}</span>
                    </div>

                    <div style={movementDrug}>{item.drug_name || "-"}</div>

                    <div style={movementBottomRow}>
                      <span style={movementSubType}>{item.movement_type || "Movement"}</span>
                      <span style={movementQty}>Qty {formatQty(item.quantity || 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={panel}>
          <div style={panelHeadRow}>
            <h3 style={panelTitle}>Action Center</h3>
            <div style={panelMeta}>Workflow shortcuts</div>
          </div>

          <div style={quickGrid}>
            <div style={quickCard} className="quick-action-item">
              <div style={quickIcon}>IN</div>
              <div>
                <div style={quickText}>Receive Stock</div>
                <div style={quickSub}>Capture inbound stock with batch and expiry controls</div>
              </div>
              <span style={quickMeta}>Open</span>
            </div>

            <div style={quickCard} className="quick-action-item">
              <div style={quickIcon}>OUT</div>
              <div>
                <div style={quickText}>Dispense Inventory</div>
                <div style={quickSub}>Issue medication from live inventory lines</div>
              </div>
              <span style={quickMeta}>Open</span>
            </div>

            <div style={quickCard} className="quick-action-item">
              <div style={quickIcon}>RISK</div>
              <div>
                <div style={quickText}>Review Low Stock</div>
                <div style={quickSub}>Prioritize shortages and near-expiry exposure</div>
              </div>
              <span style={quickMeta}>Review</span>
            </div>

            <div style={quickCard} className="quick-action-item">
              <div style={quickIcon}>OPS</div>
              <div>
                <div style={quickText}>Open Inventory Overview</div>
                <div style={quickSub}>Launch full inventory operations workflow</div>
              </div>
              <span style={quickMeta}>Go</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const tokens = {
  bg: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  borderSoft: "#edf2f7",
  text: "#0f172a",
  muted: "#475569",
  subtle: "#64748b",
  primary: "#2563eb",
};

const pageWrap = {
  display: "grid",
  gap: "18px",
  padding: "8px 6px 18px",
  background: tokens.bg,
  borderRadius: "18px",
};

const heroCard = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "minmax(360px, 1fr) minmax(250px, 320px)",
  alignItems: "center",
  gap: "16px",
  background: "linear-gradient(132deg, #1d4ed8 0%, #2563eb 46%, #3b82f6 100%)",
  color: tokens.text,
  borderRadius: "18px",
  padding: "18px 20px",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 18px 34px rgba(15, 23, 42, 0.13)",
  overflow: "hidden",
};

const heroGlow = {
  position: "absolute",
  right: "-140px",
  top: "-120px",
  width: "320px",
  height: "320px",
  borderRadius: "999px",
  background: "radial-gradient(circle, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0) 70%)",
  pointerEvents: "none",
};

const heroTopBar = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  marginBottom: "2px",
};

const heroEyebrow = {
  marginBottom: "6px",
  fontSize: "10px",
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "rgba(255, 255, 255, 0.80)",
};

const heroLivePill = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#ecfeff",
  border: "1px solid rgba(255,255,255,0.32)",
  background: "rgba(15, 23, 42, 0.18)",
  borderRadius: "999px",
  padding: "4px 8px",
  whiteSpace: "nowrap",
};

const heroContent = {
  position: "relative",
  zIndex: 1,
  minWidth: "250px",
};

const heroTitle = {
  margin: 0,
  fontSize: "32px",
  lineHeight: 1.12,
  letterSpacing: "-0.02em",
  color: "#ffffff",
  fontWeight: 780,
};

const heroSub = {
  marginTop: "8px",
  marginBottom: "12px",
  color: "rgba(255, 255, 255, 0.90)",
  fontSize: "13.5px",
  lineHeight: 1.5,
  maxWidth: "620px",
};

const heroMetaRow = {
  display: "flex",
  gap: "9px",
  flexWrap: "wrap",
};

const heroMetaChip = {
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.24)",
  borderRadius: "11px",
  padding: "8px 10px",
  display: "grid",
  minWidth: "140px",
};

const heroMetaLabel = {
  fontSize: "10px",
  color: "rgba(255,255,255,0.78)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const heroMetaValue = {
  marginTop: "2px",
  color: "#ffffff",
  fontSize: "13.5px",
  fontWeight: 700,
};

const healthToneLow = {
  background: "rgba(34, 197, 94, 0.20)",
  border: "1px solid rgba(134, 239, 172, 0.55)",
};

const healthToneModerate = {
  background: "rgba(245, 158, 11, 0.22)",
  border: "1px solid rgba(253, 224, 71, 0.58)",
};

const healthToneHigh = {
  background: "rgba(239, 68, 68, 0.22)",
  border: "1px solid rgba(252, 165, 165, 0.60)",
};

const selectorWrap = {
  position: "relative",
  zIndex: 1,
  minWidth: "220px",
  maxWidth: "320px",
  justifySelf: "end",
  padding: "11px 12px",
  borderRadius: "12px",
  border: `1px solid ${tokens.borderSoft}`,
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  boxShadow: "0 10px 22px rgba(15, 23, 42, 0.14)",
};

const errorBox = {
  borderRadius: "12px",
  padding: "10px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  boxShadow: "inset 3px 0 0 #dc2626",
};

const sectionHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: "14px",
  marginTop: "3px",
};

const sectionTitle = {
  margin: 0,
  fontSize: "18px",
  color: "#0f172a",
  letterSpacing: "-0.012em",
  fontWeight: 760,
};

const sectionSub = {
  margin: "5px 0 0",
  color: "#64748b",
  fontSize: "13px",
  lineHeight: 1.5,
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "13px",
};

const kpiCard = {
  position: "relative",
  background: tokens.card,
  borderRadius: "15px",
  border: "1px solid #e5ecf6",
  padding: "16px 16px 15px",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.055)",
  overflow: "hidden",
};

const kpiTonePrimary = {
  borderTop: "3px solid #2563eb",
};

const kpiToneNeutral = {
  borderTop: "3px solid #0ea5e9",
};

const kpiToneWarning = {
  borderTop: "3px solid #f59e0b",
};

const kpiToneAlert = {
  borderTop: "3px solid #ef4444",
};

const kpiTopRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const kpiTitleRow = {
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
};

const kpiIcon = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "28px",
  height: "19px",
  borderRadius: "999px",
  border: "1px solid #dbeafe",
  background: "#f3f8ff",
  color: "#1d4ed8",
  fontSize: "9px",
  fontWeight: 800,
  letterSpacing: "0.05em",
  lineHeight: 1,
};

const kpiLabel = {
  fontSize: "10.5px",
  color: "#7589a3",
  textTransform: "uppercase",
  fontWeight: 700,
  letterSpacing: "0.08em",
};

const kpiMicro = {
  fontSize: "10px",
  color: "#7b8ea7",
  fontWeight: 700,
  letterSpacing: "0.05em",
};

const kpiValue = {
  marginTop: "9px",
  fontSize: "33px",
  fontWeight: 780,
  color: tokens.text,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.022em",
  lineHeight: 1.05,
};

const kpiHint = {
  marginTop: "8px",
  color: "#64748b",
  fontSize: "12px",
  lineHeight: 1.4,
};

const skeletonCard = {
  borderRadius: "14px",
  minHeight: "102px",
  border: "1px solid #e7edf5",
  background: "linear-gradient(110deg, #f8fbff 8%, #eef3fa 18%, #f8fbff 33%)",
  backgroundSize: "200% 100%",
  boxShadow: "0 8px 16px rgba(15, 23, 42, 0.03)",
};

const intelligenceGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "13px",
};

const intelligenceCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  border: `1px solid ${tokens.border}`,
  borderRadius: "15px",
  padding: "15px 16px",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.055)",
  display: "grid",
  gap: "9px",
};

const intelHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const intelBadge = {
  fontSize: "10px",
  color: "#1d4ed8",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "999px",
  padding: "3px 8px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const healthScoreRow = {
  display: "flex",
  alignItems: "end",
  gap: "8px",
};

const healthScoreValue = {
  fontSize: "38px",
  lineHeight: 1,
  color: "#0f172a",
  letterSpacing: "-0.028em",
  fontWeight: 780,
};

const healthScoreMeta = {
  fontSize: "12px",
  color: "#64748b",
  fontWeight: 650,
  marginBottom: "5px",
};

const meterWrap = {
  width: "100%",
  height: "8px",
  borderRadius: "999px",
  background: "#eaf1fb",
  overflow: "hidden",
};

const meterFill = {
  height: "100%",
  borderRadius: "999px",
  background: "linear-gradient(90deg, #22c55e 0%, #84cc16 35%, #f59e0b 70%, #ef4444 100%)",
};

const intelligenceHint = {
  color: "#5b6b81",
  fontSize: "12.8px",
  lineHeight: 1.5,
};

const diagnosticLine = {
  marginTop: "2px",
  fontSize: "11px",
  color: "#64748b",
  borderTop: "1px dashed #e2e8f0",
  paddingTop: "6px",
};

const riskPillRow = {
  display: "flex",
  alignItems: "center",
};

const riskPill = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 11px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 760,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
};

const riskPillLow = {
  color: "#166534",
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
};

const riskPillModerate = {
  color: "#92400e",
  background: "#fffbeb",
  border: "1px solid #fde68a",
};

const riskPillHigh = {
  color: "#991b1b",
  background: "#fef2f2",
  border: "1px solid #fecaca",
};

const riskStatRow = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
};

const riskStatCard = {
  border: "1px solid #e8eef7",
  borderRadius: "10px",
  padding: "7px 9px",
  background: "#f8fbff",
};

const riskStatLabel = {
  fontSize: "10px",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 700,
};

const riskStatValue = {
  marginTop: "2px",
  fontSize: "16px",
  fontWeight: 760,
  color: "#0f172a",
};

const contentGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
  gap: "13px",
};

const panel = {
  background: tokens.card,
  borderRadius: "15px",
  border: `1px solid ${tokens.borderSoft}`,
  padding: "16px",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.055)",
};

const panelHeadRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  marginBottom: "11px",
};

const panelTitle = {
  margin: 0,
  color: tokens.text,
  fontSize: "16.5px",
  fontWeight: 740,
  letterSpacing: "-0.01em",
};

const panelMeta = {
  fontSize: "11.5px",
  color: "#64748b",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "999px",
  padding: "4px 9px",
  fontWeight: 600,
};

const listWrap = { display: "grid", gap: "8px" };

const listItem = {
  display: "grid",
  gap: "7px",
  border: "1px solid #eef3f8",
  borderRadius: "12px",
  padding: "12px 13px",
  fontSize: "13px",
  color: tokens.muted,
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  transition: "border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease",
};

const movementItemPositive = {
  borderLeft: "3px solid #16a34a",
  background: "linear-gradient(180deg, #ffffff 0%, #f7fdf9 100%)",
};

const movementItemNegative = {
  borderLeft: "3px solid #e11d48",
  background: "linear-gradient(180deg, #ffffff 0%, #fff7fa 100%)",
};

const movementItemNeutral = {
  borderLeft: "3px solid #334155",
};

const movementTopRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
  alignItems: "center",
};

const movementTypePill = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "999px",
  padding: "4px 9px",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const movementTypePositive = {
  color: "#166534",
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
};

const movementTypeNegative = {
  color: "#9f1239",
  background: "#fff1f2",
  border: "1px solid #fecdd3",
};

const movementTypeNeutral = {
  color: "#334155",
  background: "#f8fafc",
  border: "1px solid #cbd5e1",
};

const movementTime = {
  fontSize: "11px",
  color: "#64748b",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const movementDrug = {
  color: tokens.text,
  lineHeight: 1.35,
  fontWeight: 650,
  fontSize: "13.5px",
  wordBreak: "break-word",
};

const movementBottomRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
};

const movementSubType = {
  fontSize: "11px",
  color: "#64748b",
  fontWeight: 600,
  lineHeight: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const movementQty = {
  fontSize: "11px",
  color: "#1e40af",
  background: "#f5f9ff",
  border: "1px solid #e6eefc",
  borderRadius: "999px",
  padding: "4px 9px",
  fontWeight: 700,
  whiteSpace: "nowrap",
  lineHeight: 1,
};

const quickGrid = { display: "grid", gap: "10px" };

const quickCard = {
  border: "1px solid #edf2f8",
  borderRadius: "12px",
  padding: "12px 13px",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  color: tokens.text,
  fontWeight: 600,
  fontSize: "13px",
  lineHeight: 1.4,
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "10px",
  boxShadow: "0 10px 18px rgba(15, 23, 42, 0.05)",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
};

const quickIcon = {
  fontSize: "10px",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  borderRadius: "999px",
  padding: "4px 7px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  lineHeight: 1,
};

const quickText = {
  color: tokens.text,
  fontSize: "13.2px",
  fontWeight: 650,
};

const quickSub = {
  marginTop: "2px",
  color: "#64748b",
  fontSize: "11.8px",
  fontWeight: 500,
};

const quickMeta = {
  fontSize: "11px",
  color: "#1d4ed8",
  letterSpacing: "0.02em",
  fontWeight: 700,
  lineHeight: 1,
  border: "1px solid #dbeafe",
  borderRadius: "999px",
  padding: "4px 8px",
  background: "#f8fbff",
};

const empty = {
  color: tokens.subtle,
  fontSize: "13.2px",
  border: `1px dashed ${tokens.border}`,
  borderRadius: "12px",
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  padding: "14px 14px",
};
