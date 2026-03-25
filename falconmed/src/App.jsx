import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Login from "./Login";

import DrugSearch from "./DrugSearch";
import ExpiryTracker from "./ExpiryTracker";
import ShortageTracker from "./ShortageTracker";
import Reports from "./Reports";
import LabelBuilder from "./LabelBuilder";
import Billing from "./Billing";
import RefillTracker from "./RefillTracker";
import HomeDeliveryTracker from "./HomeDeliveryTracker";
import AdminPanel from "./AdminPanel";
import { AuthContext } from "./lib/authContext";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "drugsearch", label: "Drug Search" },
  { key: "expiry", label: "Expiry Tracker" },
  { key: "shortage", label: "Shortage Tracker" },
  { key: "reports", label: "Reports" },
  { key: "admin", label: "Super Admin" },
  { key: "labels", label: "Label Builder" },
  { key: "billing", label: "Billing" },
  { key: "refill", label: "Refill Tracker" },
  { key: "delivery", label: "Home Delivery Tracker" },
];

const ROLE_ACCESS = {
  admin: NAV_ITEMS.map((x) => x.key),
  manager: ["dashboard", "drugsearch", "expiry", "shortage", "delivery"],
  pharmacist: ["drugsearch", "labels", "shortage", "delivery"],
  storekeeper: ["drugsearch", "expiry", "delivery"],
};

const getRoleName = (rawRole) => {
  const normalizedRole = (rawRole || "").toLowerCase();
  return ROLE_ACCESS[normalizedRole] ? normalizedRole : "admin";
};

const getPageFromHash = () => {
  const hash = (window.location.hash || "").replace("#", "").trim();
  if (!hash) return "dashboard";
  return NAV_ITEMS.some((x) => x.key === hash) ? hash : "dashboard";
};

const getPageFromLocation = () => {
  if (window.location.pathname === "/admin") return "admin";
  return getPageFromHash();
};

const getSafePage = (requestedPage, allowedPages) => {
  if (allowedPages.includes(requestedPage)) return requestedPage;
  if (allowedPages.includes("dashboard")) return "dashboard";
  return allowedPages[0] || "dashboard";
};

const getTotalDrugsFromCsv = () => {
  try {
    const lines = String(drugsMasterCsv || "")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");

    if (lines.length < 2) return 0;
    return Math.max(lines.length - 1, 0);
  } catch (_err) {
    return 0;
  }
};

const getActivityColor = (moduleName) => {
  switch (String(moduleName || "").toLowerCase()) {
    case "expiry":
      return "#f59e0b";
    case "shortage":
      return "#ef4444";
    case "refill":
      return "#3b82f6";
    case "delivery":
      return "#10b981";
    default:
      return "#94a3b8";
  }
};

const formatActivityTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

