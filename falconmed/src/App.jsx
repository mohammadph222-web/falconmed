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
import { AuthContext } from "./lib/authContext";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "drugsearch", label: "Drug Search" },
  { key: "expiry", label: "Expiry Tracker" },
  { key: "shortage", label: "Shortage Tracker" },
  { key: "reports", label: "Reports" },
  { key: "labels", label: "Label Builder" },
  { key: "billing", label: "Billing" },
  { key: "refill", label: "Refill Tracker" },
];

const ROLE_ACCESS = {
  admin: NAV_ITEMS.map((x) => x.key),
  manager: ["dashboard", "drugsearch", "expiry", "shortage"],
  pharmacist: ["drugsearch", "labels", "shortage"],
  storekeeper: ["drugsearch", "expiry"],
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

const getSafePage = (requestedPage, allowedPages) => {
  if (allowedPages.includes(requestedPage)) return requestedPage;
  if (allowedPages.includes("dashboard")) return "dashboard";
  return allowedPages[0] || "dashboard";
};

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState("admin");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(getPageFromHash);

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
    const handleHashChange = () => {
      setPage(getPageFromHash());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const allowedPages = ROLE_ACCESS[role] || ROLE_ACCESS.admin;

  useEffect(() => {
    const safePage = getSafePage(page, allowedPages);
    if (safePage !== page) {
      setPage(safePage);
    }
  }, [page, allowedPages]);

  useEffect(() => {
    if (!page) return;
    const nextHash = `#${page}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [page]);

  const navigateTo = (nextPage) => {
    setPage(getSafePage(nextPage, allowedPages));
  };

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
      default:
        return (
          <>
            <div style={headerCard}>
              <h1 style={headerTitle}>FalconMed Dashboard</h1>
              <p style={headerText}>Welcome back, {user.email}</p>
            </div>

            <div style={cardsGrid}>
              <div style={statCard}>
                <div style={statLabel}>System Status</div>
                <div style={statValue}>Active</div>
              </div>

              <div style={statCard}>
                <div style={statLabel}>Main Module</div>
                <div style={statValue}>Drug Search</div>
              </div>

              <div style={statCard}>
                <div style={statLabel}>Records Loaded</div>
                <div style={statValue}>22,451</div>
              </div>
            </div>

            <div style={contentCard}>
              <h3 style={sectionTitle}>Overview</h3>
              <p style={sectionText}>
                Stable FalconMed version with secure login and restored modules.
                You can now navigate between dashboard, drug search, expiry,
                shortage, reports, labels, billing, and refill tracker.
              </p>
            </div>
          </>
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
  background: "#f3f6fb",
  fontFamily: "Arial, sans-serif",
};

const sidebar = {
  width: "270px",
  background: "#0f172a",
  color: "white",
  padding: "24px 18px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "2px 0 12px rgba(0,0,0,0.08)",
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
  padding: "12px 14px",
  marginTop: "10px",
  background: "#1e293b",
  color: "white",
  border: "1px solid #334155",
  borderRadius: "10px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "15px",
};

const activeBtn = {
  ...btn,
  background: "#2563eb",
  border: "1px solid #2563eb",
};

const logoutBtn = {
  display: "block",
  width: "100%",
  padding: "12px 14px",
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "15px",
};

const main = {
  flex: 1,
  padding: "28px",
};

const headerCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "20px",
};

const headerTitle = {
  margin: 0,
  fontSize: "30px",
  color: "#0f172a",
};

const headerText = {
  marginTop: "8px",
  color: "#475569",
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "20px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const statLabel = {
  fontSize: "13px",
  color: "#64748b",
  marginBottom: "10px",
};

const statValue = {
  fontSize: "28px",
  fontWeight: "bold",
  color: "#0f172a",
};

const contentCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
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