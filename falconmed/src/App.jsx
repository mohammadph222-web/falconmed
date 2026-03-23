import { useState, useEffect } from "react";
import "./App.css";
import DrugSearch from "./DrugSearch";
import ShortageTracker from "./ShortageTracker";
import ExpiryTracker from "./ExpiryTracker";
import RefillTracker from "./RefillTracker";

function App() {
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [stats, setStats] = useState({
    totalMedicines: 0,
    totalShortages: 0,
    nearExpiryMedicines: 0,
    upcomingRefills: 0
  });

  useEffect(() => {
    const loadStats = async () => {
      try {
        // Load total medicines from CSV
        const response = await fetch('/drugs.csv');
        if (response.ok) {
          const csvText = await response.text();
          const lines = csvText.trim().split('\n');
          const totalMedicines = lines.length > 1 ? lines.length - 1 : 0; // Subtract header
          setStats(prev => ({ ...prev, totalMedicines }));
        }

        // Load shortages
        const shortagesData = localStorage.getItem('falconmed_shortages');
        const totalShortages = shortagesData ? JSON.parse(shortagesData).length : 0;

        // Load near expiry medicines
        const expiriesData = localStorage.getItem('falconmed_expiries');
        const nearExpiryMedicines = expiriesData ? JSON.parse(expiriesData).filter(e => e.status === 'Near Expiry').length : 0;

        // Load upcoming refills
        const refillsData = localStorage.getItem('falconmed_refills');
        const upcomingRefills = refillsData ? JSON.parse(refillsData).filter(r => r.status === 'Upcoming').length : 0;

        setStats(prev => ({
          ...prev,
          totalShortages,
          nearExpiryMedicines,
          upcomingRefills
        }));
      } catch (error) {
        console.error('Error loading stats:', error);
      }
    };

    loadStats();
  }, []);

  if (currentPage === "drug-search") {
    return <DrugSearch onBack={() => setCurrentPage("dashboard")} />;
  }

  if (currentPage === "shortage-tracker") {
    return <ShortageTracker onBack={() => setCurrentPage("dashboard")} />;
  }

  if (currentPage === "expiry-tracker") {
    return <ExpiryTracker onBack={() => setCurrentPage("dashboard")} />;
  }

  if (currentPage === "refill-tracker") {
    return <RefillTracker onBack={() => setCurrentPage("dashboard")} />;
  }

  return (
    <div className="container">
      <header className="header">
        <h1>FalconMed Pharmacy Suite</h1>
        <p>Smart Pharmacy Operations Dashboard</p>
      </header>

      {/* Statistics Cards */}
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

      <div className="dashboard">
        <div className="card">
          <h2>Drug Database</h2>
          <p>Search medicines from the central database.</p>
          <button onClick={() => setCurrentPage("drug-search")}>Open</button>
        </div>

        <div className="card">
          <h2>Shortage Tracker</h2>
          <p>Track daily medicine shortages.</p>
          <button onClick={() => setCurrentPage("shortage-tracker")}>Open</button>
        </div>

        <div className="card">
          <h2>Expiry Tracker</h2>
          <p>Monitor near-expiry medicines.</p>
          <button onClick={() => setCurrentPage("expiry-tracker")}>Open</button>
        </div>

        <div className="card">
          <h2>Refill Tracker</h2>
          <p>Manage patient refill requests.</p>
          <button onClick={() => setCurrentPage("refill-tracker")}>Open</button>
        </div>
      </div>
    </div>
  );
}

export default App;