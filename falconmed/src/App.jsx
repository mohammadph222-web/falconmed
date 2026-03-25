import { useEffect, useState } from "react";
import DrugSearch from "./DrugSearch";
import ExpiryTracker from "./ExpiryTracker";
import ShortageTracker from "./ShortageTracker";
import LabelBuilder from "./LabelBuilder";
import Billing from "./Billing";
import RefillTracker from "./RefillTracker";
import Reports from "./Reports";

export default function App() {
  const [page, setPage] = useState("dashboard");

  const renderPage = () => {
    switch (page) {
      case "drug":
        return <DrugSearch />;
      case "expiry":
        return <ExpiryTracker />;
      case "shortage":
        return <ShortageTracker />;
      case "label":
        return <LabelBuilder />;
      case "billing":
        return <Billing />;
      case "refill":
        return <RefillTracker />;
      case "reports":
        return <Reports />;
      default:
        return (
          <div style={{ padding: "20px" }}>
            <h1>Welcome to FalconMed</h1>
            <p>Pharmacy Operations & Clinical Intelligence Platform</p>
          </div>
        );
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Arial" }}>
      <div
        style={{
          width: "240px",
          background: "#1e293b",
          color: "white",
          padding: "20px",
        }}
      >
        <h2 style={{ marginBottom: "30px" }}>FalconMed</h2>

        <button style={menuBtn} onClick={() => setPage("dashboard")}>
          Dashboard
        </button>

        <button style={menuBtn} onClick={() => setPage("drug")}>
          Drug Search
        </button>

        <button style={menuBtn} onClick={() => setPage("expiry")}>
          Expiry Tracker
        </button>

        <button style={menuBtn} onClick={() => setPage("shortage")}>
          Shortage Tracker
        </button>

        <button style={menuBtn} onClick={() => setPage("label")}>
          Label Builder
        </button>

        <button style={menuBtn} onClick={() => setPage("billing")}>
          Billing
        </button>

        <button style={menuBtn} onClick={() => setPage("refill")}>
          Refill Tracker
        </button>

        <button style={menuBtn} onClick={() => setPage("reports")}>
          Reports
        </button>
      </div>

      <div style={{ flex: 1, background: "#f1f5f9", padding: "30px" }}>
        {renderPage()}
      </div>
    </div>
  );
}

const menuBtn = {
  display: "block",
  width: "100%",
  padding: "12px",
  marginBottom: "10px",
  background: "#334155",
  border: "none",
  color: "white",
  cursor: "pointer",
  borderRadius: "6px",
  textAlign: "left",
};