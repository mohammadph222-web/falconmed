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

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
      setLoading(false);
    };

    getSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) {
    return <h2 style={{ textAlign: "center" }}>Loading...</h2>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      
      <div
        style={{
          width: "260px",
          background: "#1f2937",
          color: "white",
          padding: "20px",
        }}
      >
        <h2>FalconMed</h2>
        <p style={{ fontSize: "12px" }}>{user.email}</p>

        <button style={btn} onClick={() => setPage("dashboard")}>
          Dashboard
        </button>

        <button style={btn} onClick={() => setPage("drugsearch")}>
          Drug Search
        </button>

        <button style={btn} onClick={() => setPage("expiry")}>
          Expiry Tracker
        </button>

        <button style={btn} onClick={() => setPage("shortage")}>
          Shortage Tracker
        </button>

        <button style={btn} onClick={() => setPage("reports")}>
          Reports
        </button>

        <button style={btn} onClick={() => setPage("labels")}>
          Label Builder
        </button>

        <button style={btn} onClick={() => setPage("billing")}>
          Billing
        </button>

        <button style={btn} onClick={() => setPage("refill")}>
          Refill Tracker
        </button>

        <button
          style={{ ...btn, background: "#dc2626", marginTop: "20px" }}
          onClick={logout}
        >
          Logout
        </button>
      </div>

      <div style={{ flex: 1, padding: "40px", background: "#f3f4f6" }}>

        {page === "dashboard" && (
          <div>
            <h1>FalconMed Dashboard</h1>
            <p>Welcome {user.email}</p>
          </div>
        )}

        {page === "drugsearch" && <DrugSearch />}

        {page === "expiry" && <ExpiryTracker />}

        {page === "shortage" && <ShortageTracker />}

        {page === "reports" && <Reports />}

        {page === "labels" && <LabelBuilder />}

        {page === "billing" && <Billing />}

        {page === "refill" && <RefillTracker />}

      </div>
    </div>
  );
}

const btn = {
  display: "block",
  width: "100%",
  padding: "12px",
  marginTop: "10px",
  background: "#374151",
  color: "white",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};