import { useEffect, useState } from "react";
import CommandPalette from "./components/CommandPalette";
import SkeletonCard from "./components/SkeletonCard";
import { useAnimatedCounter } from "./hooks/useAnimatedCounter";
import useCommandPaletteShortcut from "./hooks/useCommandPaletteShortcut";
import { supabase } from "./lib/supabaseClient";
import LandingPage from "./LandingPage";
import DrugSearch from "./DrugSearch";
import ExpiryTracker from "./ExpiryTracker";
import ShortageTracker from "./ShortageTracker";
import LabelBuilder from "./LabelBuilder";
import Billing from "./Billing";
import RefillTracker from "./RefillTracker";
import Reports from "./Reports";
import Stocktaking from "./Stocktaking";
import PharmacyNetwork from "./PharmacyNetworkPage.jsx";
import InventoryManagementPage from "./InventoryManagementPage.jsx";
import PDSSWorkspace from "./modules/pdss/PDSSWorkspace";
import UrgentActionsWidget from "./modules/pdss/UrgentActionsWidget";
import PurchaseRequests from "./PurchaseRequests";
import NetworkIntelligence from "./modules/network/NetworkIntelligence";

export default function App() {
  const [showLanding, setShowLanding] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [pdssView, setPdssView] = useState("executive-dashboard");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dashboardCounts, setDashboardCounts] = useState({
    pharmacies: 0,
    inventoryRecords: 0,
    nearExpiry: 0,
    shortage: 0,
    purchase: 0,
    refill: 0,
  });

  const safeCount = async (tableName) => {
    if (!supabase) return 0;

    try {
      const { count, error } = await supabase
        .from(tableName)
        .select("*", { count: "exact", head: true });

      if (error) return 0;
      return Number.isFinite(count) ? count : 0;
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadDashboardCounts = async () => {
      const [pharmaciesCount, inventoryCount, expiryCount, shortageCount, purchaseCount, refillCount] =
        await Promise.all([
          safeCount("pharmacies"),
          safeCount("pharmacy_inventory"),
          safeCount("expiry_records"),
          safeCount("shortage_requests"),
          safeCount("purchase_requests"),
          safeCount("refill_requests"),
        ]);

      if (!isMounted) return;

      setDashboardCounts({
        pharmacies: pharmaciesCount,
        inventoryRecords: inventoryCount,
        nearExpiry: expiryCount,
        shortage: shortageCount,
        purchase: purchaseCount,
        refill: refillCount,
      });
    };

    void loadDashboardCounts();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalDrugsInDatabase = dashboardCounts.inventoryRecords;
  const nearExpiryItems = dashboardCounts.nearExpiry;
  const shortageRequestsToday = dashboardCounts.shortage;
  const activeSites = dashboardCounts.pharmacies;
  const activeUrgentActions =
    Number(dashboardCounts.purchase || 0) + Number(dashboardCounts.refill || 0);

  const computedRiskScore =
    (Number(shortageRequestsToday) || 0) * 15 +
    (Number(nearExpiryItems) || 0) * 10 +
    (Number(activeUrgentActions) || 0) * 5;
  const operationalRiskScore = Math.min(100, computedRiskScore);

  const potentialWaste = (Number(nearExpiryItems) || 0) * 150;
  const potentialSavings = (Number(shortageRequestsToday) || 0) * 200;
  const financialImpact = potentialWaste + potentialSavings;

  const riskLevel =
    operationalRiskScore <= 30 ? "Low" : operationalRiskScore <= 60 ? "Medium" : "High";

  const riskBadgeStyle =
    riskLevel === "Low"
      ? riskBadgeLow
      : riskLevel === "Medium"
        ? riskBadgeMedium
        : riskBadgeHigh;

  useEffect(() => {
    if (showLanding || page !== "dashboard") {
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);
    const timer = window.setTimeout(() => setDashboardLoading(false), 700);
    return () => window.clearTimeout(timer);
  }, [page, showLanding]);

  const animDrugs = useAnimatedCounter(totalDrugsInDatabase);
  const animNearExpiry = useAnimatedCounter(nearExpiryItems);
  const animShortageToday = useAnimatedCounter(shortageRequestsToday);
  const animActiveSites = useAnimatedCounter(activeSites);
  const animRiskScore = useAnimatedCounter(operationalRiskScore);
  const animFinancialImpact = useAnimatedCounter(financialImpact);

  useCommandPaletteShortcut(
    () => {
      if (showLanding) return;
      setPaletteOpen((prev) => !prev);
    },
    true
  );

  const commandNavigationItems = [
    { label: "Dashboard", subtitle: "Overview and live ops", page: "dashboard", icon: "⌂", keywords: ["home", "overview", "kpi"] },
    { label: "Drug Intelligence", subtitle: "Search and inspect drug data", page: "drugsearch", icon: "⌕", keywords: ["drug", "master", "search"] },
    { label: "Expiry Tracker", subtitle: "Near-expiry and expired stock", page: "expiry", icon: "◷", keywords: ["expiry", "near expiry", "expired"] },
    { label: "Shortage Tracker", subtitle: "Shortage requests and status", page: "shortage", icon: "!", keywords: ["shortage", "stockout"] },
    { label: "Analytics", subtitle: "Operational reports", page: "reports", icon: "▤", keywords: ["reports", "analytics", "insights"] },
    { label: "Labeling Suite", subtitle: "Generate labels", page: "labels", icon: "#", keywords: ["label", "print"] },
    { label: "Billing", subtitle: "Billing and invoice tools", page: "billing", icon: "$", keywords: ["invoice", "bill"] },
    { label: "Refill Tracker", subtitle: "Track refill schedules", page: "refill", icon: "↺", keywords: ["refill", "patient"] },
    { label: "PDSS", subtitle: "Executive dashboard", page: "pdss", pdssView: "executive-dashboard", icon: "⚙", keywords: ["pdss", "decision support", "executive"] },
    { label: "Purchase Requests", subtitle: "Manage purchase requests", page: "purchases", icon: "+", keywords: ["purchase", "procurement"] },
    { label: "Stocktaking", subtitle: "Count and variance checks", page: "stocktaking", icon: "✓", keywords: ["stocktaking", "count"] },
    { label: "Network Intelligence", subtitle: "Cross-site network signals", page: "network", icon: "◎", keywords: ["network", "intelligence"] },
    { label: "Pharmacy Network", subtitle: "Pharmacy-level inventory view", page: "pharmacy-network", icon: "◉", keywords: ["pharmacy", "branches"] },
    { label: "Inventory Management", subtitle: "Inventory add/edit workflow", page: "inventory-management", icon: "▦", keywords: ["inventory", "stock"] },
  ];

  const handleCommandSelect = (selection) => {
    if (!selection?.page) return;

    if (selection.page === "pdss" && selection.pdssView) {
      setPdssView(selection.pdssView);
    }

    setPage(selection.page);
  };

  if (showLanding) {
    return <LandingPage onAccess={() => setShowLanding(false)} />;
  }

  const renderPage = () => {
    switch (page) {
      case "drugsearch":
        return (
          <div style={contentCard}>
            <DrugSearch />
          </div>
        );
      case "expiry":
        return (
          <div style={contentCard}>
            <ExpiryTracker />
          </div>
        );
      case "shortage":
        return (
          <div style={contentCard}>
            <ShortageTracker />
          </div>
        );
      case "reports":
        return (
          <div style={contentCard}>
            <Reports />
          </div>
        );
      case "labels":
        return (
          <div style={contentCard}>
            <LabelBuilder />
          </div>
        );
      case "billing":
        return (
          <div style={contentCard}>
            <Billing />
          </div>
        );
      case "refill":
        return (
          <div style={contentCard}>
            <RefillTracker />
          </div>
        );
      case "pdss":
        return (
          <div style={contentCard}>
            <PDSSWorkspace initialView={pdssView} />
          </div>
        );
      case "purchases":
        return (
          <div style={contentCard}>
            <PurchaseRequests />
          </div>
        );
      case "stocktaking":
        return (
          <div style={contentCard}>
            <Stocktaking />
          </div>
        );
      case "network":
        return (
          <div style={contentCard}>
            <NetworkIntelligence />
          </div>
        );
      case "pharmacy-network":
        return (
          <div style={contentCard}>
            <PharmacyNetwork />
          </div>
        );
      case "inventory-management":
        return (
          <div style={contentCard}>
            <InventoryManagementPage />
          </div>
        );
      default:
        return (
          <>
            {dashboardLoading ? (
              <>
                <div style={headerCard}>
                  <SkeletonCard
                    style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
                    blocks={[
                      { width: "30%", height: 28, gap: 10, radius: 10 },
                      { width: "48%", height: 14, gap: 0, radius: 10 },
                    ]}
                  />
                </div>

                <div style={insightBox}>
                  <SkeletonCard
                    style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
                    blocks={[{ width: "100%", height: 14, gap: 0, radius: 10 }]}
                  />
                </div>

                <div style={cardsGrid}>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <SkeletonCard
                      key={`dashboard-kpi-skeleton-${index}`}
                      style={{ ...statCard, borderTop: "4px solid #e2e8f0", minHeight: 146 }}
                      blocks={[
                        { width: "52%", height: 10, gap: 12 },
                        { width: index === 5 ? "72%" : "48%", height: 32, gap: 12 },
                        { width: "82%", height: 10, gap: index === 4 ? 10 : 0 },
                        ...(index === 4 ? [{ width: "34%", height: 24, gap: 0, radius: 999 }] : []),
                      ]}
                    />
                  ))}
                </div>

                <div style={contentCard}>
                  <SkeletonCard
                    style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 176 }}
                    blocks={[
                      { width: "24%", height: 16, gap: 18, radius: 10 },
                      { width: "100%", height: 44, gap: 12, radius: 12 },
                      { width: "100%", height: 44, gap: 12, radius: 12 },
                      { width: "100%", height: 44, gap: 0, radius: 12 },
                    ]}
                  />
                </div>

                <div style={contentCard}>
                  <SkeletonCard
                    style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 150 }}
                    blocks={[
                      { width: "20%", height: 16, gap: 18, radius: 10 },
                      { width: "100%", height: 12, gap: 10, radius: 10 },
                      { width: "92%", height: 12, gap: 18, radius: 10 },
                      { width: "100%", height: 28, gap: 10, radius: 999 },
                      { width: "88%", height: 28, gap: 0, radius: 999 },
                    ]}
                  />
                </div>

                <div style={contentCard}>
                  <SkeletonCard
                    style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0, minHeight: 170 }}
                    blocks={[
                      { width: "26%", height: 16, gap: 18, radius: 10 },
                      { width: "100%", height: 16, gap: 10, radius: 10 },
                      { width: "100%", height: 16, gap: 10, radius: 10 },
                      { width: "94%", height: 16, gap: 0, radius: 10 },
                    ]}
                  />
                </div>
              </>
            ) : (
              <>
                <div style={headerCard}>
                  <div style={headerRow}>
                    <div>
                      <h1 style={headerTitle}>FalconMed Dashboard</h1>
                      <p style={headerText}>
                        Operational intelligence for pharmacy decision-making.
                      </p>
                    </div>
                    <div style={liveStatusBadge}>
                      <span style={liveStatusDot} />
                      Live
                    </div>
                  </div>
                </div>

                <div style={insightBox}>
                  <span style={insightBullet}>◆</span>{" "}
                  {totalDrugsInDatabase.toLocaleString()} inventory records are actively tracked. Current alerts show {nearExpiryItems.toLocaleString()} near-expiry
                  items and {shortageRequestsToday.toLocaleString()} shortage requests.
                </div>

                <div style={cardsGrid}>
                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #3b82f6" }}>
                    <div style={statLabel}>TOTAL DRUGS IN DATABASE</div>
                    <div style={statValue}>{animDrugs.toLocaleString()}</div>
                    <div style={kpiHint}>Active formulary records across FalconMed.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #f59e0b" }}>
                    <div style={statLabel}>NEAR EXPIRY ITEMS</div>
                    <div style={statValue}>{animNearExpiry}</div>
                    <div style={kpiHint}>Items requiring near-term stock planning.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #ef4444" }}>
                    <div style={statLabel}>SHORTAGE REQUESTS TODAY</div>
                    <div style={statValue}>{animShortageToday}</div>
                    <div style={kpiHint}>Current shortage pressure logged today.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #10b981" }}>
                    <div style={statLabel}>ACTIVE SITES</div>
                    <div style={statValue}>{animActiveSites}</div>
                    <div style={kpiHint}>Sites currently contributing activity data.</div>
                  </div>

                  <div
                    className="ui-hover-lift"
                    style={{
                      ...statCard,
                      borderTop:
                        riskLevel === "Low"
                          ? "4px solid #16a34a"
                          : riskLevel === "Medium"
                            ? "4px solid #f59e0b"
                            : "4px solid #ef4444",
                    }}
                  >
                    <div style={statLabel}>OPERATIONAL RISK SCORE</div>
                    <div style={statValue}>{animRiskScore} / 100</div>
                    <div style={riskBadgeStyle}>{riskLevel}</div>
                    <div style={riskHint}>Driven by shortage risk and urgent pharmacy actions.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #0ea5e9" }}>
                    <div style={statLabel}>INVENTORY FINANCIAL IMPACT</div>
                    <div style={{ ...statValue, fontSize: "26px" }}>
                      AED {animFinancialImpact.toLocaleString()}
                    </div>
                    <div style={financialSubline}>
                      Waste Risk AED {potentialWaste.toLocaleString()} | Savings Opportunity AED {potentialSavings.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div style={contentCard}>
                  <h3 style={sectionTitle}>Recent Activity</h3>

                  <div style={activityItem}>
                    <div style={activityBarBlue} />
                    <div style={activityContent}>
                      <div style={activityTitleRow}>
                        <span style={activityTagBlue}>Refill</span>
                        <span style={activityTitle}>Refill Created</span>
                      </div>
                      <div style={activityText}>
                        Refill request created: sample medicine entry
                      </div>
                    </div>
                  </div>

                  <div style={activityItem}>
                    <div style={activityBarRed} />
                    <div style={activityContent}>
                      <div style={activityTitleRow}>
                        <span style={activityTagRed}>Shortage</span>
                        <span style={activityTitle}>Shortage Created</span>
                      </div>
                      <div style={activityText}>
                        Shortage request created: sample shortage item
                      </div>
                    </div>
                  </div>

                  <div style={{ ...activityItem, borderBottom: "none" }}>
                    <div style={activityBarOrange} />
                    <div style={activityContent}>
                      <div style={activityTitleRow}>
                        <span style={activityTagOrange}>Expiry</span>
                        <span style={activityTitle}>Expiry Added</span>
                      </div>
                      <div style={activityText}>
                        Expiry item added: sample expiry medicine
                      </div>
                    </div>
                  </div>
                </div>

                <div style={contentCard}>
                  <h3 style={sectionTitle}>Overview</h3>
                  <p style={sectionText}>
                    FalconMed is a pharmacy operations and clinical intelligence
                    platform designed for hospitals and community pharmacies.
                  </p>
                  <div style={featurePillsRow}>
                    {[
                      "Drug Intelligence",
                      "Shortage Tracking",
                      "Expiry Management",
                      "Network Analytics",
                      "PDSS",
                      "Labeling Suite",
                    ].map((f) => (
                      <span key={f} style={featurePill}>{f}</span>
                    ))}
                  </div>
                </div>

                <div style={contentCard}>
                  <UrgentActionsWidget
                    onViewAll={() => {
                      setPdssView("action-center");
                      setPage("pdss");
                    }}
                  />
                </div>
              </>
            )}
          </>
        );
    }
  };

  return (
    <div style={layout}>
      <aside style={sidebar}>
        <div>
          <div style={brandBox}>
            <div style={brandLogoRow}>
              <div style={brandIconBox}>F</div>
              <div>
                <h2 style={brandTitle}>FalconMed</h2>
                <p style={brandSub}>Pharmacy Intelligence</p>
              </div>
            </div>
          </div>

          <div style={userCard}>
            <div style={userCardRow}>
              <div style={avatarCircle}>FM</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={userLabel}>Active Session</div>
                <div style={userEmail}>falconmed.demo@preview</div>
              </div>
            </div>
          </div>

          <div style={navSectionLabel}>Core</div>

          <button
            style={page === "dashboard" ? activeBtn : btn}
            onClick={() => setPage("dashboard")}
          >
            Dashboard
          </button>
          <button
            style={page === "drugsearch" ? activeBtn : btn}
            onClick={() => setPage("drugsearch")}
          >
            Drug Intelligence
          </button>
          <button
            style={page === "expiry" ? activeBtn : btn}
            onClick={() => setPage("expiry")}
          >
            Expiry Tracker
          </button>
          <button
            style={page === "shortage" ? activeBtn : btn}
            onClick={() => setPage("shortage")}
          >
            Shortage Tracker
          </button>
          <button
            style={page === "reports" ? activeBtn : btn}
            onClick={() => setPage("reports")}
          >
            Analytics
          </button>

          <div style={navDivider} />
          <div style={navSectionLabel}>Operations</div>

          <button
            style={page === "labels" ? activeBtn : btn}
            onClick={() => setPage("labels")}
          >
            Labeling Suite
          </button>
          <button
            style={page === "billing" ? activeBtn : btn}
            onClick={() => setPage("billing")}
          >
            Billing
          </button>
          <button
            style={page === "refill" ? activeBtn : btn}
            onClick={() => setPage("refill")}
          >
            Refill Tracker
          </button>
          <button
            style={page === "pdss" ? activeBtn : btn}
            onClick={() => {
              setPdssView("executive-dashboard");
              setPage("pdss");
            }}
          >
            PDSS
          </button>
          <button
            style={page === "purchases" ? activeBtn : btn}
            onClick={() => setPage("purchases")}
          >
            Purchase Requests
          </button>
          <button
            style={page === "stocktaking" ? activeBtn : btn}
            onClick={() => setPage("stocktaking")}
          >
            Stocktaking
          </button>

          <div style={navDivider} />
          <div style={navSectionLabel}>Intelligence</div>

          <button
            style={page === "network" ? activeBtn : btn}
            onClick={() => setPage("network")}
          >
            Network Intelligence
          </button>
          <button
            style={page === "pharmacy-network" ? activeBtn : btn}
            onClick={() => setPage("pharmacy-network")}
          >
            Pharmacy Network
          </button>
          <button
            style={page === "inventory-management" ? activeBtn : btn}
            onClick={() => setPage("inventory-management")}
          >
            Inventory Management
          </button>
        </div>

        <div style={demoFooter}>
          <div style={footerLiveRow}>
            <span style={footerLiveDot} />
            <span>Platform Online</span>
          </div>
          <div>FalconMed v1.0 · Stable</div>
        </div>
      </aside>

      <main style={main}>{renderPage()}</main>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigationItems={commandNavigationItems}
        onSelectPage={handleCommandSelect}
      />
    </div>
  );
}

