import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import "./App.css";

const STORAGE_KEY = 'falconmed_refills';

function RefillTracker({ onBack }) {
  const [refills, setRefills] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({
    patient_name: '',
    phone: '',
    drug_name: '',
    quantity_dispensed: '',
    daily_usage: '',
    dispense_date: '',
    notes: ''
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setRefills(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading refills:', error);
      }
    }
  }, []);

  // Load medicines from CSV
  useEffect(() => {
    const loadMedicines = async () => {
      try {
        const response = await fetch('/drugs.csv');
        if (!response.ok) throw new Error('Failed to load CSV');
        const csvText = await response.text();
        const parsedData = Papa.parse(csvText, { header: false, skipEmptyLines: true });
        let dataRows = parsedData.data;
        if (dataRows.length > 0 && isNaN(parseInt(dataRows[0][0], 10))) {
          dataRows = dataRows.slice(1);
        }
        const meds = dataRows.map(row => ({
          brand: row[1] || '',
          generic: row[2] || ''
        })).filter(m => m.brand || m.generic);
        setMedicines(meds);
      } catch (error) {
        console.error('Error loading medicines:', error);
      }
    };
    loadMedicines();
  }, []);

  // Save to localStorage whenever refills change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refills));
  }, [refills]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const calculateRefillInfo = (quantityDispensed, dailyUsage, dispenseDate) => {
    const qty = parseFloat(quantityDispensed);
    const usage = parseFloat(dailyUsage);
    
    if (isNaN(qty) || isNaN(usage) || usage <= 0) {
      return { daysSupply: 0, nextRefillDate: null };
    }

    const daysSupply = Math.floor(qty / usage);
    const dispense = new Date(dispenseDate);
    const nextRefill = new Date(dispense);
    nextRefill.setDate(dispense.getDate() + daysSupply);

    return { daysSupply, nextRefillDate: nextRefill.toISOString().split('T')[0] };
  };

  const getRefillStatus = (nextRefillDate) => {
    if (!nextRefillDate) return 'Unknown';
    
    const today = new Date();
    const next = new Date(nextRefillDate);
    const diffTime = next - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'Overdue';
    if (diffDays <= 3) return 'Due';
    return 'Upcoming';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.patient_name || !formData.drug_name || !formData.dispense_date) {
      alert('Please fill in patient name, drug name, and dispense date');
      return;
    }

    const { daysSupply, nextRefillDate } = calculateRefillInfo(
      formData.quantity_dispensed,
      formData.daily_usage,
      formData.dispense_date
    );
    
    const status = getRefillStatus(nextRefillDate);

    const newRefill = {
      id: Date.now(),
      ...formData,
      days_supply: daysSupply,
      next_refill_date: nextRefillDate,
      status,
      created_at: new Date().toISOString()
    };

    setRefills(prev => [...prev, newRefill]);
    setFormData({
      patient_name: '',
      phone: '',
      drug_name: '',
      quantity_dispensed: '',
      daily_usage: '',
      dispense_date: '',
      notes: ''
    });
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this refill record?')) {
      setRefills(prev => prev.filter(refill => refill.id !== id));
    }
  };

  const getSummary = () => {
    const total = refills.length;
    const upcoming = refills.filter(r => r.status === 'Upcoming').length;
    const due = refills.filter(r => r.status === 'Due').length;
    const overdue = refills.filter(r => r.status === 'Overdue').length;
    return { total, upcoming, due, overdue };
  };

  const summary = getSummary();

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(refills);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Refills");
    XLSX.writeFile(wb, "FalconMed_refill_export.xlsx");
  };

  return (
    <div className="refill-tracker-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Refill Tracker</h2>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <h3>Total Refills</h3>
          <p className="summary-number">{summary.total}</p>
        </div>
        <div className="summary-card">
          <h3>Upcoming</h3>
          <p className="summary-number upcoming">{summary.upcoming}</p>
        </div>
        <div className="summary-card">
          <h3>Due</h3>
          <p className="summary-number due">{summary.due}</p>
        </div>
        <div className="summary-card">
          <h3>Overdue</h3>
          <p className="summary-number overdue">{summary.overdue}</p>
        </div>
      </div>

      {/* Add New Refill Form */}
      <div className="form-container">
        <h3>Add New Refill</h3>
        <form onSubmit={handleSubmit} className="refill-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="patient_name">Patient Name *</label>
              <input
                type="text"
                id="patient_name"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleInputChange}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="phone">Phone</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="drug_name">Drug Name *</label>
              <input
                type="text"
                id="drug_name"
                name="drug_name"
                value={formData.drug_name}
                onChange={handleInputChange}
                list="medicines"
                required
              />
              <datalist id="medicines">
                {medicines.map((med, index) => [
                  med.brand && <option key={`brand-${index}`} value={med.brand} />,
                  med.generic && med.generic !== med.brand && <option key={`generic-${index}`} value={med.generic} />
                ])}
              </datalist>
            </div>
            <div className="form-group">
              <label htmlFor="dispense_date">Dispense Date *</label>
              <input
                type="date"
                id="dispense_date"
                name="dispense_date"
                value={formData.dispense_date}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="quantity_dispensed">Quantity Dispensed</label>
              <input
                type="number"
                id="quantity_dispensed"
                name="quantity_dispensed"
                value={formData.quantity_dispensed}
                onChange={handleInputChange}
                placeholder="e.g., 30"
                min="0"
                step="0.1"
              />
            </div>
            <div className="form-group">
              <label htmlFor="daily_usage">Daily Usage</label>
              <input
                type="number"
                id="daily_usage"
                name="daily_usage"
                value={formData.daily_usage}
                onChange={handleInputChange}
                placeholder="e.g., 1"
                min="0.1"
                step="0.1"
              />
            </div>
          </div>
          <div className="form-group full-width">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows="3"
              placeholder="Additional notes..."
            />
          </div>
          <button type="submit" className="submit-button">Add Refill</button>
        </form>
      </div>

      {/* Refills Table */}
      <div className="table-container">
        <div className="table-header">
          <h3>Refill Records ({refills.length})</h3>
          <button onClick={handleExport} className="export-button">Export to Excel</button>
        </div>
        {refills.length === 0 ? (
          <p className="no-records">No refill records found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="refills-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Phone</th>
                  <th>Drug</th>
                  <th>Dispensed</th>
                  <th>Daily Usage</th>
                  <th>Days Supply</th>
                  <th>Next Refill</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {refills.map((refill) => (
                  <tr key={refill.id}>
                    <td>{refill.patient_name}</td>
                    <td>{refill.phone}</td>
                    <td>{refill.drug_name}</td>
                    <td>{refill.quantity_dispensed}</td>
                    <td>{refill.daily_usage}</td>
                    <td>{refill.days_supply}</td>
                    <td>{refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString() : 'N/A'}</td>
                    <td>
                      <span className={`status-badge ${refill.status.toLowerCase()}`}>
                        {refill.status}
                      </span>
                    </td>
                    <td>{refill.notes}</td>
                    <td>
                      <button
                        className="delete-button"
                        onClick={() => handleDelete(refill.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default RefillTracker;