import { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import "./App.css";

const STORAGE_KEY = 'falconmed_shortages';
const DRUGS_CSV_URL = `${import.meta.env.BASE_URL}drugs.csv`;

function ShortageTracker({ onBack }) {
  const [shortages, setShortages] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [formData, setFormData] = useState({
    drug_name: '',
    quantity: '',
    patient_name: '',
    contact: '',
    payment_status: 'Unpaid',
    status: 'Pending',
    notes: ''
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

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
        const meds = dataRows
          .map((row) => {
            return {
              brand: (row[1] || '').trim(),
              generic: (row[2] || '').trim(),
              strength: (row[3] || '').trim(),
              dosageForm: (row[4] || '').trim()
            };
          })
          .filter((m) => m.brand || m.generic);
        setMedicines(meds);
      } catch (error) {
        console.error('Error loading medicines:', error);
      }
    };
    loadMedicines();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortages));
  }, [shortages]);

  const drugNameOptions = useMemo(() => {
    const names = medicines.flatMap((med) => [med.brand, med.generic].filter(Boolean));
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [medicines]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.drug_name || !formData.patient_name) {
      alert('Please fill in at least drug name and patient name');
      return;
    }

    const newShortage = {
      id: Date.now(),
      drug_name: formData.drug_name,
      quantity: formData.quantity || 'N/A',
      patient_name: formData.patient_name,
      contact: formData.contact || 'N/A',
      payment_status: formData.payment_status,
      status: formData.status,
      notes: formData.notes,
      requested_at: new Date().toISOString()
    };

    setShortages((prev) => [newShortage, ...prev]);
    setFormData({
      drug_name: '',
      quantity: '',
      patient_name: '',
      contact: '',
      payment_status: 'Unpaid',
      status: 'Pending',
      notes: ''
    });
  };

  const handleStatusChange = (id, newStatus) => {
    setShortages((prev) => prev.map((shortage) =>
      shortage.id === id ? { ...shortage, status: newStatus } : shortage
    ));
  };

  const handlePaymentChange = (id, newPaymentStatus) => {
    setShortages((prev) => prev.map((shortage) =>
      shortage.id === id ? { ...shortage, payment_status: newPaymentStatus } : shortage
    ));
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this shortage record?')) {
      setShortages((prev) => prev.filter((shortage) => shortage.id !== id));
    }
  };

  const summary = useMemo(() => {
    const total = shortages.length;
    const pending = shortages.filter((s) => s.status === 'Pending').length;
    const ordered = shortages.filter((s) => s.status === 'Ordered').length;
    const ready = shortages.filter((s) => s.status === 'Ready').length;
    const collected = shortages.filter((s) => s.status === 'Collected').length;
    const paid = shortages.filter((s) => s.payment_status === 'Paid').length;
    const unpaid = shortages.filter((s) => s.payment_status === 'Unpaid').length;
    return { total, pending, ordered, ready, collected, paid, unpaid };
  }, [shortages]);

  const filteredShortages = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return shortages.filter((item) => {
      const matchSearch =
        !term ||
        item.drug_name.toLowerCase().includes(term) ||
        item.patient_name.toLowerCase().includes(term) ||
        item.contact.toLowerCase().includes(term) ||
        item.notes.toLowerCase().includes(term);

      const matchStatus = statusFilter === 'All' || item.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [shortages, searchTerm, statusFilter]);

  const pagedShortages = filteredShortages.slice(0, 1000);

  const uniqueStatuses = ['All', 'Pending', 'Ordered', 'Ready', 'Collected'];

  return (
    <div className="shortage-tracker-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Shortage Tracker</h2>
      </div>

      <div className="summary-cards">
        <div className="summary-card"><h3>Total Requests</h3><p className="summary-number">{summary.total}</p></div>
        <div className="summary-card"><h3>Pending</h3><p className="summary-number pending">{summary.pending}</p></div>
        <div className="summary-card"><h3>Ready</h3><p className="summary-number ready">{summary.ready}</p></div>
        <div className="summary-card"><h3>Collected</h3><p className="summary-number collected">{summary.collected}</p></div>
        <div className="summary-card"><h3>Paid</h3><p className="summary-number">{summary.paid}</p></div>
        <div className="summary-card"><h3>Unpaid</h3><p className="summary-number pending">{summary.unpaid}</p></div>
      </div>

      <div className="form-container">
        <h3>Add New Shortage Request</h3>
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
                {drugNameOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label htmlFor="quantity">Requested Quantity</label>
              <input
                type="number"
                id="quantity"
                name="quantity"
                value={formData.quantity}
                onChange={handleInputChange}
                min="1"
                placeholder="Units"
              />
            </div>
            <div className="form-group">
              <label htmlFor="patient_name">Requester / Patient</label>
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
              <label htmlFor="contact">Contact Number</label>
              <input
                type="text"
                id="contact"
                name="contact"
                value={formData.contact}
                onChange={handleInputChange}
                placeholder="Mobile or Phone"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="payment_status">Payment Status</label>
              <select id="payment_status" name="payment_status" value={formData.payment_status} onChange={handleInputChange}>
                <option value="Unpaid">Unpaid</option>
                <option value="Paid">Paid</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="status">Shortage Status</label>
              <select id="status" name="status" value={formData.status} onChange={handleInputChange}>
                <option value="Pending">Pending</option>
                <option value="Ordered">Ordered</option>
                <option value="Ready">Ready</option>
                <option value="Collected">Collected</option>
              </select>
            </div>
            <div className="form-group full-width">
              <label htmlFor="notes">Note</label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows="3"
                placeholder="Additional request notes..."
              />
            </div>
          </div>

          <button className="submit-button">Save Request</button>
        </form>
      </div>

      <div className="table-controls">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search records..."
          className="search-input"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {uniqueStatuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3>Shortage Records ({filteredShortages.length})</h3>
          <button className="export-button" onClick={() => {
            const ws = XLSX.utils.json_to_sheet(filteredShortages);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Shortages');
            XLSX.writeFile(wb, 'FalconMed_shortage_export.xlsx');
          }}>
            Export to Excel
          </button>
        </div>

        {filteredShortages.length === 0 ? (
          <p className="no-records">No matching records</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="shortages-table">
              <thead>
                <tr>
                  <th>Drug</th>
                  <th>Requester</th>
                  <th>Qty</th>
                  <th>Contact</th>
                  <th>Requested</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedShortages.map((record) => (
                  <tr key={record.id}>
                    <td>{record.drug_name}</td>
                    <td>{record.patient_name}</td>
                    <td>{record.quantity}</td>
                    <td>{record.contact}</td>
                    <td>{new Date(record.requested_at).toLocaleString()}</td>
                    <td>
                      <select
                        value={record.payment_status}
                        onChange={(e) => handlePaymentChange(record.id, e.target.value)}
                      >
                        <option value="Unpaid">Unpaid</option>
                        <option value="Paid">Paid</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={record.status}
                        onChange={(e) => handleStatusChange(record.id, e.target.value)}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Ordered">Ordered</option>
                        <option value="Ready">Ready</option>
                        <option value="Collected">Collected</option>
                      </select>
                    </td>
                    <td>{record.notes}</td>
                    <td>
                      <button className="delete-button" onClick={() => handleDelete(record.id)}>Delete</button>
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