const layout = {
  display: "flex",
  minHeight: "100vh",
  background: "#eef2f7",
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const sidebar = {
  width: "280px",
  minWidth: "280px",
  background: "#0c1322",
  color: "white",
  padding: "28px 16px 24px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "3px 0 20px rgba(0,0,0,0.18)",
  position: "sticky",
  top: 0,
  height: "100vh",
  overflowY: "auto",
  boxSizing: "border-box",
};

const brandBox = {
  marginBottom: "20px",
  paddingBottom: "20px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const brandLogoRow = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const brandIconBox = {
  width: "38px",
  height: "38px",
  borderRadius: "10px",
  background: "#1e40af",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "19px",
  fontWeight: 900,
  flexShrink: 0,
  letterSpacing: "-0.02em",
};

const brandTitle = {
  margin: 0,
  fontSize: "22px",
  fontWeight: 800,
  letterSpacing: "-0.02em",
  color: "#ffffff",
  lineHeight: 1.2,
};

const brandSub = {
  marginTop: "3px",
  marginBottom: 0,
  fontSize: "11px",
  color: "#7c95b8",
  letterSpacing: "0.02em",
};

const userCard = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  padding: "11px 13px",
  marginBottom: "8px",
};

const userCardRow = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const avatarCircle = {
  width: "34px",
  height: "34px",
  borderRadius: "50%",
  background: "#1e40af",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.05em",
  flexShrink: 0,
};

