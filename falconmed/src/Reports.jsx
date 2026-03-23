import { useEffect, useState, useMemo } from "react";
import "./App.css";

function formatDate(dateString) {
  if (!dateString) return "N/A";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString();
}

function Reports({ onBack }) {
  const [shortages, setShortages] = useState([]);
  const [expiries, setExpiries] = useState([]);
  const [refills, setRefills] = useState([]);

  useEffect(() => {
    try {
      const shortagesData = localStorage.getItem("falconmed_shortages");
      const expiriesData = localStorage.getItem("falconmed_expiries");
      const refillsData = localStorage.getItem("falconmed_refills");

      setShortages(shortagesData ? JSON.parse(shortagesData) : []);
      setExpiries(expiriesData ? JSON.parse(expiriesData) : []);
      setRefills(refillsData ? JSON.parse(refillsData) : []);
    } catch (error) {
      console.error("Failed to load report data", error);
      setShortages([]);
      setExpiries([]);
      setRefills([]);
    }
  }, []);

  const sortedShortages = useMemo(() => {
    return [...shortages]
      .sort((a, b) => {
        const aDate = new Date(a.requested_at || a.created_at || 0).getTime();
        const bDate = new Date(b.requested_at || b.created_at || 0).getTime();
        return bDate - aDate;
      })
      .slice(0, 10);
  }, [shortages]);

  const totalShortages = shortages.length;
  const totalExpiries = expiries.length;
  const nearExpiryCount = expiries.filter((item) => item.status === "Near Expiry").length;
  const upcomingRefills = refills.filter((item) => item.status === "Upcoming").length;
  const overdueRefills = refills.filter((item) => item.status === "Overdue").length;

  return (
    <div className="drug-search-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>
          ← Back
        </button>
        <h2>Reports Dashboard</h2>
      </div>

      <div className="summary-cards" style={{ marginBottom: "1.5rem" }}>
        <div className="summary-card">
          <h3>Total Shortages</h3>
          <p className="summary-number">{totalShortages}</p>
        </div>
        <div className="summary-card">
          <h3>Total Expiry Records</h3>
          <p className="summary-number">{totalExpiries}</p>
        </div>
        <div className="summary-card">
          <h3>Near Expiry</h3>
          <p className="summary-number">{nearExpiryCount}</p>
        </div>
        <div className="summary-card">
          <h3>Upcoming Refills</h3>
          <p className="summary-number">{upcomingRefills}</p>
        </div>
        <div className="summary-card">
          <h3>Overdue Refills</h3>
          <p className="summary-number">{overdueRefills}</p>
        </div>
      </div>

      <div className="card">
        <h2>Shortage Report</h2>
        <p>Total shortages: {totalShortages}</p>
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th>Drug Name</th>
                <th>Requested Quantity</th>
                <th>Request Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedShortages.length > 0 ? (
                sortedShortages.map((item) => (
                  <tr key={item.id || `${item.drug_name}-${item.requested_at || item.created_at}`}>
                    <td>{item.drug_name || "-"}</td>
                    <td>{item.quantity || "-"}</td>
                    <td>{formatDate(item.requested_at || item.created_at)}</td>
                    <td>{item.status || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    No shortage records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Expiry Report</h2>
        <p>
          Total records: {totalExpiries} | Near expiry: {nearExpiryCount}
        </p>
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th>Drug Name</th>
                <th>Batch</th>
                <th>Expiry Date</th>
                <th>Quantity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {expiries.length > 0 ? (
                expiries.map((item) => (
                  <tr key={item.id || `${item.drug_name}-${item.batch_no}-${item.expiry_date}`}>
                    <td>{item.drug_name || "-"}</td>
                    <td>{item.batch_no || "-"}</td>
                    <td>{formatDate(item.expiry_date)}</td>
                    <td>{item.quantity || "-"}</td>
                    <td>{item.status || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center" }}>
                    No expiry records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Refill Report</h2>
        <p>
          Upcoming: {upcomingRefills} | Overdue: {overdueRefills}
        </p>
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table className="results-table">
            <thead>
              <tr>
                <th>Drug Name</th>
                <th>Patient Name</th>
                <th>Refill Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {refills.length > 0 ? (
                refills.map((item) => (
                  <tr key={item.id || `${item.drug_name}-${item.patient_name}-${item.next_refill_date}`}>
                    <td>{item.drug_name || "-"}</td>
                    <td>{item.patient_name || "-"}</td>
                    <td>{formatDate(item.next_refill_date)}</td>
                    <td>{item.status || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>
                    No refill records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Reports;
