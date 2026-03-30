import { useCallback, useEffect, useMemo, useState } from "react";
import CommandPalette from "./components/CommandPalette";
import FeatureGate from "./components/FeatureGate";
import SkeletonCard from "./components/SkeletonCard";
import { useAnimatedCounter } from "./hooks/useAnimatedCounter";
import useSubscription from "./hooks/useSubscription";
import useCommandPaletteShortcut from "./hooks/useCommandPaletteShortcut";
import Login from "./Login";
import { supabase } from "./lib/supabaseClient";
import { useAuthContext } from "./lib/authContext";
import DrugSearch from "./DrugSearch";
import ExpiryTracker from "./ExpiryTracker";
import ShortageTracker from "./ShortageTracker";
import LabelBuilder from "./LabelBuilder";
import Billing from "./Billing";
import RefillTracker from "./RefillTracker";
import Reports from "./Reports";
import Stocktaking from "./Stocktaking";
import StockMovementSystem from "./StockMovementSystem";
import PharmacyNetwork from "./PharmacyNetworkPage.jsx";
import InventoryManagementPage from "./InventoryManagementPage.jsx";
import SubscriptionCenter from "./SubscriptionCenter";
import PDSSWorkspace from "./modules/pdss/PDSSWorkspace";
import UrgentActionsWidget from "./modules/pdss/UrgentActionsWidget";
import PurchaseRequests from "./PurchaseRequests";
import NetworkIntelligence from "./modules/network/NetworkIntelligence";
import {
  canAccessPage,
  getRequiredPlan,
  getUpgradeMessage,
  PLAN_LABELS,
} from "./config/featureAccess";