const userLabel = {
  fontSize: "10px",
  color: "#7c95b8",
  marginBottom: "3px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 700,
};

const userEmail = {
  fontSize: "12px",
  color: "#e2e8f0",
  wordBreak: "break-word",
  fontWeight: 600,
};

const navSectionLabel = {
  fontSize: "10px",
  fontWeight: 700,
  color: "#4a6080",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "14px 14px 6px",
};

const navDivider = {
  height: "1px",
  background: "rgba(255,255,255,0.06)",
  margin: "10px 2px 4px",
};

const btn = {
  display: "block",
  width: "100%",
  padding: "10px 14px",
  marginTop: "3px",
  background: "transparent",
  color: "#94a3b8",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  fontWeight: 500,
  letterSpacing: "0.01em",
  transition: "background 0.15s, color 0.15s",
};

const activeBtn = {
  ...btn,
  background: "#1e40af",
  color: "#ffffff",
  fontWeight: 700,
  boxShadow: "0 2px 12px rgba(30,64,175,0.35)",
};

const main = {
  flex: 1,
  padding: "32px",
  minWidth: 0,
  maxWidth: "1400px",
};

const headerCard = {
  background: "white",
  borderRadius: "20px",
  padding: "26px 32px",
  boxShadow: "0 2px 16px rgba(15, 23, 42, 0.07)",
  marginBottom: "24px",
  borderLeft: "5px solid #1e40af",
};

