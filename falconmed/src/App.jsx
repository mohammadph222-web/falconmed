import { useState, useEffect, useMemo } from "react";
import "./App.css";
import DrugSearch from "./DrugSearch";
import ShortageTracker from "./ShortageTracker";
import ExpiryTracker from "./ExpiryTracker";
import RefillTracker from "./RefillTracker";
import Reports from "./Reports";
import LabelBuilder from "./LabelBuilder";
import Billing from "./Billing";
import Login from "./Login";
import { supabase } from "./lib/supabaseClient";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState({
    totalMedicines: 0,
    totalShortages: 0,
    nearExpiryMedicines: 0,
    upcomingRefills: 0,
  });
  const [shortages, setShortages] = useState([]);
  const [expiries, setExpiries] = useState([]);
  const [refills, setRefills] = useState([]);

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      setAuthLoading(false);
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setAuthLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadStats = () => {
      try {
        const csvText = drugsMasterCsv;
        const lines = csvText.trim().split("\n");
        const totalMedicines = lines.length > 1 ? lines.length - 1 : 0;
        setStats((prev) => ({ ...prev, totalMedicines }));

        const shortagesData = localStorage.getItem("falconmed_shortages");
        const parsedShortages = shortagesData ? JSON.parse(shortagesData) : [];
        setShortages(parsedShortages);
        const totalShortages = parsedShortages.length;

        const expiriesData = localStorage.getItem("falconmed_expiries");
        const parsedExpiries = expiriesData ? JSON.parse(expiriesData) : [];
        setExpiries(parsedExpiries);
        const nearExpiryMedicines = parsedExpiries.filter(
          (e) => e.status === "Near Expiry"
        ).length;

        const refillsData = localStorage.getItem("falconmed_refills");
        const parsedRefills = refillsData ? JSON.parse(refillsData) : [];
        setRefills(parsedRefills);
        const upcomingRefills = parsedRefills.filter(
          (r) => r.status === "Upcoming"
        ).length;

        setStats((prev) => ({
          ...prev,
          totalShortages,
          nearExpiryMedicines,
          upcomingRefills,
        }));
      } catch (error) {
        console.error("Error loading stats:", error);
      }
    };

    loadStats();
  }, []);

  const shortageTrendData = useMemo(() => {
    const dateMap = {};
    shortages.forEach((item) => {
      const date = new Date(
        item.requested_at || item.created_at
      ).toLocaleDateString();
      dateMap[date] = (dateMap[date] || 0) + 1;
    });
    return Object.entries(dateMap)
      .map(([date, count]) => ({ date, count }))
      .slice(-7);
  }, [shortages]);

  const expiryTimelineData = useMemo(() => {
    const dateMap = {};
    expiries
      .filter((item) => item.status === "Near Expiry")
      .forEach((item) => {
        const date = new Date(item.expiry_date).toLocaleDateString();
        dateMap[date] = (dateMap[date] || 0) + 1;
      });
    return Object.entries(dateMap)
      .map(([date, count]) => ({ date, count }))
      .slice(0, 7);
  }, [expiries]);

  const refillActivityData = useMemo(() => {
    const upcoming = refills.filter((r) => r.status === "Upcoming").length;
    const completed = refills.filter((r) => r.status === "Completed").length;
    return [
      { name: "Upcoming", value: upcoming },
      { name: "Completed", value: completed },
    ];
  }, [refills]);

  const alerts = useMemo(() => {
    const nearExpiry = expiries
      .filter((e) => e.status === "Near Expiry")
      .slice(0, 3);
    const recentShortages = shortages.slice(-3);
    const upcomingRefills = refills
      .filter((r) => r.status === "Upcoming")
      .slice(0, 3);
    return { nearExpiry, recentShortages, upcomingRefills };
  }, [expiries, shortages, refills]);

  const mostRequested = useMemo(() => {
    const drugMap = {};
    [...shortages, ...expiries, ...refills].forEach((item) => {
      const drug = item.drug_name;
      if (drug) {
        if (!drugMap[drug]) drugMap[drug] = { count: 0, lastDate: null };
        drugMap[drug].count += 1;
        const date = new Date(
          item.requested_at ||
            item.created_at ||
            item.expiry_date ||
            item.next_refill_date
        );
        if (!drugMap[drug].lastDate || date > drugMap[drug].lastDate) {
          drugMap[drug].lastDate = date;
        }
      }
    });
    return Object.entries(drugMap)
      .map(([drug, data]) => ({
        drug,
        count: data.count,
        lastDate: data.lastDate,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [shortages, expiries, refills]);

  const shortagePredictions = useMemo(() => {
    const drugStats = {};

    shortages.forEach((item) => {
      const drug = item.drug_name;
      if (!drugStats[drug]) {
        drugStats[drug] = { shortages: [], refills: [], expiries: [] };
      }
      drugStats[drug].shortages.push(item);
    });

    refills.forEach((item) => {
      const drug = item.drug_name;
      if (!drugStats[drug]) {
        drugStats[drug] = { shortages: [], refills: [], expiries: [] };
      }
      drugStats[drug].refills.push(item);
    });

    expiries.forEach((item) => {
      const drug = item.drug_name;
      if (!drugStats[drug]) {
        drugStats[drug] = { shortages: [], refills: [], expiries: [] };
      }
      drugStats[drug].expiries.push(item);
    });

    const predictions = Object.entries(drugStats).map(([drug, stats]) => {
      const shortageCount = stats.shortages.length;
      const refillCount = stats.refills.length;
      const nearExpiryCount = stats.expiries.filter(
        (e) => e.status === "Near Expiry"
      ).length;

      let score = 0;
      const reasons = [];

      if (shortageCount >= 3) {
        score += 30;
        reasons.push("Frequent shortage reports");
      } else if (shortageCount >= 1) {
        score += 15;
        reasons.push("Recent shortage history");
      }

      if (refillCount >= 5) {
        score += 25;
        reasons.push("High refill activity");
      } else if (refillCount >= 2) {
        score += 10;
        reasons.push("Multiple refill requests");
      }

      if (nearExpiryCount > 0) {
        score += 10;
        reasons.push("Near expiry records");
      }

      const recentShortages = stats.shortages.filter((s) => {
        const date = new Date(s.requested_at || s.created_at);
        const daysAgo = (new Date() - date) / (1000 * 60 * 60 * 24);
        return daysAgo <= 30;
      });

      if (recentShortages.length > 0) {
        score += 15;
        reasons.push("Recent shortage activity");
      }

      let riskLevel;
      let riskColor;

      if (score >= 50) {
        riskLevel = "High Risk";
        riskColor = "red";
      } else if (score >= 25) {
        riskLevel = "Medium Risk";
        riskColor = "orange";
      } else {
        riskLevel = "Low Risk";
        riskColor = "green";
      }

      const lastShortageDate =
        stats.shortages.length > 0
          ? new Date(
              Math.max(
                ...stats.shortages.map((s) =>
                  new Date(s.requested_at || s.created_at)
                )
              )
            )
          : null;

      return {
        drug,
        riskLevel,
        riskColor,
        reasons: reasons.length > 0 ? reasons : ["Low activity"],
        lastShortageDate,
        shortageCount,
        refillCount,
      };
    });

    return predictions
      .sort((a, b) => {
        const scoreA =
          a.riskLevel === "High Risk"
            ? 3
            : a.riskLevel === "Medium Risk"
            ? 2
            : 1;
        const scoreB =
          b.riskLevel === "High Risk"
            ? 3
            : b.riskLevel === "Medium Risk"
            ? 2
            : 1;
        return scoreB - scoreA;
      })
      .slice(0, 10);
  }, [shortages, expiries, refills]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const renderContent = () => {
    switch (currentPage) {
      case "drug-search":
        return <DrugSearch onBack={() => setCurrentPage("dashboard")} />;
      case "shortage-tracker":
        return <ShortageTracker onBack={() => setCurrentPage("dashboard")} />;
      case "expiry-tracker":
        return <ExpiryTracker onBack={() => setCurrentPage("dashboard")} />;
      case "refill-tracker":
        return <RefillTracker onBack={() => setCurrentPage("dashboard")} />;
      case "reports":
        return <Reports onBack={() => setCurrentPage("dashboard")} />;
      case "label-builder":
        return <LabelBuilder onBack={() => setCurrentPage("dashboard")} />;
      case "billing":
        return <Billing onBack={() => setCurrentPage("dashboard")} />;
      case "settings":
        return (
          <div className="placeholder-content">
            <h2>Settings</h2>
            <p>Application settings and preferences coming soon.</p>
          </div>
        );
      default:
        return (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">💊</div>
                <div className="stat-content">
                  <h3>{stats.totalMedicines.toLocaleString()}</h3>
                  <p>Total Medicines</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">⚠️</div>
                <div className="stat-content">
                  <h3>{stats.totalShortages}</h3>
                  <p>Shortage Records</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">⏰</div>
                <div className="stat-content">
                  <h3>{stats.nearExpiryMedicines}</h3>
                  <p>Near Expiry</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon">🔄</div>
                <div className="stat-content">
                  <h3>{stats.upcomingRefills}</h3>
                  <p>Upcoming Refills</p>
                </div>
              </div>
            </div>

            <div className="charts-section">
              <h2>Analytics Overview</h2>
              <div className="charts-grid">
                <div className="chart-card">
                  <h3>Shortage Trend (Last 7 Days)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={shortageTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#3b82f6" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-card">
                  <h3>Expiry Timeline (Next 7 Days)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={expiryTimelineData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="chart-card">
                  <h3>Refill Activity</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={refillActivityData}
                        cx="50%"
                        cy="50%"
                        outerRadius={60}
                        fill="#8884d8"
                        dataKey="value"
                        label
                      >
                        {refillActivityData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={index === 0 ? "#3b82f6" : "#10b981"}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="alerts-panel">
              <h2>Smart Alerts</h2>
              <div className="alerts-grid">
                <div className="alert-card">
                  <h3>Near Expiry Medicines</h3>
                  {alerts.nearExpiry.length > 0 ? (
                    alerts.nearExpiry.map((item) => (
                      <p key={item.id}>
                        {item.drug_name} -{" "}
                        {new Date(item.expiry_date).toLocaleDateString()}
                      </p>
                    ))
                  ) : (
                    <p>No near expiry items.</p>
                  )}
                </div>
                <div className="alert-card">
                  <h3>Recent Shortage Reports</h3>
                  {alerts.recentShortages.length > 0 ? (
                    alerts.recentShortages.map((item) => (
                      <p key={item.id}>
                        {item.drug_name} - {item.patient_name}
                      </p>
                    ))
                  ) : (
                    <p>No recent shortages.</p>
                  )}
                </div>
                <div className="alert-card">
                  <h3>Upcoming Refill Reminders</h3>
                  {alerts.upcomingRefills.length > 0 ? (
                    alerts.upcomingRefills.map((item) => (
                      <p key={item.id}>
                        {item.patient_name} - {item.drug_name}
                      </p>
                    ))
                  ) : (
                    <p>No upcoming refills.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="most-requested">
              <h2>Most Requested Medicines</h2>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Drug Name</th>
                    <th>Number of Requests</th>
                    <th>Last Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {mostRequested.length > 0 ? (
                    mostRequested.map((item) => (
                      <tr key={item.drug}>
                        <td>{item.drug}</td>
                        <td>{item.count}</td>
                        <td>
                          {item.lastDate
                            ? item.lastDate.toLocaleDateString()
                            : "N/A"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>No data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="shortage-prediction">
              <h2>Smart Shortage Prediction</h2>
              <p>AI-powered predictions based on historical data patterns</p>
              <div className="prediction-cards">
                {shortagePredictions.length > 0 ? (
                  shortagePredictions.map((pred) => (
                    <div key={pred.drug} className="prediction-card">
                      <div className="prediction-header">
                        <h3>{pred.drug}</h3>
                        <span className={`risk-badge ${pred.riskColor}`}>
                          {pred.riskLevel}
                        </span>
                      </div>
                      <div className="prediction-details">
                        <div className="detail-row">
                          <span className="detail-label">Reason:</span>
                          <span className="detail-value">
                            {pred.reasons.join(", ")}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Last Shortage:</span>
                          <span className="detail-value">
                            {pred.lastShortageDate
                              ? pred.lastShortageDate.toLocaleDateString()
                              : "N/A"}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">
                            Shortage Reports:
                          </span>
                          <span className="detail-value">
                            {pred.shortageCount}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span className="detail-label">Refill Activity:</span>
                          <span className="detail-value">
                            {pred.refillCount}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="no-predictions">
                    No prediction data available. Add more records to generate
                    insights.
                  </p>
                )}
              </div>
            </div>

            <div className="dashboard">
              <div className="card">
                <h2>Drug Database</h2>
                <p>Search medicines from the central database.</p>
                <button onClick={() => setCurrentPage("drug-search")}>
                  Open
                </button>
              </div>

              <div className="card">
                <h2>Shortage Tracker</h2>
                <p>Track daily medicine shortages.</p>
                <button onClick={() => setCurrentPage("shortage-tracker")}>
                  Open
                </button>
              </div>

              <div className="card">
                <h2>Expiry Tracker</h2>
                <p>Monitor near-expiry medicines.</p>
                <button onClick={() => setCurrentPage("expiry-tracker")}>
                  Open
                </button>
              </div>

              <div className="card">
                <h2>Refill Tracker</h2>
                <p>Manage patient refill requests.</p>
                <button onClick={() => setCurrentPage("refill-tracker")}>
                  Open
                </button>
              </div>

              <div className="card">
                <h2>Billing</h2>
                <p>Create professional invoices and quotations.</p>
                <button onClick={() => setCurrentPage("billing")}>Open</button>
              </div>
            </div>
          </>
        );
    }
  };

  if (authLoading) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h2>Loading FalconMed...</h2>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <h2>FalconMed</h2>
        </div>
        <nav className="sidebar-nav">
          <button
            onClick={() => {
              setCurrentPage("dashboard");
              setSidebarOpen(false);
            }}
            className={currentPage === "dashboard" ? "active" : ""}
          >
            📊 Dashboard
          </button>
          <button
            onClick={() => {
              setCurrentPage("drug-search");
              setSidebarOpen(false);
            }}
            className={currentPage === "drug-search" ? "active" : ""}
          >
            🔍 Drug Database
          </button>
          <button
            onClick={() => {
              setCurrentPage("shortage-tracker");
              setSidebarOpen(false);
            }}
            className={currentPage === "shortage-tracker" ? "active" : ""}
          >
            ⚠️ Shortage Tracker
          </button>
          <button
            onClick={() => {
              setCurrentPage("expiry-tracker");
              setSidebarOpen(false);
            }}
            className={currentPage === "expiry-tracker" ? "active" : ""}
          >
            ⏰ Expiry Tracker
          </button>
          <button
            onClick={() => {
              setCurrentPage("refill-tracker");
              setSidebarOpen(false);
            }}
            className={currentPage === "refill-tracker" ? "active" : ""}
          >
            🔄 Refill Tracker
          </button>
          <button
            onClick={() => {
              setCurrentPage("reports");
              setSidebarOpen(false);
            }}
            className={currentPage === "reports" ? "active" : ""}
          >
            📈 Reports
          </button>
          <button
            onClick={() => {
              setCurrentPage("label-builder");
              setSidebarOpen(false);
            }}
            className={currentPage === "label-builder" ? "active" : ""}
          >
            🏷 Label Builder
          </button>
          <button
            onClick={() => {
              setCurrentPage("billing");
              setSidebarOpen(false);
            }}
            className={currentPage === "billing" ? "active" : ""}
          >
            🧾 Billing
          </button>
          <button
            onClick={() => {
              setCurrentPage("settings");
              setSidebarOpen(false);
            }}
            className={currentPage === "settings" ? "active" : ""}
          >
            ⚙️ Settings
          </button>
        </nav>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <button
            className="hamburger"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>

          <div className="topbar-content">
            <h1>FalconMed Pharmacy Suite</h1>
            <p>Smart Pharmacy Operations Dashboard</p>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={handleLogout}
              style={{
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <main className="content-area">{renderContent()}</main>
      </div>
    </div>
  );
}

export default App;