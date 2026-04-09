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

const NAV_ITEMS = [
  { page: "dashboard", label: "Dashboard" },
  { page: "inventory-overview", label: "Inventory Overview" },
  { page: "drugsearch", label: "Drug Search" },
  { page: "expiry", label: "Expiry Tracker" },
  { page: "shortage", label: "Shortage Tracker" },
  { page: "stock-movement-v1", label: "Stock Movement V1" },
  { page: "stocktaking", label: "Stocktaking" },
  { page: "billing", label: "Billing" },
  { page: "refill", label: "Refill Tracker" },
  { page: "labels", label: "Labels" },
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
            <p style={brandSub}>Single Pharmacy Professional System v1</p>
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

          <div style={navWrap}>
            {NAV_ITEMS.map((item) => (
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

        <div style={sidebarFooter}>FalconMed v1.0</div>
      </aside>

      <main style={main}>{renderPage()}</main>
    </div>
  );
}

const layout = {
  display: "flex",
  minHeight: "100vh",
  background: "#f3f6fb",
  fontFamily: "'Plus Jakarta Sans', 'Segoe UI', sans-serif",
};

const sidebar = {
  width: "280px",
  minWidth: "280px",
  background: "linear-gradient(180deg, #162c44 0%, #19334f 100%)",
  color: "#f8fafc",
  borderRight: "1px solid #2d465f",
  padding: "17px 15px 14px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "14px",
};

const sidebarSections = {
  display: "grid",
  gap: "12px",
};

const brandCard = {
  border: "1px solid rgba(170, 199, 229, 0.16)",
  borderRadius: "12px",
  background: "rgba(14, 35, 60, 0.2)",
  padding: "12px 13px",
};

const brandTitle = {
  margin: 0,
  fontSize: "23px",
  fontWeight: 750,
};

const brandSub = {
  marginTop: "5px",
  marginBottom: 0,
  color: "#b9cde2",
  fontSize: "11px",
};

const userCard = {
  border: "1px solid rgba(170, 199, 229, 0.14)",
  borderRadius: "12px",
  background: "rgba(14, 35, 60, 0.17)",
  padding: "12px 13px",
};

const userLabel = {
  fontSize: "10px",
  color: "#95aac0",
};

const userEmail = {
  marginTop: "7px",
  fontSize: "13px",
};

const signOutButton = {
  marginTop: "11px",
  width: "100%",
  borderRadius: "9px",
  border: "1px solid #476784",
  background: "#325674",
  color: "#f8fafc",
  padding: "7px 10px",
  cursor: "pointer",
};

const navWrap = {
  marginTop: "2px",
  display: "grid",
  gap: "6px",
};

const navButton = {
  border: "1px solid rgba(170, 199, 229, 0.1)",
  borderRadius: "9px",
  background: "rgba(14, 35, 60, 0.1)",
  color: "#cfe1f4",
  padding: "8px 10px",
  textAlign: "left",
  fontSize: "12.5px",
  cursor: "pointer",
};

const activeNavButton = {
  ...navButton,
  border: "1px solid #8cb4d5",
  background: "linear-gradient(135deg, #35668f 0%, #3f729d 100%)",
  color: "#f6fbff",
};

const sidebarFooter = {
  color: "#c1d2e4",
  fontSize: "11px",
  textAlign: "center",
};

const main = {
  flex: 1,
  minWidth: 0,
  padding: "24px",
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