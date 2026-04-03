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
import LabelBuilder from "./LabelBuilder";

const NAV_ITEMS = [
  { page: "dashboard", label: "Dashboard" },
  { page: "inventory-overview", label: "Inventory Overview" },
  { page: "drugsearch", label: "Drug Search" },
  { page: "expiry", label: "Expiry Tracker" },
  { page: "shortage", label: "Shortage Tracker" },
  { page: "stock-movement-v1", label: "Stock Movement V1" },
  { page: "stocktaking", label: "Stocktaking" },
  { page: "billing", label: "Billing" },
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
      case "labels":
        return <LabelBuilder />;
      default:
        return <SinglePharmacyDashboard />;
    }
  };

  return (
    <div style={layout}>
      <aside style={sidebar}>
        <div>
          <div style={brandCard}>
            <h2 style={brandTitle}>FalconMed</h2>
            <p style={brandSub}>Single Pharmacy Professional System v1</p>
          </div>

          <div style={userCard}>
            <div style={userLabel}>Active User</div>
            <div style={userEmail}>{user.email || "Signed in"}</div>
            <button type="button" style={signOutButton} onClick={signOut}>
              Sign out
            </button>
          </div>

          <div style={navWrap}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.page}
                type="button"
                style={page === item.page ? activeNavButton : navButton}
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
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const sidebar = {
  width: "280px",
  minWidth: "280px",
  background: "#0f172a",
  color: "#f8fafc",
  borderRight: "1px solid #1e293b",
  padding: "18px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  gap: "16px",
};

const brandCard = {
  border: "1px solid #1e293b",
  borderRadius: "12px",
  background: "#111827",
  padding: "12px",
  marginBottom: "10px",
};

const brandTitle = {
  margin: 0,
  fontSize: "22px",
  lineHeight: 1.2,
};

const brandSub = {
  marginTop: "6px",
  marginBottom: 0,
  color: "#cbd5e1",
  fontSize: "12px",
};

const userCard = {
  border: "1px solid #334155",
  borderRadius: "12px",
  background: "#0b1220",
  padding: "12px",
};

const userLabel = {
  fontSize: "11px",
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 700,
};

const userEmail = {
  marginTop: "6px",
  fontSize: "13px",
  color: "#e2e8f0",
  wordBreak: "break-word",
};

const signOutButton = {
  marginTop: "12px",
  width: "100%",
  borderRadius: "8px",
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#f8fafc",
  padding: "8px 10px",
  cursor: "pointer",
  fontWeight: 600,
};

const navWrap = {
  marginTop: "12px",
  display: "grid",
  gap: "8px",
};

const navButton = {
  border: "1px solid transparent",
  borderRadius: "8px",
  background: "transparent",
  color: "#dbeafe",
  padding: "10px 12px",
  textAlign: "left",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const activeNavButton = {
  ...navButton,
  border: "1px solid #60a5fa",
  background: "#1d4ed8",
  color: "#eff6ff",
};

const sidebarFooter = {
  color: "#94a3b8",
  fontSize: "12px",
  textAlign: "center",
  paddingTop: "8px",
};

const main = {
  flex: 1,
  minWidth: 0,
  padding: "18px",
};

const sessionShell = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "#f3f6fb",
};

const sessionCard = {
  width: "min(560px, 100%)",
  background: "#ffffff",
  border: "1px solid #dbe2ea",
  borderRadius: "14px",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.08)",
  padding: "24px",
};

const sessionTitle = {
  margin: 0,
  fontSize: "28px",
  color: "#0f172a",
};

const sessionText = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#64748b",
  fontSize: "15px",
};