import { useState } from "react";
import ActionCenter from "./ActionCenter";
import ExecutiveDashboard from "./ExecutiveDashboard";
import ExpiryIntelligence from "./ExpiryIntelligence";
import ScenarioSimulator from "./ScenarioSimulator";
import ShortageIntelligence from "./ShortageIntelligence";
import SmartTransfers from "./SmartTransfers";

export default function PDSSWorkspace({ initialView = "executive-dashboard" }) {
  const [activeView, setActiveView] = useState(initialView);

  return (
    <div style={wrap}>
      <div style={tabBar}>
        <button
          type="button"
          style={activeView === "action-center" ? activeTab : tab}
          onClick={() => setActiveView("action-center")}
        >
          Action Center
        </button>
        <button
          type="button"
          style={activeView === "executive-dashboard" ? activeTab : tab}
          onClick={() => setActiveView("executive-dashboard")}
        >
          Executive Dashboard
        </button>
        <button
          type="button"
          style={activeView === "expiry-intelligence" ? activeTab : tab}
          onClick={() => setActiveView("expiry-intelligence")}
        >
          Expiry Intelligence
        </button>
        <button
          type="button"
          style={activeView === "shortage-intelligence" ? activeTab : tab}
          onClick={() => setActiveView("shortage-intelligence")}
        >
          Shortage Intelligence
        </button>
        <button
          type="button"
          style={activeView === "smart-transfers" ? activeTab : tab}
          onClick={() => setActiveView("smart-transfers")}
        >
          Smart Transfers
        </button>
        <button
          type="button"
          style={activeView === "scenario-simulator" ? activeTab : tab}
          onClick={() => setActiveView("scenario-simulator")}
        >
          Scenario Simulator
        </button>
      </div>

      {activeView === "action-center" ? <ActionCenter /> : null}
      {activeView === "executive-dashboard" ? <ExecutiveDashboard /> : null}
      {activeView === "expiry-intelligence" ? <ExpiryIntelligence /> : null}
      {activeView === "scenario-simulator" ? <ScenarioSimulator /> : null}
      {activeView === "smart-transfers" ? <SmartTransfers /> : null}
      {activeView === "shortage-intelligence" ? <ShortageIntelligence /> : null}
    </div>
  );
}

const wrap = {
  display: "grid",
  gap: "16px",
};

const tabBar = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const tab = {
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
  borderRadius: "999px",
  padding: "10px 16px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};

const activeTab = {
  ...tab,
  background: "#2563eb",
  border: "1px solid #2563eb",
  color: "#ffffff",
  boxShadow: "0 8px 20px rgba(37, 99, 235, 0.18)",
};