const NAVIGATION_SECTIONS = [
  {
    label: "Core",
    items: [
      { label: "Dashboard", subtitle: "Overview and live ops", page: "dashboard", icon: "⌂", keywords: ["home", "overview", "kpi"] },
      { label: "Subscription Center", subtitle: "Plans and entitlement visibility", page: "subscription-center", icon: "¤", keywords: ["subscription", "plans", "upgrade", "billing"] },
      { label: "Drug Intelligence", subtitle: "Search and inspect drug data", page: "drugsearch", icon: "⌕", keywords: ["drug", "master", "search"] },
      { label: "Expiry Tracker", subtitle: "Near-expiry and expired stock", page: "expiry", icon: "◷", keywords: ["expiry", "near expiry", "expired"] },
      { label: "Shortage Tracker", subtitle: "Shortage requests and status", page: "shortage", icon: "!", keywords: ["shortage", "stockout"] },
      { label: "Analytics", subtitle: "Operational reports", page: "reports", icon: "▤", keywords: ["reports", "analytics", "insights"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Labeling Suite", subtitle: "Generate labels", page: "labels", icon: "#", keywords: ["label", "print"] },
      { label: "Billing", subtitle: "Billing and invoice tools", page: "billing", icon: "$", keywords: ["invoice", "bill"] },
      { label: "Refill Tracker", subtitle: "Track refill schedules", page: "refill", icon: "↺", keywords: ["refill", "patient"] },
      { label: "PDSS", subtitle: "Executive dashboard", page: "pdss", pdssView: "executive-dashboard", icon: "⚙", keywords: ["pdss", "decision support", "executive"] },
      { label: "Purchase Requests", subtitle: "Manage purchase requests", page: "purchases", icon: "+", keywords: ["purchase", "procurement"] },
      { label: "Stocktaking", subtitle: "Count and variance checks", page: "stocktaking", icon: "✓", keywords: ["stocktaking", "count"] },
      { label: "Stock Movement", subtitle: "Record stock movement transactions", page: "stock-movement", icon: "⇄", keywords: ["stock movement", "transfer", "receive", "issue"] },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Network Intelligence", subtitle: "Cross-site network signals", page: "network", icon: "◎", keywords: ["network", "intelligence"] },
      { label: "Pharmacy Network", subtitle: "Pharmacy-level inventory view", page: "pharmacy-network", icon: "◉", keywords: ["pharmacy", "branches"] },
      { label: "Inventory Management", subtitle: "Inventory add/edit workflow", page: "inventory-management", icon: "▦", keywords: ["inventory", "stock"] },
    ],
  },
];

function formatStatusLabel(status) {
  if (!status) return "Inactive";

  return String(status)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getAccessModeNotice(status) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "unavailable") {
    return "Subscription unavailable — limited access mode";
  }

  if (normalized === "inactive") {
    return "Starter access active";
  }

  return "";
}

export default function App() {
  const { user, loading: authLoading, signOut } = useAuthContext();
  const { plan, status: subscriptionStatus, loading: subscriptionLoading } = useSubscription(user);
  const [page, setPage] = useState("dashboard");
  const [pdssView, setPdssView] = useState("executive-dashboard");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accessNotice, setAccessNotice] = useState("");
  const [activeSites, setActiveSites] = useState(0);
  const [inventoryRecords, setInventoryRecords] = useState(0);
  const [nearExpiry, setNearExpiry] = useState(0);
  const [shortageRequests, setShortageRequests] = useState(0);
  const [purchaseRequests, setPurchaseRequests] = useState(0);
  const [refillRequests, setRefillRequests] = useState(0);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

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

  const loadRecentActivity = async () => {
    if (!supabase) {
      setRecentActivity([]);
      setActivityLoading(false);
      return;
    }
    setActivityLoading(true);

    const safeQuery = async (table, columns) => {
      try {
        const { data, error } = await supabase
          .from(table)
          .select(columns)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return [];
        return data || [];
      } catch {
        return [];
      }
    };

    const [movements] = await Promise.all([
      safeQuery("stock_movements", "movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at,created_by"),
    ]);

    const items = [];

    const resolveCreatedAt = (createdAt) => {
      const ts = createdAt ? new Date(createdAt).getTime() : Number.NaN;
      return Number.isFinite(ts) ? createdAt : null;
    };

    for (const r of movements) {
      const createdAt = resolveCreatedAt(r.created_at);
      items.push({
        type: "MOVEMENT",
        title: `${r.movement_type || "Movement"} - ${r.drug_name || "Unknown"}`,
        subtitle: `${Number(r.quantity || 0)} units | ${r.from_pharmacy || "-"} → ${r.to_pharmacy || "-"}`,
        created_at: createdAt,
        created_by: r.created_by || "",
      });
    }

    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : Number.NEGATIVE_INFINITY;
      const tb = b.created_at ? new Date(b.created_at).getTime() : Number.NEGATIVE_INFINITY;
      return tb - ta;
    });

    setRecentActivity(items.slice(0, 5));
    setActivityLoading(false);
  };

  useEffect(() => {
    if (!user || page !== "dashboard") return;
    void loadRecentActivity();
  }, [page, user]);

  useEffect(() => {
    if (!user) return undefined;

    let isMounted = true;

    const loadDashboardMetrics = async () => {
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

      setActiveSites(pharmaciesCount || 0);
      setInventoryRecords(inventoryCount || 0);
      setNearExpiry(expiryCount || 0);
      setShortageRequests(shortageCount || 0);
      setPurchaseRequests(purchaseCount || 0);
      setRefillRequests(refillCount || 0);
    };

    void loadDashboardMetrics();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const totalDrugsInDatabase = inventoryRecords;
  const nearExpiryItems = nearExpiry;
  const shortageRequestsToday = shortageRequests;
  const activeUrgentActions =
    Number(purchaseRequests || 0) + Number(refillRequests || 0);

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
    if (!user || page !== "dashboard") {
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);
    const timer = window.setTimeout(() => setDashboardLoading(false), 700);
    return () => window.clearTimeout(timer);
  }, [page, user]);

  const animDrugs = useAnimatedCounter(totalDrugsInDatabase);
  const animNearExpiry = useAnimatedCounter(nearExpiryItems);
  const animShortageToday = useAnimatedCounter(shortageRequestsToday);
  const animActiveSites = useAnimatedCounter(activeSites);
  const animRiskScore = useAnimatedCounter(operationalRiskScore);
  const animFinancialImpact = useAnimatedCounter(financialImpact);

  const handlePaletteToggle = useCallback(() => {
    if (!user) return;
    setPaletteOpen((prev) => !prev);
  }, [user]);

  useCommandPaletteShortcut(handlePaletteToggle, true);

  const navigationSections = useMemo(
    () =>
      NAVIGATION_SECTIONS.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          const requiredPlan = getRequiredPlan(item.page);

          return {
            ...item,
            requiredPlan,
            requiredPlanLabel: PLAN_LABELS[requiredPlan],
            locked: !canAccessPage(plan, item.page),
          };
        }),
      })),
    [plan]
  );

  const commandNavigationItems = useMemo(
    () => navigationSections.flatMap((section) => section.items),
    [navigationSections]
  );

  const handleNavigationRequest = useCallback((selection) => {
    if (!selection?.page) return;

    if (!canAccessPage(plan, selection.page)) {
      setAccessNotice(getUpgradeMessage(selection.page));
      return;
    }

    setAccessNotice("");

    if (selection.page === "pdss" && selection.pdssView) {
      setPdssView(selection.pdssView);
    }

    setPage(selection.page);
  }, [plan]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setAccessNotice("");
    setPaletteOpen(false);
    setPage("dashboard");
    setPdssView("executive-dashboard");
  }, [signOut]);

  useEffect(() => {
    if (!accessNotice) return undefined;

    const timer = window.setTimeout(() => setAccessNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [accessNotice]);

  if (authLoading || (user && subscriptionLoading)) {
    return (
      <div style={sessionShell}>
        <div style={sessionCard}>
          <div style={sessionBadge}>FalconMed</div>
          <h1 style={sessionTitle}>Loading workspace</h1>
          <p style={sessionText}>Restoring your session and verifying plan access.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const renderGuardedPage = (targetPage, title, children) => (
    <div style={contentCard}>
      <FeatureGate
        allowed={canAccessPage(plan, targetPage)}
        title={title}
        message={getUpgradeMessage(targetPage)}
      >
        {children}
      </FeatureGate>
    </div>
  );

  const renderPage = () => {
    switch (page) {
      case "subscription-center":
        return renderGuardedPage(
          "subscription-center",
          "Subscription Center",
          <SubscriptionCenter plan={plan} status={subscriptionStatus} />
        );
      case "drugsearch":
        return renderGuardedPage("drugsearch", "Drug Intelligence", <DrugSearch />);
      case "expiry":
        return renderGuardedPage("expiry", "Expiry Tracker", <ExpiryTracker />);
      case "shortage":
        return renderGuardedPage("shortage", "Shortage Tracker", <ShortageTracker />);
      case "reports":
        return renderGuardedPage("reports", "Analytics", <Reports />);
      case "labels":
        return renderGuardedPage("labels", "Labeling Suite", <LabelBuilder />);
      case "billing":
        return renderGuardedPage("billing", "Billing", <Billing />);
      case "refill":
        return renderGuardedPage("refill", "Refill Tracker", <RefillTracker />);
      case "pdss":
        return renderGuardedPage("pdss", "PDSS", <PDSSWorkspace initialView={pdssView} />);
      case "purchases":
        return renderGuardedPage("purchases", "Purchase Requests", <PurchaseRequests />);
      case "stocktaking":
        return renderGuardedPage("stocktaking", "Stocktaking", <Stocktaking />);
      case "stock-movement":
        return renderGuardedPage("stock-movement", "Stock Movement", <StockMovementSystem />);
      case "network":
        return renderGuardedPage("network", "Network Intelligence", <NetworkIntelligence />);
      case "pharmacy-network":
        return renderGuardedPage("pharmacy-network", "Pharmacy Network", <PharmacyNetwork />);
      case "inventory-management":
        return renderGuardedPage("inventory-management", "Inventory Management", <InventoryManagementPage />);
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
                  FalconMed is currently tracking {inventoryRecords.toLocaleString()} inventory records across {activeSites.toLocaleString()} pharmacy sites.
                </div>

                <div style={cardsGrid}>
                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #1f3c88" }}>
                    <div style={statLabel}>TOTAL DRUGS IN DATABASE</div>
                    <div style={statValue}>{animDrugs.toLocaleString()}</div>
                    <div style={kpiHint}>Active formulary records across FalconMed.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #2f4f9f" }}>
                    <div style={statLabel}>NEAR EXPIRY ITEMS</div>
                    <div style={statValue}>{animNearExpiry}</div>
                    <div style={kpiHint}>Items requiring near-term stock planning.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #3557ab" }}>
                    <div style={statLabel}>SHORTAGE REQUESTS TODAY</div>
                    <div style={statValue}>{animShortageToday}</div>
                    <div style={kpiHint}>Current shortage pressure logged today.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #4267bb" }}>
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
                          ? "4px solid #4267bb"
                          : riskLevel === "Medium"
                            ? "4px solid #2f4f9f"
                            : "4px solid #1f3c88",
                    }}
                  >
                    <div style={statLabel}>OPERATIONAL RISK SCORE</div>
                    <div style={statValue}>{animRiskScore} / 100</div>
                    <div style={riskBadgeStyle}>{riskLevel}</div>
                    <div style={riskHint}>Driven by shortage risk and urgent pharmacy actions.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, borderTop: "4px solid #1f3c88" }}>
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

                  {activityLoading ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>Loading activity...</div>
                  ) : recentActivity.length === 0 ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>No recent activity found.</div>
                  ) : (
                    recentActivity.map((item, idx) => {
                      const isLast = idx === recentActivity.length - 1;
                      const barColor =
                        item.type === "SHORTAGE" ? "#2f4f9f" :
                        item.type === "EXPIRY" ? "#4267bb" : "#1f3c88";
                      const tagBg =
                        item.type === "SHORTAGE" ? "#e3ebff" :
                        item.type === "EXPIRY" ? "#edf2ff" : "#eaf0ff";
                      const tagColor =
                        item.type === "SHORTAGE" ? "#2f4f9f" :
                        item.type === "EXPIRY" ? "#4267bb" : "#1f3c88";
                      return (
                        <div
                          key={`activity-${idx}`}
                          style={{ ...activityItem, ...(isLast ? { borderBottom: "none" } : {}) }}
                        >
                          <div style={{ ...activityBarBlue, background: barColor }} />
                          <div style={activityContent}>
                            <div style={activityTitleRow}>
                              <span style={{ ...activityTagBase, background: tagBg, color: tagColor }}>
                                {item.type}
                              </span>
                              <span style={activityTitle}>{item.title}</span>
                            </div>
                            <div style={activityText}>{item.subtitle}</div>
                            {item.created_by ? (
                              <div style={{ ...activityText, fontSize: "12px" }}>by {item.created_by}</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
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
                <p style={brandTagline}>Pharmacy Intelligence Platform</p>
              </div>
            </div>
          </div>

          <div style={userCard}>
            <div style={userCardRow}>
              <div style={avatarCircle}>FM</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={userLabel}>Active Session</div>
                <div style={userEmail}>{user?.email || "Signed in"}</div>
                <div style={planRow}>
                  <span style={planBadge}>{PLAN_LABELS[plan]}</span>
                  <span style={planStatusBadge}>{formatStatusLabel(subscriptionStatus)}</span>
                </div>
                {getAccessModeNotice(subscriptionStatus) ? (
                  <div style={planHint}>{getAccessModeNotice(subscriptionStatus)}</div>
                ) : null}
              </div>
            </div>
            <button style={signOutButton} onClick={handleSignOut}>
              Sign out
            </button>
          </div>

          {navigationSections.map((section, sectionIndex) => (
            <div key={section.label}>
              {sectionIndex > 0 ? <div style={navDivider} /> : null}
              <div style={navSectionLabel}>{section.label}</div>

              {section.items.map((item) => (
                <button
                  key={item.page}
                  style={
                    page === item.page
                      ? item.locked
                        ? lockedActiveBtn
                        : activeBtn
                      : item.locked
                        ? lockedBtn
                        : btn
                  }
                  onClick={() => handleNavigationRequest(item)}
                >
                  <span style={navButtonRow}>
                    <span>{item.label}</span>
                    {item.locked ? <span style={lockIndicator}>Locked</span> : null}
                  </span>
                  {item.locked ? <span style={navMetaText}>{item.requiredPlanLabel} plan</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div style={demoFooter}>
          <div style={footerLiveRow}>
            <span style={footerLiveDot} />
            <span>Platform Online</span>
          </div>
          <div>FalconMed v1.0</div>
        </div>
      </aside>

      <main style={main}>
        {accessNotice ? (
          <div style={accessNoticeCard}>
            <div style={accessNoticeTitle}>Plan Access</div>
            <div style={accessNoticeText}>{accessNotice}</div>
          </div>
        ) : null}
        {renderPage()}
        <footer style={appFooter}>
          <div style={appFooterTitle}>FalconMed v1.0</div>
          <div style={appFooterSub}>Pharmacy Intelligence Platform</div>
        </footer>
      </main>

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigationItems={commandNavigationItems}
        onSelectPage={handleNavigationRequest}
      />
    </div>
  );
}

const layout = {
  display: "flex",
  minHeight: "100vh",
  background: "#f6f8fb",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const sidebar = {
  width: "280px",
  minWidth: "280px",
  background: "#0f1c3f",
  color: "white",
  padding: "28px 18px 24px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "6px 0 24px rgba(15, 28, 63, 0.24)",
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
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  background: "linear-gradient(135deg,#1f3c88,#3b82f6)",
  color: "white",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "18px",
  fontWeight: 700,
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
  marginBottom: "2px",
  fontSize: "11px",
  color: "#b6c3e3",
  letterSpacing: "0.02em",
};

const brandTagline = {
  marginTop: 0,
  marginBottom: 0,
  fontSize: "12px",
  color: "#dbe7ff",
  opacity: 0.8,
  letterSpacing: "0.01em",
};

const userCard = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "16px",
  padding: "12px 14px",
  marginBottom: "12px",
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
  background: "#1f3c88",
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
  color: "#b6c3e3",
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

const planRow = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  marginTop: "8px",
};

const planBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 10px",
  borderRadius: "999px",
  background: "rgba(59,130,246,0.16)",
  color: "#dbeafe",
  border: "1px solid rgba(147,197,253,0.28)",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const planStatusBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 10px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  color: "#cbd5e1",
  border: "1px solid rgba(255,255,255,0.12)",
  fontSize: "11px",
  fontWeight: 600,
};

const planHint = {
  marginTop: "8px",
  color: "#9fb2de",
  fontSize: "11px",
  lineHeight: 1.5,
};

const signOutButton = {
  width: "100%",
  marginTop: "12px",
  padding: "9px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 700,
};

const navSectionLabel = {
  fontSize: "10px",
  fontWeight: 700,
  color: "#9fb2de",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "16px 14px 8px",
};

const navDivider = {
  height: "1px",
  background: "rgba(255,255,255,0.12)",
  margin: "14px 4px 6px",
};

const navButtonRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

const lockIndicator = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "3px 8px",
  borderRadius: "999px",
  background: "rgba(251,191,36,0.14)",
  color: "#fde68a",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  flexShrink: 0,
};

const navMetaText = {
  display: "block",
  marginTop: "4px",
  fontSize: "11px",
  color: "#9fb2de",
  fontWeight: 500,
};

const btn = {
  display: "block",
  width: "100%",
  padding: "10px 14px",
  marginTop: "6px",
  background: "transparent",
  color: "#e2e8ff",
  border: "1px solid transparent",
  borderRadius: "10px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  fontWeight: 600,
  letterSpacing: "0.01em",
  transition: "background 0.2s, color 0.2s",
};

const activeBtn = {
  ...btn,
  background: "rgba(255,255,255,0.08)",
  color: "#ffffff",
  fontWeight: 700,
  borderRadius: "10px",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16)",
};

const lockedBtn = {
  ...btn,
  color: "#b6c3e3",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
};

const lockedActiveBtn = {
  ...lockedBtn,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
};

const main = {
  flex: 1,
  padding: "24px",
  minWidth: 0,
  maxWidth: "1400px",
};

const sessionShell = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "#f6f8fb",
};

const sessionCard = {
  width: "min(520px, 100%)",
  background: "white",
  borderRadius: "18px",
  border: "1px solid #e5eaf2",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.08)",
  padding: "28px",
};

const sessionBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 12px",
  borderRadius: "999px",
  background: "#eef2fb",
  color: "#1f3c88",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  border: "1px solid #d6dff5",
};

const sessionTitle = {
  marginTop: "16px",
  marginBottom: "8px",
  fontSize: "30px",
  lineHeight: 1.2,
  color: "#0f172a",
  letterSpacing: "-0.03em",
};

const sessionText = {
  margin: 0,
  color: "#64748b",
  fontSize: "15px",
  lineHeight: 1.7,
};

const headerCard = {
  background: "white",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  marginBottom: "22px",
  borderLeft: "5px solid #1f3c88",
};

const headerRow = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
};

const headerTitle = {
  margin: 0,
  fontSize: "24px",
  fontWeight: 700,
  lineHeight: 1.2,
  letterSpacing: "-0.02em",
  color: "#1a1a1a",
};

const headerText = {
  marginTop: "7px",
  marginBottom: 0,
  color: "#6b7280",
  fontSize: "15px",
  lineHeight: 1.6,
};

const liveStatusBadge = {
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  background: "#eef2fb",
  border: "1px solid #d6dff5",
  color: "#1f3c88",
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
  background: "#1f3c88",
  display: "inline-block",
  flexShrink: 0,
};

const insightBox = {
  background: "#eef2fb",
  border: "1px solid #d6dff5",
  borderRadius: "16px",
  padding: "20px",
  marginBottom: "22px",
  color: "#1f3c88",
  fontSize: "14px",
  lineHeight: 1.7,
};

const insightBullet = {
  color: "#1f3c88",
  fontWeight: 700,
  marginRight: "2px",
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "24px",
  marginBottom: "22px",
};

const statCard = {
  background: "white",
  borderRadius: "14px",
  padding: "18px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  textAlign: "center",
  border: "1px solid #e5eaf2",
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
  color: "#1a1a1a",
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
  background: "#edf2ff",
  color: "#4267bb",
  border: "1px solid #d6e0ff",
};

const riskBadgeMedium = {
  ...riskBadgeBase,
  background: "#eaf0ff",
  color: "#2f4f9f",
  border: "1px solid #d2defe",
};

const riskBadgeHigh = {
  ...riskBadgeBase,
  background: "#e5ecff",
  color: "#1f3c88",
  border: "1px solid #cddaff",
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
  borderRadius: "14px",
  padding: "18px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  marginBottom: "22px",
  border: "1px solid #e5eaf2",
};

const accessNoticeCard = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1d4ed8",
  borderRadius: "14px",
  padding: "16px 18px",
  marginBottom: "18px",
  boxShadow: "0 10px 26px rgba(29, 78, 216, 0.08)",
};

const accessNoticeTitle = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: "4px",
};

const accessNoticeText = {
  fontSize: "14px",
  lineHeight: 1.6,
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  fontSize: "24px",
  fontWeight: 700,
  lineHeight: 1.3,
  color: "#1a1a1a",
  letterSpacing: "-0.01em",
};

const sectionText = {
  color: "#6b7280",
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
  background: "#1f3c88",
  marginTop: "2px",
  flexShrink: 0,
};

const activityBarRed = {
  width: "4px",
  minHeight: "40px",
  borderRadius: "4px",
  background: "#2f4f9f",
  marginTop: "2px",
  flexShrink: 0,
};

const activityBarOrange = {
  width: "4px",
  minHeight: "40px",
  borderRadius: "4px",
  background: "#4267bb",
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
  background: "#eaf0ff",
  color: "#1f3c88",
};

const activityTagRed = {
  ...activityTagBase,
  background: "#e3ebff",
  color: "#2f4f9f",
};

const activityTagOrange = {
  ...activityTagBase,
  background: "#edf2ff",
  color: "#4267bb",
};

const activityTitle = {
  fontWeight: 700,
  color: "#1a1a1a",
  fontSize: "14px",
};

const activityText = {
  color: "#6b7280",
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
  background: "#eef2fb",
  color: "#1f3c88",
  fontSize: "12px",
  fontWeight: 600,
  border: "1px solid #d6dff5",
  letterSpacing: "0.01em",
};

const demoFooter = {
  color: "#b6c3e3",
  fontSize: "12px",
  textAlign: "center",
  paddingTop: "20px",
  borderTop: "1px solid rgba(255,255,255,0.12)",
  lineHeight: 1.8,
};

const footerLiveRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  marginBottom: "4px",
  color: "#dbe7ff",
  fontWeight: 600,
};

const footerLiveDot = {
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "#8fb0ff",
  display: "inline-block",
  flexShrink: 0,
};

const appFooter = {
  marginTop: "24px",
  marginBottom: "8px",
  padding: "20px",
  borderRadius: "14px",
  background: "#ffffff",
  border: "1px solid #e5eaf2",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  textAlign: "center",
};

const appFooterTitle = {
  color: "#1a1a1a",
  fontSize: "14px",
  fontWeight: 700,
  marginBottom: "4px",
};

const appFooterSub = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: 500,
};