const headerRow = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
};

const headerTitle = {
  margin: 0,
  fontSize: "32px",
  fontWeight: 800,
  lineHeight: 1.2,
  letterSpacing: "-0.02em",
  color: "#0f172a",
};

const headerText = {
  marginTop: "7px",
  marginBottom: 0,
  color: "#64748b",
  fontSize: "15px",
  lineHeight: 1.6,
};

const liveStatusBadge = {
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  background: "#dcfce7",
  border: "1px solid #bbf7d0",
  color: "#166534",
  fontSize: "12px",
  fontWeight: 700,
  padding: "6px 14px",
  borderRadius: "999px",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
  flexShrink: 0,
  marginTop: "4px",
};

const liveStatusDot = {
  width: "7px",
  height: "7px",
  borderRadius: "50%",
  background: "#16a34a",
  display: "inline-block",
  flexShrink: 0,
};

const insightBox = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "14px",
  padding: "14px 18px",
  marginBottom: "24px",
  color: "#1e3a5f",
  fontSize: "14px",
  lineHeight: 1.7,
};

const insightBullet = {
  color: "#1e40af",
  fontWeight: 700,
  marginRight: "2px",
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "18px",
  marginBottom: "28px",
};

const statCard = {
  background: "white",
  borderRadius: "18px",
  padding: "22px 20px 18px",
  boxShadow: "0 2px 14px rgba(15, 23, 42, 0.06)",
  textAlign: "center",
  border: "1px solid #e8edf5",
};

