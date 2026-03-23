import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import "./App.css";

const STORAGE_KEY = 'falconmed_expiries';
const DRUGS_CSV_URL = `${import.meta.env.BASE_URL}drugs.csv`;

function ExpiryTracker({ onBack }) {
  const [expiries, setExpiries] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({
    drug_name: '',
    batch_no: '',
    quantity: '',
    expiry_date: '',
    location: '',
    supplier: '',
    notes: ''
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setExpiries(JSON.parse(saved));
      } catch (error) {
        console.error('Error loading expiries:', error);
      }
    }
  }, []);

  // Load medicines from CSV
  useEffect(() => {
    const loadMedicines = async () => {
      try {
        const response = await fetch(DRUGS_CSV_URL);
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

  // Save to localStorage whenever expiries change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expiries));
  }, [expiries]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const calculateDaysLeft = (expiryDate) => {
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getStatus = (daysLeft) => {
    if (daysLeft < 0) return 'Expired';
    if (daysLeft <= 90) return 'Near Expiry';
    return 'Safe';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.drug_name || !formData.expiry_date) {
      alert('Please fill in at least drug name and expiry date');
      return;
    }

    const daysLeft = calculateDaysLeft(formData.expiry_date);
    const status = getStatus(daysLeft);

    const newExpiry = {
      id: Date.now(),
      ...formData,
      days_left: daysLeft,
      status,
      created_at: new Date().toISOString()
    };

    setExpiries(prev => [...prev, newExpiry]);
    setFormData({
      drug_name: '',
      batch_no: '',
      quantity: '',
      expiry_date: '',
      location: '',
      supplier: '',
      notes: ''
    });
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this expiry record?')) {
      setExpiries(prev => prev.filter(expiry => expiry.id !== id));
    }
  };

  const [sortConfig, setSortConfig] = useState({ key: 'expiry_date', direction: 'asc' });

  const getSummary = () => {
    const total = expiries.length;
    const expired = expiries.filter((e) => e.status === 'Expired').length;
    const nearExpiry = expiries.filter((e) => e.status === 'Near Expiry').length;
    const safe = expiries.filter((e) => e.status === 'Safe').length;
    return { total, expired, nearExpiry, safe };
  };

  const summary = getSummary();

  const sortedExpiries = useMemo(() => {
    const sorted = [...expiries];
    const { key, direction } = sortConfig;

    sorted.sort((a, b) => {
      const aVal = a[key] ?? '';
      const bVal = b[key] ?? '';

      if (key === 'expiry_date') {
        const aDate = new Date(aVal);
        const bDate = new Date(bVal);
        return direction === 'asc' ? aDate - bDate : bDate - aDate;
      }

      if (key === 'days_left' || key === 'quantity') {
        const aNum = Number(aVal) || 0;
        const bNum = Number(bVal) || 0;
        return direction === 'asc' ? aNum - bNum : bNum - aNum;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [expiries, sortConfig]);

  const changeSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(expiries);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Expiries");
    XLSX.writeFile(wb, "FalconMed_expiry_export.xlsx");
  };

  return (
    <div className="expiry-tracker-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Expiry Tracker</h2>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <h3>Total Items</h3>
          <p className="summary-number">{summary.total}</p>
        </div>
        <div className="summary-card">
          <h3>Expired</h3>
          <p className="summary-number expired">{summary.expired}</p>
        </div>
        <div className="summary-card">
          <h3>Near Expiry</h3>
          <p className="summary-number near-expiry">{summary.nearExpiry}</p>
        </div>
        <div className="summary-card">
          <h3>Safe</h3>
          <p className="summary-number safe">{summary.safe}</p>
        </div>
      </div>

      {/* Add New Expiry Form */}
      <div className="form-container">
        <h3>Add New Expiry Item</h3>
        <form onSubmit={handleSubmit} className="expiry-form">
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
              <label htmlFor="batch_no">Batch No</label>
              <input
                type="text"
                id="batch_no"
                name="batch_no"
                value={formData.batch_no}
                onChange={handleInputChange}
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
                placeholder="e.g., 100 tablets"
              />
            </div>
            <div className="form-group">
              <label htmlFor="expiry_date">Expiry Date *</label>
              <input
                type="date"
                id="expiry_date"
                name="expiry_date"
                value={formData.expiry_date}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="location">Location</label>
              <input
                type="text"
                id="location"
                name="location"
                value={formData.location}
                onChange={handleInputChange}
                placeholder="Storage location"
              />
            </div>
            <div className="form-group">
              <label htmlFor="supplier">Supplier</label>
              <input
                type="text"
                id="supplier"
                name="supplier"
                value={formData.supplier}
                onChange={handleInputChange}
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
          <button type="submit" className="submit-button">Add Item</button>
        </form>
      </div>

      {/* Expiries Table */}
      <div className="table-container">
        <div className="table-header">
          <h3>Expiry Records ({expiries.length})</h3>
          <button onClick={handleExport} className="export-button">Export to Excel</button>
        </div>
        {expiries.length === 0 ? (
          <p className="no-records">No expiry records found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="expiries-table">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('drug_name')}>Drug</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('batch_no')}>Batch</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('quantity')}>Quantity</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('expiry_date')}>Expiry Date</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('days_left')}>Days Left</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('status')}>Status</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('location')}>Location</button>
                  </th>
                  <th>
                    <button type="button" className="sort-button" onClick={() => changeSort('supplier')}>Supplier</button>
                  </th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedExpiries.map((expiry) => (
                  <tr key={expiry.id} className={expiry.status === 'Near Expiry' ? 'near-expiry-row' : expiry.status === 'Expired' ? 'expired-row' : ''}>
                    <td>{expiry.drug_name}</td>
                    <td>{expiry.batch_no}</td>
                    <td>{expiry.quantity}</td>
                    <td>{new Date(expiry.expiry_date).toLocaleDateString()}</td>
                    <td>
                      <span className={`days-left ${expiry.days_left < 0 ? 'negative' : expiry.days_left <= 90 ? 'warning' : 'positive'}`}>
                        {expiry.days_left}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${expiry.status.toLowerCase().replace(' ', '-')}`}>
                        {expiry.status}
                      </span>
                    </td>
                    <td>{expiry.location}</td>
                    <td>{expiry.supplier}</td>
                    <td>{expiry.notes}</td>
                    <td>
                      <button
                        className="delete-button"
                        onClick={() => handleDelete(expiry.id)}
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

export default ExpiryTracker;