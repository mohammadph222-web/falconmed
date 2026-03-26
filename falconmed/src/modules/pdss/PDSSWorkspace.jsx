import { useState } from "react";
import ShortageIntelligence from "./ShortageIntelligence";
import SmartTransfers from "./SmartTransfers";

export default function PDSSWorkspace() {
  const [activeView, setActiveView] = useState("shortage-intelligence");

  return (
    <div style={wrap}>
      <div style={tabBar}>
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
      </div>

      {activeView === "smart-transfers" ? <SmartTransfers /> : <ShortageIntelligence />}
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