const statLabel = {
  fontSize: "10px",
  color: "#94a3b8",
  marginBottom: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const statValue = {
  fontSize: "34px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
};

const kpiHint = {
  marginTop: "10px",
  fontSize: "12px",
  color: "#94a3b8",
  lineHeight: 1.5,
};

const riskBadgeBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  padding: "4px 12px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginTop: "10px",
};

const riskBadgeLow = {
  ...riskBadgeBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #bbf7d0",
};

const riskBadgeMedium = {
  ...riskBadgeBase,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const riskBadgeHigh = {
  ...riskBadgeBase,
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fecaca",
};

const riskHint = {
  marginTop: "10px",
  fontSize: "12px",
  color: "#94a3b8",
  lineHeight: 1.5,
};

const financialSubline = {
  marginTop: "8px",
  fontSize: "11px",
  color: "#94a3b8",
  lineHeight: 1.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const contentCard = {
  background: "white",
  borderRadius: "18px",
  padding: "26px",
  boxShadow: "0 2px 14px rgba(15, 23, 42, 0.06)",
  marginBottom: "24px",
  border: "1px solid #e8edf5",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  fontSize: "18px",
  fontWeight: 800,
  lineHeight: 1.3,
  color: "#0f172a",
  letterSpacing: "-0.01em",
};

const sectionText = {
  color: "#64748b",
  fontSize: "15px",
  lineHeight: 1.7,
  marginBottom: 0,
};

const activityItem = {
  display: "flex",
  gap: "16px",
  alignItems: "flex-start",
  padding: "14px 0",
  borderBottom: "1px solid #f1f5f9",
};

const activityBarBlue = {
  width: "4px",
  minHeight: "40px",
  borderRadius: "4px",
  background: "#3b82f6",
  marginTop: "2px",
  flexShrink: 0,
};

const activityBarRed = {
  width: "4px",
  minHeight: "40px",
  borderRadius: "4px",
  background: "#ef4444",
  marginTop: "2px",
  flexShrink: 0,
};

const activityBarOrange = {
  width: "4px",
  minHeight: "40px",
  borderRadius: "4px",
  background: "#f59e0b",
  marginTop: "2px",
  flexShrink: 0,
};

const activityContent = {
  flex: 1,
};

const activityTitleRow = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "4px",
};

const activityTagBase = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: "10px",
  fontWeight: 700,
  padding: "2px 7px",
  borderRadius: "999px",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const activityTagBlue = {
  ...activityTagBase,
  background: "#dbeafe",
  color: "#1e40af",
};

const activityTagRed = {
  ...activityTagBase,
  background: "#fee2e2",
  color: "#b91c1c",
};

const activityTagOrange = {
  ...activityTagBase,
  background: "#fef3c7",
  color: "#92400e",
};

const activityTitle = {
  fontWeight: 700,
  color: "#0f172a",
  fontSize: "14px",
};

const activityText = {
  color: "#64748b",
  fontSize: "13px",
  lineHeight: 1.6,
};

const featurePillsRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "16px",
};

const featurePill = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 12px",
  borderRadius: "999px",
  background: "#eff6ff",
  color: "#1e40af",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid #bfdbfe",
  letterSpacing: "0.01em",
};

const demoFooter = {
  color: "#4a6080",
  fontSize: "12px",
  textAlign: "center",
  paddingTop: "20px",
  borderTop: "1px solid rgba(255,255,255,0.07)",
  lineHeight: 1.8,
};

const footerLiveRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  marginBottom: "4px",
  color: "#6ee7b7",
  fontWeight: 600,
};

const footerLiveDot = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "#22c55e",
  display: "inline-block",
  flexShrink: 0,
};