const CSV_TOTAL_DRUGS = getTotalDrugsFromCsv();

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState("admin");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(getPageFromLocation);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardData, setDashboardData] = useState({
    totalDrugs: 0,
    nearExpiryItems: 0,
    shortageToday: 0,
    activeSites: 0,
    recentActivity: [],
  });

  const ensureUserProfile = async (authUser) => {
    if (!authUser?.id || !supabase) return;

    try {
      const { data: profile, error: fetchError } = await supabase
        .from("profiles")
        .select(
          "id, full_name, role, organization_id, site_id, organizations:organization_id(id, name), sites:site_id(id, name)"
        )
        .eq("id", authUser.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Failed to fetch profile:", fetchError.message);
        return;
      }

      if (!profile) {
        const defaultOrgName = `${authUser.email || "User"} Organization`;
        const defaultSiteName = "Main Site";

        const { data: newOrg, error: orgError } = await supabase
          .from("organizations")
          .insert({ name: defaultOrgName })
          .select("id, name")
          .single();

        if (orgError) {
          console.error("Failed to create default organization:", orgError.message);
          return;
        }

        const { data: newSite, error: siteError } = await supabase
          .from("sites")
          .insert({
            organization_id: newOrg.id,
            name: defaultSiteName,
          })
          .select("id, name")
          .single();

        if (siteError) {
          console.error("Failed to create default site:", siteError.message);
          return;
        }

        const { data: newProfile, error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: authUser.id,
            full_name: authUser.user_metadata?.full_name ?? null,
            role: "admin",
            organization_id: newOrg.id,
            site_id: newSite.id,
          })
          .select(
            "id, full_name, role, organization_id, site_id, organizations:organization_id(id, name), sites:site_id(id, name)"
          )
          .single();

        if (insertError) {
          console.error("Failed to create profile:", insertError.message);
          return;
        }

        setProfile(newProfile);
        return;
      }

      if (!profile.organization_id || !profile.site_id) {
        const defaultOrgName = `${authUser.email || "User"} Organization`;
        const defaultSiteName = "Main Site";

        let organizationId = profile.organization_id;
        let siteId = profile.site_id;

        if (!organizationId) {
          const { data: newOrg, error: orgError } = await supabase
            .from("organizations")
            .insert({ name: defaultOrgName })
            .select("id")
            .single();

          if (orgError) {
            console.error("Failed to create default organization:", orgError.message);
            return;
          }

          organizationId = newOrg.id;
        }

        if (!siteId) {
          const { data: newSite, error: siteError } = await supabase
            .from("sites")
            .insert({
              organization_id: organizationId,
              name: defaultSiteName,
            })
            .select("id")
            .single();

          if (siteError) {
            console.error("Failed to create default site:", siteError.message);
            return;
          }

          siteId = newSite.id;
        }

        const { data: updatedProfile, error: updateError } = await supabase
          .from("profiles")
          .update({
            organization_id: organizationId,
            site_id: siteId,
          })
          .eq("id", authUser.id)
          .select(
            "id, full_name, role, organization_id, site_id, organizations:organization_id(id, name), sites:site_id(id, name)"
          )
          .single();

        if (updateError) {
          console.error("Failed to link profile to organization/site:", updateError.message);
          return;
        }

        setProfile(updatedProfile);
        return;
      }

      setProfile(profile);
    } catch (err) {
      console.error("Profile setup error:", err?.message || "Unknown error");
    }
  };

  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      void ensureUserProfile(data.session?.user);
      setLoading(false);
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      void ensureUserProfile(session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setRole(getRoleName(profile?.role));
  }, [profile?.role]);

  useEffect(() => {
    const handleLocationChange = () => {
      setPage(getPageFromLocation());
    };

    window.addEventListener("hashchange", handleLocationChange);
    window.addEventListener("popstate", handleLocationChange);

    return () => {
      window.removeEventListener("hashchange", handleLocationChange);
      window.removeEventListener("popstate", handleLocationChange);
    };
  }, []);

  const allowedPages = ROLE_ACCESS[role] || ROLE_ACCESS.admin;

  useEffect(() => {
    if (page === "admin" && profile && role !== "admin") {
      setPage("dashboard");
    }
  }, [page, profile, role]);

  useEffect(() => {
    const safePage = getSafePage(page, allowedPages);
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, allowedPages]);

  useEffect(() => {
    if (!page) return;

    if (page === "admin") {
      if (window.location.pathname !== "/admin") {
        window.history.pushState({}, "", "/admin");
      }
      return;
    }

    const targetUrl = `/#${page}`;
    const currentUrl = `${window.location.pathname}${window.location.hash}`;
    if (currentUrl !== targetUrl) {
      window.history.pushState({}, "", targetUrl);
    }
  }, [page]);

  const navigateTo = (nextPage) => {
    setPage(getSafePage(nextPage, allowedPages));
  };

  useEffect(() => {
    const loadDashboardData = async () => {
      if (!user?.id || !supabase) return;

      setDashboardLoading(true);

      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);

      const todayStr = todayStart.toISOString().slice(0, 10);
      const nearExpiryDate = new Date(todayStart);
      nearExpiryDate.setDate(nearExpiryDate.getDate() + 90);
      const nearExpiryStr = nearExpiryDate.toISOString().slice(0, 10);

      const applyScope = (query) => {
        let next = query;
        if (profile?.organization_id) {
          next = next.eq("organization_id", profile.organization_id);
        }
        if (profile?.site_id) {
          next = next.eq("site_id", profile.site_id);
        }
        return next;
      };

      const getCountFromTables = async (tables, queryBuilder) => {
        for (const table of tables) {
          try {
            const query = queryBuilder(supabase.from(table));
            const { count, error } = await query;
            if (!error) return count || 0;
          } catch (_err) {
            // Ignore table/column mismatches and keep trying fallbacks.
          }
        }
        return null;
      };

      try {
        const [
          totalDrugsCount,
          nearExpiryCount,
          shortageTodayCount,
          activeSitesCount,
        ] = await Promise.all([
          getCountFromTables(["drugs", "drugs_master", "drug_search"], (base) =>
            base.select("*", { count: "exact", head: true })
          ),
          getCountFromTables(["expiry_tracker", "expiry_records"], (base) =>
            applyScope(
              base
                .select("*", { count: "exact", head: true })
                .gte("expiry_date", todayStr)
                .lte("expiry_date", nearExpiryStr)
            )
          ),
          getCountFromTables(["shortage_tracker", "shortage_records"], (base) =>
            applyScope(
              base
                .select("*", { count: "exact", head: true })
                .gte("created_at", todayStart.toISOString())
                .lt("created_at", tomorrowStart.toISOString())
            )
          ),
          getCountFromTables(["sites"], (base) => {
            const scoped = profile?.organization_id
              ? base
                  .select("*", { count: "exact", head: true })
                  .eq("organization_id", profile.organization_id)
              : base.select("*", { count: "exact", head: true });
            return scoped;
          }),
        ]);

        const fallbackShortageToday = await getCountFromTables(
          ["shortage_tracker", "shortage_records"],
          (base) => applyScope(base.select("*", { count: "exact", head: true }).eq("request_date", todayStr))
        );

        let recentActivity = [];
        try {
          const { data: activityRows, error: activityError } = await supabase
            .from("activity_log")
            .select("id,module,action,description,created_at")
            .order("created_at", { ascending: false })
            .limit(10);

          if (activityError) {
            console.error("Failed to load activity timeline:", activityError.message);
          } else {
            recentActivity = (activityRows || []).map((row) => ({
              id: `activity-${row.id || row.created_at || Math.random().toString(36).slice(2, 8)}`,
              module: row.module || "General",
              action: row.action || "Updated",
              title: `${row.module || "Activity"} ${row.action || "Updated"}`,
              subtitle: row.description || "Record updated",
              timestamp: row.created_at || "",
            }));
          }
        } catch (activityCatchErr) {
          console.error("Activity timeline load error:", activityCatchErr?.message || "Unknown error");
        }

        setDashboardData({
          totalDrugs: CSV_TOTAL_DRUGS,
          nearExpiryItems: nearExpiryCount ?? 0,
          shortageToday:
            shortageTodayCount !== null && shortageTodayCount !== undefined
              ? shortageTodayCount
              : fallbackShortageToday || 0,
          activeSites: activeSitesCount ?? 0,
          recentActivity,
        });
      } catch (err) {
        console.error("Failed to load dashboard metrics:", err?.message || "Unknown error");
        setDashboardData((prev) => ({
          ...prev,
          totalDrugs: CSV_TOTAL_DRUGS,
          recentActivity: [],
        }));
      } finally {
        setDashboardLoading(false);
      }
    };

    if (page === "dashboard") {
      void loadDashboardData();
    }
  }, [page, user?.id, profile?.organization_id, profile?.site_id]);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setRole("admin");
  };

  if (loading) {
    return (
      <div style={loadingWrap}>
        <div style={loadingCard}>
          <h2 style={{ margin: 0 }}>Loading FalconMed...</h2>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={setUser} />;
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
            <ExpiryTracker user={user} profile={profile} />
          </div>
        );
      case "shortage":
        return (
          <div style={contentCard}>
            <ShortageTracker user={user} profile={profile} />
          </div>
        );
      case "reports":
        return (
          <div style={contentCard}>
            <Reports />
          </div>
        );
      case "admin":
        return (
          <div style={contentCard}>
            <AdminPanel />
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
      case "delivery":
        return (
          <div style={contentCard}>
            <HomeDeliveryTracker />
          </div>
        );
      default:
        return (
          <div style={dashboardPageWrap}>
            <div style={dashboardHeaderCard}>
              <div style={dashboardHeaderInner}>
                <h1 style={dashboardHeaderTitle}>FalconMed Dashboard</h1>
                <p style={dashboardHeaderText}>Welcome back, {user.email}</p>
              </div>
            </div>

            <div style={dashboardCardsGrid}>
              <div style={dashboardStatCard}>
                <div style={dashboardStatAccent} />
                <div style={dashboardStatContent}>
                  <div style={dashboardStatLabel}>Total Drugs in Database</div>
                  <div style={dashboardStatValue}>{dashboardData.totalDrugs.toLocaleString()}</div>
                </div>
              </div>

              <div style={dashboardStatCard}>
                <div style={dashboardStatAccent} />
                <div style={dashboardStatContent}>
                  <div style={dashboardStatLabel}>Near Expiry Items</div>
                  <div style={dashboardStatValue}>{dashboardData.nearExpiryItems.toLocaleString()}</div>
                </div>
              </div>

              <div style={dashboardStatCard}>
                <div style={dashboardStatAccent} />
                <div style={dashboardStatContent}>
                  <div style={dashboardStatLabel}>Shortage Requests Today</div>
                  <div style={dashboardStatValue}>{dashboardData.shortageToday.toLocaleString()}</div>
                </div>
              </div>

              <div style={dashboardStatCard}>
                <div style={dashboardStatAccent} />
                <div style={dashboardStatContent}>
                  <div style={dashboardStatLabel}>Active Sites</div>
                  <div style={dashboardStatValue}>{dashboardData.activeSites.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div style={dashboardActivityCard}>
              <h3 style={dashboardActivityTitle}>Recent Activity</h3>

              {dashboardData.recentActivity.length === 0 && !dashboardLoading && (
                <p style={dashboardActivityEmpty}>No recent activity yet.</p>
              )}

              {dashboardData.recentActivity.length > 0 && (
                <div style={dashboardActivityList}>
                  {dashboardData.recentActivity.map((item) => (
                    <div key={item.id} style={dashboardActivityItem}>
                      <div
                        style={{
                          ...dashboardActivityDot,
                          background: getActivityColor(item.module),
                        }}
                      />
                      <div style={dashboardActivityTextWrap}>
                        <div style={dashboardActivityItemTitle}>{item.title}</div>
                        <div style={dashboardActivityItemSub}>{item.subtitle}</div>
                      </div>
                      <div style={dashboardActivityTime}>{formatActivityTime(item.timestamp)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={dashboardOverviewCard}>
              <h3 style={dashboardOverviewTitle}>Overview</h3>
              <p style={dashboardOverviewText}>
                Operational view powered by available live records. Dashboard
                metrics are scoped safely and fall back gracefully when some
                tables are unavailable.
              </p>
              {dashboardLoading && (
                <p style={dashboardOverviewLoadingText}>Loading latest dashboard data...</p>
              )}
            </div>
          </div>
        );
    }
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => allowedPages.includes(item.key));

  return (
    <AuthContext.Provider value={{ user, profile, role }}>
      <div style={layout}>
      <aside style={sidebar}>
        <div>
          <div style={brandBox}>
            <h2 style={brandTitle}>FalconMed</h2>
            <p style={brandSub}>Pharmacy Intelligence Platform</p>
          </div>

          <div style={userCard}>
            <div style={userLabel}>Signed in as</div>
            <div style={userEmail}>{user.email}</div>
          </div>

          {visibleNavItems.map((item) => (
            <button
              key={item.key}
              style={page === item.key ? activeBtn : btn}
              onClick={() => navigateTo(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button style={logoutBtn} onClick={logout}>
          Logout
        </button>
      </aside>

      <main style={main}>{renderPage()}</main>
      </div>
    </AuthContext.Provider>
  );
}

const layout = {
  display: "flex",
  minHeight: "100vh",
  background: "#f6f8fc",
  fontFamily: "Arial, sans-serif",
};

const sidebar = {
  width: "270px",
  background: "#0f172a",
  color: "white",
  padding: "22px 16px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "2px 0 10px rgba(2, 6, 23, 0.22)",
  borderRight: "1px solid rgba(148, 163, 184, 0.16)",
};

const brandBox = {
  marginBottom: "24px",
};

const brandTitle = {
  margin: 0,
  fontSize: "28px",
};

const brandSub = {
  marginTop: "6px",
  fontSize: "13px",
  color: "#cbd5e1",
};

const userCard = {
  background: "rgba(255,255,255,0.08)",
  borderRadius: "12px",
  padding: "14px",
  marginBottom: "20px",
};

const userLabel = {
  fontSize: "12px",
  color: "#cbd5e1",
  marginBottom: "6px",
};

const userEmail = {
  fontSize: "13px",
  wordBreak: "break-word",
};

const btn = {
  display: "block",
  width: "100%",
  padding: "11px 13px",
  marginTop: "9px",
  background: "#1e293b",
  color: "white",
  border: "1px solid #334155",
  borderRadius: "9px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  fontWeight: 600,
  transition: "all 0.18s ease",
};

const activeBtn = {
  ...btn,
  background: "#2563eb",
  border: "1px solid #2563eb",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.16) inset",
};

const logoutBtn = {
  display: "block",
  width: "100%",
  padding: "11px 13px",
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: "9px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "14px",
  fontWeight: 600,
  transition: "all 0.18s ease",
};

const main = {
  flex: 1,
  padding: "24px",
};

const dashboardPageWrap = {
  display: "grid",
  gap: "14px",
};

const dashboardHeaderCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  borderRadius: "20px",
  padding: "22px 24px",
  border: "1px solid #dbe5f0",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
  position: "relative",
  overflow: "hidden",
};

const dashboardHeaderInner = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const dashboardHeaderTitle = {
  margin: 0,
  fontSize: "34px",
  fontWeight: "700",
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.05,
};

const dashboardHeaderText = {
  marginTop: 0,
  marginBottom: 0,
  color: "#64748b",
  fontSize: "14px",
  lineHeight: 1.5,
};

const dashboardCardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "10px",
};

const dashboardStatCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  borderRadius: "18px",
  padding: "0",
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  minHeight: "132px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const dashboardStatAccent = {
  height: "4px",
  width: "100%",
  background: "linear-gradient(90deg, #2563eb, #60a5fa)",
};

const dashboardStatContent = {
  padding: "14px 16px 16px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "14px",
  flex: 1,
};

const dashboardStatLabel = {
  fontSize: "11px",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#64748b",
  lineHeight: 1.4,
};

const dashboardStatValue = {
  fontSize: "30px",
  fontWeight: "700",
  lineHeight: 1,
  color: "#0f172a",
  letterSpacing: "-0.03em",
};

const dashboardOverviewCard = {
  background: "white",
  borderRadius: "18px",
  padding: "16px 18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
};

const dashboardOverviewTitle = {
  marginTop: 0,
  marginBottom: "6px",
  color: "#0f172a",
  fontSize: "17px",
  fontWeight: "700",
};

const dashboardOverviewText = {
  color: "#475569",
  lineHeight: 1.55,
  marginBottom: 0,
  fontSize: "14px",
};

const dashboardActivityCard = {
  background: "white",
  borderRadius: "18px",
  padding: "16px 18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
};

const dashboardActivityTitle = {
  marginTop: 0,
  marginBottom: "10px",
  color: "#0f172a",
  fontSize: "17px",
  fontWeight: "700",
};

const dashboardActivityEmpty = {
  margin: 0,
  color: "#64748b",
  fontSize: "14px",
  lineHeight: 1.5,
};

const dashboardActivityList = {
  display: "grid",
  gap: "10px",
};

const dashboardActivityItem = {
  display: "grid",
  gridTemplateColumns: "8px 1fr auto",
  gap: "10px",
  alignItems: "center",
  padding: "12px 0",
  borderTop: "1px solid #eef2f7",
};

const dashboardActivityDot = {
  width: "8px",
  height: "28px",
  borderRadius: "99px",
};

const dashboardActivityTextWrap = {
  minWidth: 0,
};

const dashboardActivityItemTitle = {
  fontSize: "14px",
  fontWeight: "600",
  color: "#0f172a",
};

const dashboardActivityItemSub = {
  marginTop: "4px",
  fontSize: "13px",
  color: "#64748b",
  wordBreak: "break-word",
};

const dashboardActivityTime = {
  fontSize: "12px",
  color: "#94a3b8",
  whiteSpace: "nowrap",
};

const dashboardOverviewLoadingText = {
  color: "#64748b",
  lineHeight: 1.5,
  marginTop: "8px",
  marginBottom: 0,
  fontSize: "13px",
};

const contentCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.045)",
  border: "1px solid #e5eaf1",
};

const sectionTitle = {
  marginTop: 0,
  color: "#0f172a",
};

const sectionText = {
  color: "#475569",
  lineHeight: 1.7,
};

const loadingWrap = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "#f3f6fb",
};

const loadingCard = {
  background: "white",
  padding: "28px 36px",
  borderRadius: "16px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};