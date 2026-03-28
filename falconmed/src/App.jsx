import { useState } from "react";
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

  if (showLanding) {
    return <LandingPage onAccess={() => setShowLanding(false)} />;
  }

  const totalDrugsInDatabase = 22463;
  const nearExpiryItems = 0;
  const shortageRequestsToday = 0;
  const activeSites = 0;
  const activeUrgentActions = 0;

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
            <div style={headerCard}>
              <h1 style={headerTitle}>FalconMed Dashboard</h1>
              <p style={headerText}>
                Operational intelligence for pharmacy decision-making.
              </p>
            </div>

            <div style={insightBox}>
              22,463 formulary records are actively tracked. Current alerts show 0 near-expiry
              items and 0 shortage requests today.
            </div>

            <div style={cardsGrid}>
              <div style={{ ...statCard, borderTop: "4px solid #3b82f6" }}>
                <div style={statLabel}>TOTAL DRUGS IN DATABASE</div>
                <div style={statValue}>{totalDrugsInDatabase.toLocaleString()}</div>
                <div style={kpiHint}>Active formulary records across FalconMed.</div>
              </div>

              <div style={{ ...statCard, borderTop: "4px solid #f59e0b" }}>
                <div style={statLabel}>NEAR EXPIRY ITEMS</div>
                <div style={statValue}>{nearExpiryItems}</div>
                <div style={kpiHint}>Items requiring near-term stock planning.</div>
              </div>

              <div style={{ ...statCard, borderTop: "4px solid #ef4444" }}>
                <div style={statLabel}>SHORTAGE REQUESTS TODAY</div>
                <div style={statValue}>{shortageRequestsToday}</div>
                <div style={kpiHint}>Current shortage pressure logged today.</div>
              </div>

              <div style={{ ...statCard, borderTop: "4px solid #10b981" }}>
                <div style={statLabel}>ACTIVE SITES</div>
                <div style={statValue}>{activeSites}</div>
                <div style={kpiHint}>Sites currently contributing activity data.</div>
              </div>

              <div
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
                <div style={statValue}>{operationalRiskScore} / 100</div>
                <div style={riskBadgeStyle}>{riskLevel}</div>
                <div style={riskHint}>Driven by shortage risk and urgent pharmacy actions.</div>
              </div>

              <div style={{ ...statCard, borderTop: "4px solid #0ea5e9" }}>
                <div style={statLabel}>INVENTORY FINANCIAL IMPACT</div>
                <div style={{ ...statValue, fontSize: "26px" }}>
                  AED {financialImpact.toLocaleString()}
                </div>
                <div style={financialSubline}>
                  Waste Risk AED {potentialWaste.toLocaleString()} | Savings Opportunity AED {potentialSavings.toLocaleString()}
                </div>
              </div>
            </div>

            <div style={contentCard}>
              <h3 style={sectionTitle}>Recent Activity</h3>

              <div style={activityItem}>
                <div style={activityBarBlue}></div>
                <div style={activityContent}>
                  <div style={activityTitle}>Refill Created</div>
                  <div style={activityText}>
                    Refill request created: sample medicine entry
                  </div>
                </div>
              </div>

              <div style={activityItem}>
                <div style={activityBarRed}></div>
                <div style={activityContent}>
                  <div style={activityTitle}>Shortage Created</div>
                  <div style={activityText}>
                    Shortage request created: sample shortage item
                  </div>
                </div>
              </div>

              <div style={activityItem}>
                <div style={activityBarOrange}></div>
                <div style={activityContent}>
                  <div style={activityTitle}>Expiry Added</div>
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
        );
    }
  };

  return (
    <div style={layout}>
      <aside style={sidebar}>
        <div>
          <div style={brandBox}>
            <h2 style={brandTitle}>FalconMed</h2>
            <p style={brandSub}>Pharmacy Intelligence Platform</p>
          </div>

          <div style={userCard}>
            <div style={userLabel}>FalconMed Platform</div>
            <div style={userEmail}>falconmed.demo@preview</div>
          </div>

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
          <div>FalconMed v1.0</div>
          <div>Build: Stable</div>
        </div>
      </aside>

      <main style={main}>{renderPage()}</main>
    </div>
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

const main = {
  flex: 1,
  padding: "28px",
};

const headerCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "32px",
  textAlign: "center",
};

const headerTitle = {
  margin: 0,
  fontSize: "34px",
  lineHeight: 1.2,
  letterSpacing: "0.01em",
  color: "#0f172a",
};

const headerText = {
  marginTop: "10px",
  color: "#475569",
  fontSize: "16px",
  lineHeight: 1.6,
};

const insightBox = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "12px 14px",
  marginBottom: "32px",
  color: "#334155",
  fontSize: "15px",
  lineHeight: 1.6,
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.04)",
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "32px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px 20px",
  boxShadow: "0 4px 20px rgba(15, 23, 42, 0.08)",
  textAlign: "center",
};

const statLabel = {
  fontSize: "11px",
  color: "#64748b",
  marginBottom: "14px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const statValue = {
  fontSize: "28px",
  fontWeight: "bold",
  color: "#0f172a",
};

const kpiHint = {
  marginTop: "10px",
  fontSize: "12px",
  color: "#64748b",
  lineHeight: 1.5,
};

const riskBadgeBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  padding: "4px 10px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
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
  color: "#64748b",
  lineHeight: 1.5,
};

const financialSubline = {
  marginTop: "8px",
  fontSize: "12px",
  color: "#64748b",
  lineHeight: 1.4,
  fontWeight: 600,
};

const contentCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "28px",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "14px",
  fontSize: "24px",
  lineHeight: 1.3,
  color: "#0f172a",
  textAlign: "center",
};

const sectionText = {
  color: "#475569",
  fontSize: "16px",
  lineHeight: 1.6,
  textAlign: "center",
};

const activityItem = {
  display: "flex",
  gap: "14px",
  alignItems: "center",
  padding: "16px 0",
  borderBottom: "1px solid #e5e7eb",
};

const activityBarBlue = {
  width: "8px",
  height: "32px",
  borderRadius: "8px",
  background: "#3b82f6",
};

const activityBarRed = {
  width: "8px",
  height: "32px",
  borderRadius: "8px",
  background: "#ef4444",
};

const activityBarOrange = {
  width: "8px",
  height: "32px",
  borderRadius: "8px",
  background: "#f59e0b",
};

const activityContent = {
  flex: 1,
};

const activityTitle = {
  fontWeight: "bold",
  color: "#0f172a",
  marginBottom: "6px",
};

const activityText = {
  color: "#64748b",
  fontSize: "15px",
  lineHeight: 1.6,
};

const demoFooter = {
  color: "#cbd5e1",
  fontSize: "13px",
  textAlign: "center",
  paddingTop: "20px",
};