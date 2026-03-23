import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import "./App.css";

const STORAGE_KEY = 'falconmed_shortages';

function ShortageTracker({ onBack }) {
  const [shortages, setShortages] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({
    drug_name: '',
    patient_name: '',
    quantity: '',
    contact: '',
    priority: 'Normal',
    status: 'Pending',
    notes: ''
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setShortages(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading shortages:', error);
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

  // Save to localStorage whenever shortages change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortages));
  }, [shortages]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.drug_name || !formData.patient_name) {
      alert('Please fill in at least drug name and patient name');
      return;
    }

    const newShortage = {
      id: Date.now(),
      ...formData,
      created_at: new Date().toISOString()
    };

    setShortages(prev => [...prev, newShortage]);
    setFormData({
      drug_name: '',
      patient_name: '',
      quantity: '',
      contact: '',
      priority: 'Normal',
      status: 'Pending',
      notes: ''
    });
  };

  const handleStatusChange = (id, newStatus) => {
    setShortages(prev => prev.map(shortage =>
      shortage.id === id ? { ...shortage, status: newStatus } : shortage
    ));
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this shortage record?')) {
      setShortages(prev => prev.filter(shortage => shortage.id !== id));
    }
  };

  const getSummary = () => {
    const total = shortages.length;
    const pending = shortages.filter(s => s.status === 'Pending').length;
    const ready = shortages.filter(s => s.status === 'Ready').length;
    const collected = shortages.filter(s => s.status === 'Collected').length;
    return { total, pending, ready, collected };
  };

  const summary = getSummary();

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(shortages);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shortages");
    XLSX.writeFile(wb, "FalconMed_shortage_export.xlsx");
  };

  return (
    <div className="shortage-tracker-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Shortage Tracker</h2>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <h3>Total Records</h3>
          <p className="summary-number">{summary.total}</p>
        </div>
        <div className="summary-card">
          <h3>Pending</h3>
          <p className="summary-number pending">{summary.pending}</p>
        </div>
        <div className="summary-card">
          <h3>Ready</h3>
          <p className="summary-number ready">{summary.ready}</p>
        </div>
        <div className="summary-card">
          <h3>Collected</h3>
          <p className="summary-number collected">{summary.collected}</p>
        </div>
      </div>

      {/* Add New Shortage Form */}
      <div className="form-container">
        <h3>Add New Shortage</h3>
        <form onSubmit={handleSubmit} className="shortage-form">
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
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="quantity">Quantity</label>
              <input
                type="text"
                id="quantity"
                name="quantity"
                value={formData.quantity}
                onChange={handleInputChange}
                placeholder="e.g., 30 tablets"
              />
            </div>
            <div className="form-group">
              <label htmlFor="contact">Contact</label>
              <input
                type="text"
                id="contact"
                name="contact"
                value={formData.contact}
                onChange={handleInputChange}
                placeholder="Phone or email"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                name="priority"
                value={formData.priority}
                onChange={handleInputChange}
              >
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleInputChange}
              >
                <option value="Pending">Pending</option>
                <option value="Ordered">Ordered</option>
                <option value="Ready">Ready</option>
                <option value="Collected">Collected</option>
              </select>
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
          <button type="submit" className="submit-button">Add Shortage</button>
        </form>
      </div>

      {/* Shortages Table */}
      <div className="table-container">
        <div className="table-header">
          <h3>Shortage Records ({shortages.length})</h3>
          <button onClick={handleExport} className="export-button">Export to Excel</button>
        </div>
        {shortages.length === 0 ? (
          <p className="no-records">No shortage records found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="shortages-table">
              <thead>
                <tr>
                  <th>Drug</th>
                  <th>Patient</th>
                  <th>Quantity</th>
                  <th>Contact</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shortages.map((shortage) => (
                  <tr key={shortage.id}>
                    <td>{shortage.drug_name}</td>
                    <td>{shortage.patient_name}</td>
                    <td>{shortage.quantity}</td>
                    <td>{shortage.contact}</td>
                    <td>
                      <span className={`priority-badge ${shortage.priority.toLowerCase()}`}>
                        {shortage.priority}
                      </span>
                    </td>
                    <td>
                      <select
                        value={shortage.status}
                        onChange={(e) => handleStatusChange(shortage.id, e.target.value)}
                        className="status-select"
                      >
                        <option value="Pending">Pending</option>
                        <option value="Ordered">Ordered</option>
                        <option value="Ready">Ready</option>
                        <option value="Collected">Collected</option>
                      </select>
                    </td>
                    <td>{shortage.notes}</td>
                    <td>{new Date(shortage.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="delete-button"
                        onClick={() => handleDelete(shortage.id)}
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

export default ShortageTracker;