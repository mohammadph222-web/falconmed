import { useState } from "react";
import Login from "./Login";
import { useAuthContext } from "./lib/authContext";

import SinglePharmacyDashboard from "./SinglePharmacyDashboard";
import InventoryOverviewPage from "./InventoryOverviewPage";
import DrugSearch from "./DrugSearch";
import ExpiryTracker from "./ExpiryTracker";
import ShortageTracker from "./ShortageTracker";
import StockMovementPage from "./StockMovementPage";
import Stocktaking from "./Stocktaking";
import Billing from "./Billing";
import LabelStudio from "./LabelStudio";
import RefillTracker from "./RefillTracker";

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [
      { page: "dashboard", label: "Dashboard" },
      { page: "inventory-overview", label: "Inventory Overview" },
    ],
  },
  {
    title: "Operations",
    items: [
      { page: "stock-movement-v1", label: "Stock Movement" },
      { page: "stocktaking", label: "Stocktaking" },
      { page: "billing", label: "Billing" },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { page: "shortage", label: "Shortage Tracker" },
      { page: "expiry", label: "Expiry Tracker" },
      { page: "refill", label: "Refill Tracker" },
    ],
  },
  {
    title: "Tools",
    items: [
      { page: "drugsearch", label: "Drug Search" },
      { page: "labels", label: "Labels" },
    ],
  },
];

export default function App() {
  const { user, loading: authLoading, signOut } = useAuthContext();
  const [page, setPage] = useState("dashboard");

  if (authLoading) {
    return (
      <div style={sessionShell}>
        <div style={sessionCard}>
          <h1 style={sessionTitle}>Loading FalconMed</h1>
          <p style={sessionText}>Preparing your single-pharmacy workspace.</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <SinglePharmacyDashboard />;
      case "inventory-overview":
        return <InventoryOverviewPage />;
      case "drugsearch":
        return <DrugSearch />;
      case "expiry":
        return <ExpiryTracker />;
      case "shortage":
        return <ShortageTracker />;
      case "stock-movement-v1":
        return <StockMovementPage />;
      case "stocktaking":
        return <Stocktaking />;
      case "billing":
        return <Billing />;
      case "refill":
        return <RefillTracker />;
      case "labels":
        return <LabelStudio />;
      default:
        return <SinglePharmacyDashboard />;
    }
  };

  return (
    <div style={layout}>
      <aside style={sidebar}>
        <div style={sidebarSections}>
          <div style={brandCard}>
            <h2 style={brandTitle}>FalconMed</h2>
            <p style={brandSub}>Single Pharmacy Professional System</p>
          </div>

          <div style={navWrap}>
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} style={navGroup}>
                <div style={sectionLabel}>{section.title}</div>
                <div style={navGroupItems}>
                  {section.items.map((item) => (
                    <button
                      key={item.page}
                      type="button"
                      style={page === item.page ? activeNavButton : navButton}
                      className={
                        page === item.page
                          ? "sidebar-nav-button sidebar-nav-button-active"
                          : "sidebar-nav-button"
                      }
                      onClick={() => setPage(item.page)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={userCard}>
            <div style={userLabel}>Active User</div>
            <div style={userEmail}>{user.email || "Signed in"}</div>
            <button
              type="button"
              style={signOutButton}
              className="sidebar-signout-button"
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        </div>

        <div style={sidebarFooter}>FalconMed v1.0</div>
      </aside>

      <main style={main}>{renderPage()}</main>
    </div>
  );
}

const layout = {
  display: "flex",
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
};

const sidebar = {
  width: "272px",
  minWidth: "272px",
  background: "#0f172a",
  color: "#cbd5e1",
  borderRight: "1px solid #1e293b",
  padding: "16px 14px 14px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "12px",
};

const sidebarSections = {
  display: "grid",
  gap: "12px",
};

const brandCard = {
  borderRadius: "14px",
  background: "linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.03) 100%)",
  border: "1px solid rgba(148, 163, 184, 0.24)",
  padding: "13px 14px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
};

const brandTitle = {
  margin: 0,
  fontSize: "20px",
  fontWeight: 800,
  color: "#f1f5f9",
  letterSpacing: "-0.02em",
};

const brandSub = {
  marginTop: "4px",
  marginBottom: 0,
  color: "#94a3b8",
  fontSize: "11px",
  lineHeight: 1.4,
};

const userCard = {
  marginTop: "4px",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: "12px",
  background: "rgba(15, 23, 42, 0.28)",
  padding: "11px 12px",
};

const userLabel = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#94a3b8",
};

const userEmail = {
  marginTop: "5px",
  fontSize: "12px",
  color: "#e2e8f0",
  wordBreak: "break-all",
  lineHeight: 1.45,
};

const signOutButton = {
  marginTop: "8px",
  width: "100%",
  borderRadius: "9px",
  border: "1px solid #334155",
  background: "rgba(15, 23, 42, 0.35)",
  color: "#cbd5e1",
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 700,
  boxShadow: "0 4px 10px rgba(2, 6, 23, 0.24)",
};

const navWrap = {
  marginTop: "3px",
  display: "grid",
  gap: "13px",
};

const navGroup = {
  display: "grid",
  gap: "8px",
};

const sectionLabel = {
  fontSize: "10px",
  color: "#7c8da3",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  fontWeight: 700,
  padding: "0 3px",
};

const navGroupItems = {
  display: "grid",
  gap: "6px",
  borderTop: "1px solid rgba(148, 163, 184, 0.12)",
  paddingTop: "8px",
};

const navButton = {
  border: "1px solid rgba(148, 163, 184, 0.10)",
  borderRadius: "10px",
  background: "transparent",
  color: "#cbd5e1",
  padding: "8px 11px",
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "none",
  transition: "background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease",
};

const activeNavButton = {
  ...navButton,
  border: "1px solid rgba(59, 130, 246, 0.65)",
  background: "linear-gradient(180deg, rgba(37, 99, 235, 0.28) 0%, rgba(37, 99, 235, 0.16) 100%)",
  color: "#ffffff",
  fontWeight: 700,
  boxShadow: "inset 3px 0 0 #3b82f6, 0 8px 14px rgba(15, 23, 42, 0.3)",
};

const sidebarFooter = {
  color: "#74869d",
  fontSize: "10.5px",
  textAlign: "center",
  paddingTop: "10px",
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
};

const main = {
  flex: 1,
  minWidth: 0,
  padding: "30px 30px 42px",
  background: "#f8fafc",
};

const sessionShell = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const sessionCard = {
  width: "min(560px, 100%)",
  background: "#ffffff",
  border: "1px solid #d9e3f0",
  borderRadius: "16px",
  padding: "28px",
};

const sessionTitle = {
  margin: 0,
  fontSize: "28px",
};

const sessionText = {
  marginTop: "10px",
};