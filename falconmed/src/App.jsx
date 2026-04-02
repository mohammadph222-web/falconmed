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
import { subscribeInventoryUpdated } from "./utils/inventoryEvents";
import {
  computeInventoryAggregates,
  formatAed,
  formatQty,
  isNearExpiry,
} from "./utils/inventoryAnalytics";

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

  if (normalized === "preview") {
    return "Enterprise preview active — presentation-safe visibility";
  }

  if (normalized === "unavailable") {
    return "Subscription unavailable — limited access mode";
  }

  if (normalized === "inactive") {
    return "Starter access active";
  }

  return "";
}

export default function App() {
  const { user, loading: authLoading, signOut, isDemoMode } = useAuthContext();
  const { plan, status: subscriptionStatus, loading: subscriptionLoading } = useSubscription(user, { isDemoMode });
  const [page, setPage] = useState("dashboard");
  const [pdssView, setPdssView] = useState("executive-dashboard");
  const [commandCenterMode, setCommandCenterMode] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accessNotice, setAccessNotice] = useState("");
  const [activeSites, setActiveSites] = useState(0);
  const [inventoryRecords, setInventoryRecords] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [stockValue, setStockValue] = useState(0);
  const [nearExpiry, setNearExpiry] = useState(0);
  const [nearExpiryStockValue, setNearExpiryStockValue] = useState(0);
  const [expiredStockValue, setExpiredStockValue] = useState(0);
  const [shortageRequests, setShortageRequests] = useState(0);
  const [purchaseRequests, setPurchaseRequests] = useState(0);
  const [refillRequests, setRefillRequests] = useState(0);
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [liveOperationsToday, setLiveOperationsToday] = useState(0);
  const [inventoryRiskHeatmap, setInventoryRiskHeatmap] = useState([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [inventoryRefreshTick, setInventoryRefreshTick] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeInventoryUpdated(() => {
      setInventoryRefreshTick((prev) => prev + 1);
    });

    return unsubscribe;
  }, []);

  const safeCount = useCallback(async (tableName) => {
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
  }, []);

  const loadRecentActivity = async () => {
    if (!supabase) {
      setRecentActivity([]);
      setLiveOperationsToday(0);
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
          .limit(10);
        if (error) return [];
        return data || [];
      } catch {
        return [];
      }
    };

    const [movements] = await Promise.all([
      safeQuery("stock_movements", "movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at,created_by"),
    ]);

    const safeTodayCount = async () => {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const tomorrowStart = new Date(todayStart);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);

        const { count, error } = await supabase
          .from("stock_movements")
          .select("*", { count: "exact", head: true })
          .gte("created_at", todayStart.toISOString())
          .lt("created_at", tomorrowStart.toISOString());

        if (error) return 0;
        return Number.isFinite(count) ? count : 0;
      } catch {
        return 0;
      }
    };

    const todayCount = await safeTodayCount();

    const items = [];

    const resolveCreatedAt = (createdAt) => {
      const ts = createdAt ? new Date(createdAt).getTime() : Number.NaN;
      return Number.isFinite(ts) ? createdAt : null;
    };

    const resolveMovementTone = (movementType) => {
      const normalized = String(movementType || "").trim().toLowerCase();

      if (normalized.includes("transfer")) return "transfer";
      if (normalized.includes("receive") || normalized === "add") return "receive";
      if (normalized.includes("adjust")) return "adjustment";
      if (normalized.includes("delete")) return "delete";
      if (normalized.includes("update")) return "update";
      return "default";
    };

    for (const r of movements) {
      const createdAt = resolveCreatedAt(r.created_at);
      const movementLabel = String(r.movement_type || "Movement").trim() || "Movement";
      const qty = Number(r.quantity || 0);
      const locations = [
        r.from_pharmacy ? `From ${r.from_pharmacy}` : "",
        r.to_pharmacy ? `To ${r.to_pharmacy}` : "",
      ].filter(Boolean);

      items.push({
        type: movementLabel,
        tone: resolveMovementTone(movementLabel),
        title: r.drug_name || "Unknown drug",
        subtitle: `Qty ${qty}${locations.length > 0 ? ` | ${locations.join(" • ")}` : ""}`,
        created_at: createdAt,
        timestampLabel: createdAt ? new Date(createdAt).toLocaleString() : "Unknown time",
        created_by: r.created_by || "",
      });
    }

    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : Number.NEGATIVE_INFINITY;
      const tb = b.created_at ? new Date(b.created_at).getTime() : Number.NEGATIVE_INFINITY;
      return tb - ta;
    });

    setRecentActivity(items.slice(0, 10));
    setLiveOperationsToday(todayCount);
    setActivityLoading(false);
  };

  useEffect(() => {
    if (!user || page !== "dashboard") return;
    void loadRecentActivity();
  }, [page, user, inventoryRefreshTick]);

  const loadInventoryRiskHeatmap = async () => {
    if (!supabase) {
      setInventoryRiskHeatmap([]);
      setHeatmapLoading(false);
      return;
    }

    setHeatmapLoading(true);

    try {
      const [{ data: pharmacies, error: pharmaciesError }, { data: inventory, error: inventoryError }] = await Promise.all([
        supabase.from("pharmacies").select("id,name").limit(2000),
        supabase.from("pharmacy_inventory").select("pharmacy_id,quantity,expiry_date").limit(10000),
      ]);

      if (pharmaciesError || inventoryError) {
        setInventoryRiskHeatmap([]);
        return;
      }

      const aggregates = computeInventoryAggregates(inventory || []);

      const pharmacyMap = new Map();
      (pharmacies || []).forEach((p) => {
        const key = String(p?.id ?? "");
        if (!key) return;

        pharmacyMap.set(key, {
          pharmacyName: String(p?.name || "Unknown Pharmacy"),
          lowStockCount: 0,
          nearExpiryCount: 0,
        });
      });

      (inventory || []).forEach((row) => {
        const key = String(row?.pharmacy_id ?? "");
        if (!key) return;

        if (!pharmacyMap.has(key)) {
          pharmacyMap.set(key, {
            pharmacyName: "Unknown Pharmacy",
            lowStockCount: 0,
            nearExpiryCount: 0,
          });
        }

        const entry = pharmacyMap.get(key);
        const qty = Number(row?.quantity ?? 0);
        if (Number.isFinite(qty) && qty > 0 && qty <= 10) {
          entry.lowStockCount += 1;
        }

        if (isNearExpiry(row?.expiry_date)) {
          entry.nearExpiryCount += 1;
        }
      });

      Object.entries(aggregates.byPharmacyId).forEach(([pharmacyId]) => {
        if (!pharmacyMap.has(pharmacyId)) {
          pharmacyMap.set(pharmacyId, {
            pharmacyName: "Unknown Pharmacy",
            lowStockCount: 0,
            nearExpiryCount: 0,
          });
        }
      });

      const rows = Array.from(pharmacyMap.entries())
        .map(([pharmacyId, entry]) => ({
          pharmacyId,
          ...entry,
        }))
        .map((entry) => ({
          ...entry,
          issueCount: Number(entry.lowStockCount || 0) + Number(entry.nearExpiryCount || 0),
        }))
        .sort((a, b) => a.pharmacyName.localeCompare(b.pharmacyName));

      setInventoryRiskHeatmap(rows);
    } catch {
      setInventoryRiskHeatmap([]);
    } finally {
      setHeatmapLoading(false);
    }
  };

  useEffect(() => {
    if (!user || page !== "dashboard") return;
    void loadInventoryRiskHeatmap();
  }, [page, user, inventoryRefreshTick]);

  const loadDashboardMetrics = useCallback(async () => {
    if (!supabase) {
      setActiveSites(0);
      setInventoryRecords(0);
      setTotalQty(0);
      setStockValue(0);
      setNearExpiry(0);
      setNearExpiryStockValue(0);
      setExpiredStockValue(0);
      setShortageRequests(0);
      setPurchaseRequests(0);
      setRefillRequests(0);
      return;
    }

    const [
      inventoryResult,
      shortageCount,
      purchaseCount,
      refillCount,
      pharmaciesCount,
    ] = await Promise.all([
      supabase
        .from("pharmacy_inventory")
        .select("pharmacy_id,quantity,unit_cost,expiry_date")
        .limit(30000),
      safeCount("shortage_requests"),
      safeCount("purchase_requests"),
      safeCount("refill_requests"),
    ]);

    const rows = inventoryResult?.error ? [] : inventoryResult?.data || [];
    const aggregates = computeInventoryAggregates(rows);

    setActiveSites(aggregates.activeSites || 0);
    setInventoryRecords(aggregates.inventoryRecords || 0);
    setTotalQty(aggregates.totalQty || 0);
    setStockValue(aggregates.stockValue || 0);
    setNearExpiry(aggregates.nearExpiryItems || 0);
    setNearExpiryStockValue(aggregates.nearExpiryStockValue || 0);
    setExpiredStockValue(aggregates.expiredStockValue || 0);
    setShortageRequests(shortageCount || 0);
    setPurchaseRequests(purchaseCount || 0);
    setRefillRequests(refillCount || 0);
  }, [safeCount]);

  useEffect(() => {
    if (!user) return undefined;

    let isMounted = true;

    void loadDashboardMetrics().then(() => {
      if (!isMounted) return;
    });

    return () => {
      isMounted = false;
    };
  }, [user, inventoryRefreshTick, loadDashboardMetrics]);

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

  const financialImpact = Number(stockValue || 0);
  const expiryRiskExposure = Number(nearExpiryStockValue || 0);
  const deadStockExposure = Number(expiredStockValue || 0);
  const shortageRiskExposure = 0;
  const potentialSavings = 0;
  const totalFinancialExposure =
    Number(expiryRiskExposure || 0) +
    Number(deadStockExposure || 0) +
    Number(shortageRiskExposure || 0);

  const riskLevel =
    operationalRiskScore <= 30
      ? "Stable"
      : operationalRiskScore <= 60
        ? "Needs Attention"
        : "Critical";

  const riskBadgeStyle =
    riskLevel === "Stable"
      ? riskBadgeStable
      : riskLevel === "Needs Attention"
        ? riskBadgeAttention
        : riskBadgeCritical;

  const riskAccentColor =
    riskLevel === "Stable" ? "#16a34a" : riskLevel === "Needs Attention" ? "#ca8a04" : "#dc2626";

  const dashboardDataStatus = useMemo(() => {
    const freshest = recentActivity.reduce((latest, item) => {
      const raw = item?.created_at;
      if (!raw) return latest;

      const ts = new Date(raw).getTime();
      if (!Number.isFinite(ts)) return latest;

      return ts > latest ? ts : latest;
    }, Number.NEGATIVE_INFINITY);

    if (Number.isFinite(freshest)) {
      return {
        label: new Date(freshest).toLocaleString(),
        source: "Source: FalconMed operational records",
      };
    }

    return {
      label: "Based on latest available records",
      source: "Source: FalconMed operational records",
    };
  }, [recentActivity]);

  const systemHealth = useMemo(() => {
    if (!supabase) {
      return {
        status: "Critical",
        subtitle: "Critical modules unavailable",
      };
    }

    if (activityLoading) {
      return {
        status: "Warning",
        subtitle: "Some data sources need attention",
      };
    }

    if (
      !dashboardLoading &&
      inventoryRecords === 0 &&
      activeSites === 0 &&
      nearExpiryItems === 0 &&
      shortageRequestsToday === 0 &&
      recentActivity.length === 0
    ) {
      return {
        status: "Warning",
        subtitle: "Some data sources need attention",
      };
    }

    return {
      status: "Operational",
      subtitle: "All core modules reporting normally",
    };
  }, [
    activityLoading,
    activeSites,
    dashboardLoading,
    expiredStockValue,
    inventoryRecords,
    nearExpiryStockValue,
    nearExpiryItems,
    recentActivity,
    shortageRequestsToday,
    stockValue,
  ]);

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

  const transfersToday = useMemo(
    () =>
      recentActivity.filter((item) =>
        String(item?.type || "").toLowerCase().includes("transfer")
      ).length,
    [recentActivity]
  );

  const recentActionsCount = recentActivity.length;

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

  const isCommandCenterMode = page === "dashboard" && commandCenterMode;
  const sessionHeadline = isDemoMode ? "Enterprise Preview" : user?.email || "Signed in";
  const sessionPlanLabel = isDemoMode ? "Enterprise Preview" : PLAN_LABELS[plan];
  const sessionStatusLabel = isDemoMode ? "Preview" : formatStatusLabel(subscriptionStatus);
  const sessionHint = isDemoMode
    ? "Presentation-safe access with expanded enterprise module visibility."
    : getAccessModeNotice(subscriptionStatus);

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
    setCommandCenterMode(false);
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
          <SubscriptionCenter plan={plan} status={subscriptionStatus} isDemoMode={isDemoMode} />
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
                <div style={{ ...headerCard, ...(isCommandCenterMode ? commandModeHeaderCard : null) }}>
                  <div style={headerRow}>
                    <div>
                      <h1 style={headerTitle}>FalconMed Dashboard</h1>
                      <p style={headerText}>
                        Operational intelligence for pharmacy decision-making.
                      </p>
                    </div>
                    <div style={headerControlsRow}>
                      <div style={liveStatusBadge}>
                        <span style={liveStatusDot} />
                        Live
                      </div>
                      <button
                        type="button"
                        onClick={() => setCommandCenterMode((prev) => !prev)}
                        style={{
                          ...commandCenterButton,
                          ...(isCommandCenterMode
                            ? commandCenterButtonOn
                            : commandCenterButtonOff),
                        }}
                      >
                        {isCommandCenterMode ? "Command Center ON" : "Command Center OFF"}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ ...dataStatusBar, ...(isCommandCenterMode ? commandModeBar : null) }}>
                  <div style={dataStatusLabel}>Last data update</div>
                  <div style={dataStatusValue}>{dashboardDataStatus.label}</div>
                  <div style={dataStatusSource}>{dashboardDataStatus.source}</div>
                </div>

                <div style={{ ...systemHealthBar, ...(isCommandCenterMode ? commandModeBar : null) }}>
                  <div style={systemHealthLabel}>System Health</div>
                  <span
                    style={{
                      ...systemHealthPill,
                      ...(systemHealth.status === "Operational"
                        ? systemHealthOperational
                        : systemHealth.status === "Warning"
                          ? systemHealthWarning
                          : systemHealthCritical),
                    }}
                  >
                    {systemHealth.status}
                  </span>
                  <div style={systemHealthSubtitle}>{systemHealth.subtitle}</div>
                </div>

                <div style={{ ...insightBox, ...(isCommandCenterMode ? commandModeInsightBox : null) }}>
                  <span style={insightBullet}>◆</span>{" "}
                  FalconMed is currently tracking {formatQty(inventoryRecords)} inventory records across {formatQty(activeSites)} pharmacy sites.
                </div>

                <div
                  className="ui-hover-lift"
                  style={{
                    ...riskKpiCard,
                    ...(isCommandCenterMode ? commandModeRiskKpiCard : null),
                    borderTop: `4px solid ${riskAccentColor}`,
                  }}
                >
                  <div style={statLabel}>OPERATIONAL RISK SCORE</div>
                  <div style={riskKpiValue}>{animRiskScore} / 100</div>
                  <div style={riskBadgeStyle}>Status: {riskLevel}</div>
                  <div style={riskHint}>Calculated from shortage count, near-expiry count, and urgent actions.</div>
                </div>

                <div style={{ ...cardsGrid, ...(isCommandCenterMode ? commandModeCardsGrid : null) }}>
                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #1f3c88" }}>
                    <div style={statLabel}>TOTAL DRUGS IN DATABASE</div>
                    <div style={statValue}>{formatQty(animDrugs)}</div>
                    <div style={kpiHint}>Active formulary records across FalconMed.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #2f4f9f" }}>
                    <div style={statLabel}>NEAR EXPIRY ITEMS</div>
                    <div style={statValue}>{formatQty(animNearExpiry)}</div>
                    <div style={expiryRiskMiniLabel}>Estimated Expiry Risk</div>
                    <div style={expiryRiskMiniValue}>{formatAed(nearExpiryStockValue)}</div>
                    <div style={kpiHint}>Items requiring near-term stock planning.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #3557ab" }}>
                    <div style={statLabel}>SHORTAGE REQUESTS TODAY</div>
                    <div style={statValue}>{formatQty(animShortageToday)}</div>
                    <div style={kpiHint}>Current shortage pressure logged today.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #4267bb" }}>
                    <div style={statLabel}>ACTIVE SITES</div>
                    <div style={statValue}>{formatQty(animActiveSites)}</div>
                    <div style={kpiHint}>Sites currently contributing activity data.</div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #0ea5e9" }}>
                    <div style={statLabel}>LIVE OPERATIONS</div>
                    <div style={liveOpsGrid}>
                      <div style={liveOpsRow}>
                        <span style={liveOpsLabel}>Stock Movements Today</span>
                        <strong style={liveOpsValue}>{Number(liveOperationsToday || 0).toLocaleString()}</strong>
                      </div>
                      <div style={liveOpsRow}>
                        <span style={liveOpsLabel}>Transfers Today</span>
                        <strong style={liveOpsValue}>{Number(transfersToday || 0).toLocaleString()}</strong>
                      </div>
                      <div style={liveOpsRow}>
                        <span style={liveOpsLabel}>Purchase Requests</span>
                        <strong style={liveOpsValue}>{Number(purchaseRequests || 0).toLocaleString()}</strong>
                      </div>
                      <div style={liveOpsRow}>
                        <span style={liveOpsLabel}>Recent Actions</span>
                        <strong style={liveOpsValue}>{Number(recentActionsCount || 0).toLocaleString()}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #1f3c88" }}>
                    <div style={statLabel}>INVENTORY FINANCIAL IMPACT</div>
                    <div style={{ ...statValue, fontSize: "26px" }}>
                      {formatAed(animFinancialImpact)}
                    </div>
                    <div style={financialSubline}>
                      Near-expiry Risk {formatAed(expiryRiskExposure)} | Total Qty {formatQty(totalQty)}
                    </div>
                  </div>

                  <div className="ui-hover-lift" style={{ ...statCard, ...(isCommandCenterMode ? commandModeStatCard : null), borderTop: "4px solid #2f4f9f" }}>
                    <div style={statLabel}>FINANCIAL EXPOSURE</div>
                    <div style={{ ...statValue, fontSize: "26px" }}>
                      {formatAed(totalFinancialExposure)}
                    </div>
                    <div style={financialExposureBreakdown}>
                      Expiry Risk: {formatAed(expiryRiskExposure)}<br />
                      Dead Stock: {formatAed(deadStockExposure)}<br />
                      Shortage Risk: {formatAed(shortageRiskExposure)}
                    </div>
                  </div>
                </div>

                <div style={{ ...contentCard, ...(isCommandCenterMode ? commandModeContentCard : null), ...(isCommandCenterMode ? commandModeHeatmapCard : null) }}>
                  <h3 style={sectionTitle}>Inventory Risk Heatmap</h3>

                  {heatmapLoading ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>Loading inventory risk...</div>
                  ) : inventoryRiskHeatmap.length === 0 ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>No inventory risk data available.</div>
                  ) : (
                    <div style={heatmapGrid}>
                      {inventoryRiskHeatmap.map((row, idx) => {
                        const severity =
                          row.issueCount <= 0 ? "green" : row.issueCount <= 2 ? "yellow" : "red";
                        const indicatorStyle =
                          severity === "green"
                            ? heatIndicatorGreen
                            : severity === "yellow"
                              ? heatIndicatorYellow
                              : heatIndicatorRed;

                        return (
                          <div key={`${row.pharmacyId}-${idx}`} style={heatmapCard}>
                            <div style={heatmapCardHeader}>
                              <div style={heatmapPharmacyName}>{row.pharmacyName}</div>
                              <span style={{ ...heatIndicatorBase, ...indicatorStyle }}>
                                {severity === "green" ? "Green" : severity === "yellow" ? "Yellow" : "Red"}
                              </span>
                            </div>
                            <div style={heatmapMetricsRow}>
                              <div style={heatmapMetricBox}>
                                <div style={heatmapMetricLabel}>Low Stock</div>
                                <div style={heatmapMetricValue}>{Number(row.lowStockCount || 0)}</div>
                              </div>
                              <div style={heatmapMetricBox}>
                                <div style={heatmapMetricLabel}>Near Expiry</div>
                                <div style={heatmapMetricValue}>{Number(row.nearExpiryCount || 0)}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div style={{ ...liveActivityStrip, ...(isCommandCenterMode ? commandModeBar : null) }}>
                  <div>
                    <div style={liveActivityStripTitle}>Live Activity</div>
                    <div style={liveActivityStripValue}>
                      {Number(liveOperationsToday || 0).toLocaleString()} operations today
                    </div>
                  </div>
                  <div style={liveActivityBadge}>
                    <span style={liveActivityDot} />
                    LIVE
                  </div>
                </div>

                <div style={{ ...contentCard, ...(isCommandCenterMode ? commandModeContentCard : null) }}>
                  <h3 style={sectionTitle}>Recent Activity</h3>

                  {activityLoading ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>Loading recent activity...</div>
                  ) : recentActivity.length === 0 ? (
                    <div style={{ color: "#94a3b8", fontSize: "13px", padding: "10px 0" }}>No recent activity available.</div>
                  ) : (
                    recentActivity.map((item, idx) => {
                      const isLast = idx === recentActivity.length - 1;
                      const movementType = String(item.type || "").trim().toLowerCase();
                      const isAdd = movementType === "add";
                      const isUpdate = movementType === "update";
                      const isDelete = movementType === "delete";
                      const tagBg =
                        isAdd ? "#dcfce7" :
                        isUpdate ? "#fef3c7" :
                        isDelete ? "#fee2e2" : "#eaf0ff";
                      const tagColor =
                        isAdd ? "#166534" :
                        isUpdate ? "#92400e" :
                        isDelete ? "#991b1b" : "#1f3c88";
                      const tagBorderColor =
                        isAdd ? "#86efac" :
                        isUpdate ? "#fde68a" :
                        isDelete ? "#fecaca" : "#bfdbfe";
                      const barColor =
                        isAdd ? "#22c55e" :
                        isUpdate ? "#f59e0b" :
                        isDelete ? "#ef4444" : "#1f3c88";
                      return (
                        <div
                          key={`activity-${idx}`}
                          style={{ ...activityItem, ...(isLast ? { borderBottom: "none" } : {}) }}
                        >
                          <div style={{ ...activityBarBlue, background: barColor }} />
                          <div style={activityContent}>
                            <div style={activityTitleRow}>
                              <span style={{ ...activityTagBase, background: tagBg, color: tagColor, borderColor: tagBorderColor }}>
                                {item.type}
                              </span>
                              <span style={activityTitle}>{item.title}</span>
                            </div>
                            <div style={activityText}>{item.subtitle}</div>
                            <div style={activityTimestamp}>{item.timestampLabel}</div>
                            {item.created_by ? (
                              <div style={{ ...activityText, fontSize: "12px" }}>by {item.created_by}</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div style={{ ...contentCard, ...(isCommandCenterMode ? commandModeContentCard : null) }}>
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

                <div style={{ ...contentCard, ...(isCommandCenterMode ? commandModeContentCard : null) }}>
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
      {!isCommandCenterMode ? (
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
                <div style={userLabel}>{isDemoMode ? "Demo Session" : "Active Session"}</div>
                <div style={userEmail}>{sessionHeadline}</div>
                <div style={planRow}>
                  <span style={{ ...planBadge, ...(isDemoMode ? demoPlanBadge : null) }}>{sessionPlanLabel}</span>
                  <span style={{ ...planStatusBadge, ...(isDemoMode ? demoStatusBadge : null) }}>{sessionStatusLabel}</span>
                </div>
                {sessionHint ? (
                  <div style={planHint}>{sessionHint}</div>
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
      ) : null}

      <main
        className={isCommandCenterMode ? "dashboard-command-mode" : ""}
        style={{ ...main, ...(isCommandCenterMode ? commandModeMain : null) }}
      >
        {accessNotice ? (
          <div style={accessNoticeCard}>
            <div style={accessNoticeTitle}>Plan Access</div>
            <div style={accessNoticeText}>{accessNotice}</div>
          </div>
        ) : null}
        {isDemoMode ? (
          <div style={demoPreviewBanner}>
            <div>
              <div style={demoPreviewTitle}>Demo Session</div>
              <div style={demoPreviewText}>Enterprise Preview unlocked for executive presentation mode.</div>
            </div>
            <div style={demoPreviewPill}>Read-only where available</div>
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

const demoPlanBadge = {
  background: "linear-gradient(135deg, rgba(250,204,21,0.2), rgba(59,130,246,0.2))",
  color: "#fef3c7",
  border: "1px solid rgba(250,204,21,0.34)",
};

const demoStatusBadge = {
  background: "rgba(14,165,233,0.16)",
  color: "#dbeafe",
  border: "1px solid rgba(125,211,252,0.3)",
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

const demoPreviewBanner = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  padding: "16px 18px",
  marginBottom: "18px",
  borderRadius: "18px",
  border: "1px solid #bfdbfe",
  background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 55%, #f8fafc 100%)",
  boxShadow: "0 18px 40px rgba(37,99,235,0.12)",
};

const demoPreviewTitle = {
  fontSize: "12px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#1d4ed8",
  marginBottom: "4px",
};

const demoPreviewText = {
  color: "#1e3a8a",
  fontSize: "14px",
  fontWeight: 600,
};

const demoPreviewPill = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.74)",
  color: "#1e40af",
  border: "1px solid rgba(59,130,246,0.2)",
  fontSize: "12px",
  fontWeight: 700,
  whiteSpace: "nowrap",
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
  background: "rgba(59,130,246,0.14)",
  color: "#ffffff",
  fontWeight: 700,
  borderRadius: "10px",
  borderLeft: "3px solid #3b82f6",
  boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.22), 0 1px 3px rgba(15,23,42,0.14)",
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

const commandModeMain = {
  maxWidth: "100%",
  width: "100%",
  padding: "34px",
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

const headerControlsRow = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const commandCenterButton = {
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  padding: "7px 12px",
  border: "1px solid transparent",
  cursor: "pointer",
  boxShadow: "none",
};

const commandCenterButtonOff = {
  background: "#eff6ff",
  color: "#1d4ed8",
  borderColor: "#bfdbfe",
};

const commandCenterButtonOn = {
  background: "#1f3c88",
  color: "#ffffff",
  borderColor: "#1f3c88",
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

const commandModeInsightBox = {
  padding: "24px",
  marginBottom: "26px",
  fontSize: "15px",
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

const commandModeCardsGrid = {
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "28px",
  marginBottom: "28px",
};

const statCard = {
  background: "white",
  borderRadius: "14px",
  padding: "18px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  textAlign: "center",
  border: "1px solid #e5eaf2",
};

const commandModeStatCard = {
  padding: "22px",
  transform: "scale(1.05)",
  transformOrigin: "center",
};

const riskKpiCard = {
  background: "white",
  borderRadius: "14px",
  padding: "20px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
  border: "1px solid #e5eaf2",
  marginBottom: "20px",
  textAlign: "left",
};

const commandModeRiskKpiCard = {
  padding: "24px",
  marginBottom: "24px",
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

const riskKpiValue = {
  ...statValue,
  fontSize: "40px",
};

const kpiHint = {
  marginTop: "10px",
  fontSize: "12px",
  color: "#94a3b8",
  lineHeight: 1.5,
};

const expiryRiskMiniLabel = {
  marginTop: "6px",
  fontSize: "12px",
  color: "#6b7280",
  fontWeight: 600,
};

const expiryRiskMiniValue = {
  fontSize: "12px",
  color: "#6b7280",
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

const riskBadgeStable = {
  ...riskBadgeBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #86efac",
};

const riskBadgeAttention = {
  ...riskBadgeBase,
  background: "#fef9c3",
  color: "#854d0e",
  border: "1px solid #fde047",
};

const riskBadgeCritical = {
  ...riskBadgeBase,
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fca5a5",
};

const riskHint = {
  marginTop: "10px",
  fontSize: "12px",
  color: "#94a3b8",
  lineHeight: 1.5,
};

const liveOpsGrid = {
  marginTop: "6px",
  display: "grid",
  gap: "6px",
};

const liveOpsRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
};

const liveOpsLabel = {
  fontSize: "12px",
  color: "#6b7280",
};

const liveOpsValue = {
  fontSize: "16px",
  color: "#0f172a",
  fontWeight: 700,
};

const financialSubline = {
  marginTop: "8px",
  fontSize: "11px",
  color: "#94a3b8",
  lineHeight: 1.5,
  fontWeight: 600,
  letterSpacing: "0.02em",
};

const financialExposureBreakdown = {
  marginTop: "8px",
  fontSize: "11px",
  color: "#94a3b8",
  lineHeight: 1.55,
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

const commandModeContentCard = {
  padding: "24px",
  marginBottom: "28px",
};

const commandModeHeaderCard = {
  padding: "28px",
  marginBottom: "28px",
};

const commandModeBar = {
  padding: "12px 16px",
  marginBottom: "20px",
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

const dataStatusBar = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "10px",
  background: "#f8fbff",
  border: "1px solid #dbeafe",
  borderRadius: "12px",
  padding: "10px 14px",
  marginBottom: "16px",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.04)",
};

const dataStatusLabel = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#1d4ed8",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

const dataStatusValue = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#0f172a",
};

const dataStatusSource = {
  marginLeft: "auto",
  fontSize: "12px",
  color: "#64748b",
};

const systemHealthBar = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "10px",
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "9px 14px",
  marginBottom: "16px",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.04)",
};

const systemHealthLabel = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#0f172a",
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

const systemHealthPill = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "3px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  border: "1px solid transparent",
};

const systemHealthOperational = {
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #bbf7d0",
};

const systemHealthWarning = {
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const systemHealthCritical = {
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fecaca",
};

const systemHealthSubtitle = {
  fontSize: "12px",
  color: "#64748b",
  marginLeft: "auto",
};

const liveActivityStrip = {
  background: "linear-gradient(180deg, #f8fbff 0%, #f1f6ff 100%)",
  border: "1px solid #dbe8ff",
  borderRadius: "14px",
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const liveActivityStripTitle = {
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#1f3c88",
};

const liveActivityStripValue = {
  marginTop: "2px",
  fontSize: "14px",
  fontWeight: 600,
  color: "#1e293b",
};

const liveActivityBadge = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 10px",
  borderRadius: "999px",
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.06em",
};

const liveActivityDot = {
  width: "7px",
  height: "7px",
  borderRadius: "50%",
  background: "#2563eb",
  boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.14)",
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

const activityTimestamp = {
  color: "#94a3b8",
  fontSize: "12px",
  marginTop: "2px",
};

const heatmapGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const heatmapCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "12px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
};

const commandModeHeatmapCard = {
  borderWidth: "2px",
  boxShadow: "0 14px 30px rgba(15, 23, 42, 0.08)",
};

const heatmapCardHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "10px",
  marginBottom: "10px",
};

const heatmapPharmacyName = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#1e293b",
};

const heatIndicatorBase = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  border: "1px solid transparent",
};

const heatIndicatorGreen = {
  background: "#dcfce7",
  color: "#166534",
  borderColor: "#bbf7d0",
};

const heatIndicatorYellow = {
  background: "#fef3c7",
  color: "#92400e",
  borderColor: "#fde68a",
};

const heatIndicatorRed = {
  background: "#fee2e2",
  color: "#991b1b",
  borderColor: "#fecaca",
};

const heatmapMetricsRow = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
};

const heatmapMetricBox = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  padding: "8px 10px",
};

const heatmapMetricLabel = {
  color: "#64748b",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  fontWeight: 600,
};

const heatmapMetricValue = {
  marginTop: "4px",
  color: "#0f172a",
  fontSize: "18px",
  fontWeight: 700,
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