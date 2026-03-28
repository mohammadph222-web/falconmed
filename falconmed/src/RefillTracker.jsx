import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMaster";
import "./App.css";

const STORAGE_KEY = 'falconmed_refills';
const REFILL_TABLE = "refill_requests";

function calculateRefillInfo(quantityDispensed, dailyUsage, dispenseDate) {
  const qty = Number(quantityDispensed || 0);
  const usage = Number(dailyUsage || 0);

  if (!Number.isFinite(qty) || !Number.isFinite(usage) || usage <= 0 || !dispenseDate) {
    return { daysSupply: 0, nextRefillDate: null };
  }

  const daysSupply = qty / usage;
  const dispense = new Date(dispenseDate);

  if (Number.isNaN(dispense.getTime())) {
    return { daysSupply: 0, nextRefillDate: null };
  }

  const nextRefill = new Date(dispense);
  nextRefill.setDate(dispense.getDate() + Math.ceil(daysSupply));

  return {
    daysSupply: Number(daysSupply.toFixed(2)),
    nextRefillDate: nextRefill.toISOString().split('T')[0],
  };
}

function getRefillStatus(nextRefillDate, fallbackStatus = "Pending") {
  if (!nextRefillDate) return fallbackStatus;

  const today = new Date();
  const next = new Date(nextRefillDate);
  const diffTime = next - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Overdue';
  if (diffDays <= 3) return 'Due';
  return 'Upcoming';
}

const mapDbToUi = (row) => {
  const dispensed = Number(row.dispensed ?? row.quantity ?? 0);
  const usage = Number(row.daily_usage || 0);
  const { daysSupply, nextRefillDate } = calculateRefillInfo(
    dispensed,
    usage,
    row.request_date || ""
  );

  return {
    id: row.id,
    patient_name: row.patient_name || "",
    phone: row.contact_number || "",
    drug_name: row.drug_name || "",
    quantity_dispensed: dispensed,
    daily_usage: usage,
    dispense_date: row.request_date || "",
    days_supply: daysSupply,
    next_refill_date: nextRefillDate,
    status: row.status || getRefillStatus(nextRefillDate, "Pending"),
    notes: row.notes || "",
    created_at: row.created_at || new Date().toISOString(),
  };
};

function RefillTracker({ onBack }) {
  const [refills, setRefills] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [drugSearch, setDrugSearch] = useState('');
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [formData, setFormData] = useState({
    patient_name: '',
    phone: '',
    drug_name: '',
    quantity_dispensed: '',
    daily_usage: '',
    dispense_date: '',
    status: 'Pending',
    notes: ''
  });

  const loadRefills = async () => {
    try {
      const { data, error } = await supabase
        .from(REFILL_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error('Failed to load refill requests:', error.message);
        return;
      }

      setRefills((data || []).map(mapDbToUi));
    } catch (error) {
      console.error('Refill fetch error:', error?.message || error);
    }
  };

  // Load from Supabase on mount; keep localStorage as fallback cache
  useEffect(() => {
    void loadRefills();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setRefills((prev) => (prev.length > 0 ? prev : parsed));
      }
    } catch (error) {
      console.error('Error loading refills cache:', error);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setMedicines(rows || []);
        }
      })
      .catch((error) => {
        console.error('Error loading medicines:', error);
        if (isMounted) {
          setMedicines([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredMedicines = useMemo(() => {
    return showDrugDropdown ? searchDrugMaster(medicines, drugSearch, 25) : [];
  }, [medicines, drugSearch, showDrugDropdown]);

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

  const handleSubmit = (e) => {
    e.preventDefault();

    const submit = async () => {
      if (
        !formData.patient_name ||
        !formData.phone ||
        !formData.drug_name ||
        !formData.quantity_dispensed ||
        !formData.dispense_date
      ) {
        alert('Please fill in patient name, contact number, drug name, quantity, and request date');
        return;
      }

      try {
        const basePayload = {
          patient_name: formData.patient_name,
          contact_number: formData.phone,
          drug_name: formData.drug_name,
          quantity: Number(formData.quantity_dispensed),
          dispensed: Number(formData.quantity_dispensed),
          request_date: formData.dispense_date,
          status: formData.status || 'Pending',
          notes: formData.notes,
        };

        let { error } = await supabase
          .from(REFILL_TABLE)
          .insert({
            ...basePayload,
            daily_usage: Number(formData.daily_usage || 0),
          });

        if (error && String(error.message || '').toLowerCase().includes('daily_usage')) {
          console.error('Missing daily_usage column in refill_requests. Falling back without daily_usage:', error.message);

          const retry = await supabase
            .from(REFILL_TABLE)
            .insert(basePayload);

          error = retry.error;
        }

        if (error) {
          console.error('Failed to save refill request:', error.message);
          return;
        }

        try {
          const { error: activityError } = await supabase.from("activity_log").insert({
            module: "Refill",
            action: "Created",
            description: `Refill request created: ${formData.patient_name} - ${formData.drug_name}`,
          });

          if (activityError) {
            console.error("Failed to log refill activity:", activityError.message);
          }
        } catch (activityErr) {
          console.error("Refill activity log error:", activityErr?.message || "Unknown error");
        }

        await loadRefills();

        setFormData({
          patient_name: '',
          phone: '',
          drug_name: '',
          quantity_dispensed: '',
          daily_usage: '',
          dispense_date: '',
          notes: '',
          status: 'Pending',
        });
        setDrugSearch('');
        setShowDrugDropdown(false);
      } catch (err) {
        console.error('Refill save error:', err?.message || err);
      }
    };

    void submit();
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this refill record?')) {
      setRefills(prev => prev.filter(refill => refill.id !== id));
    }
  };

  const handleMarkCompleted = (id) => {
    setRefills(prev => prev.map(refill => refill.id === id ? { ...refill, status: 'Completed' } : refill));
  };

  const filteredRefills = useMemo(() => {
    if (filterStatus === 'all') return refills;
    return refills.filter(refill => refill.status.toLowerCase() === filterStatus);
  }, [refills, filterStatus]);

  const getSummary = () => {
    const total = refills.length;
    const upcoming = refills.filter(r => r.status === 'Upcoming').length;
    const due = refills.filter(r => r.status === 'Due').length;
    const overdue = refills.filter(r => r.status === 'Overdue').length;
    const completed = refills.filter(r => r.status === 'Completed').length;
    return { total, upcoming, due, overdue, completed };
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
              <div style={{ position: 'relative' }}>
              <input
                type="text"
                id="drug_name"
                name="drug_name"
                value={drugSearch || formData.drug_name}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrugSearch(value);
                  setFormData((prev) => ({ ...prev, drug_name: value }));
                }}
                onFocus={() => setShowDrugDropdown(true)}
                required
              />
              {showDrugDropdown && filteredMedicines.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '44px',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.1)',
                    zIndex: 1000,
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}
                >
                  {filteredMedicines.map((med, index) => {
                    const displayName = getDrugDisplayName(med);

                    return (
                      <div
                        key={`med-${index}`}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setFormData((prev) => ({ ...prev, drug_name: displayName }));
                          setDrugSearch(displayName);
                          setShowDrugDropdown(false);
                        }}
                      >
                        {displayName}
                      </div>
                    );
                  })}
                </div>
              )}
              {showDrugDropdown && drugSearch && filteredMedicines.length === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '44px',
                    left: 0,
                    right: 0,
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    color: '#64748b',
                    fontSize: '14px',
                    zIndex: 1000,
                  }}
                >
                  No matching drugs found. You can type a manual item name.
                </div>
              )}
              </div>
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
          <h3>Refill Records ({filteredRefills.length} / {refills.length})</h3>
          <div className="filter-buttons">
            <button className={filterStatus === 'all' ? 'active' : ''} onClick={() => setFilterStatus('all')}>All</button>
            <button className={filterStatus === 'upcoming' ? 'active' : ''} onClick={() => setFilterStatus('upcoming')}>Upcoming</button>
            <button className={filterStatus === 'due' ? 'active' : ''} onClick={() => setFilterStatus('due')}>Due</button>
            <button className={filterStatus === 'overdue' ? 'active' : ''} onClick={() => setFilterStatus('overdue')}>Overdue</button>
            <button className={filterStatus === 'completed' ? 'active' : ''} onClick={() => setFilterStatus('completed')}>Completed</button>
          </div>
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
                {filteredRefills.map((refill) => (
                  <tr
                    key={refill.id}
                    className={
                      refill.status === 'Overdue'
                        ? 'overdue-row'
                        : refill.status === 'Due'
                        ? 'due-row'
                        : refill.status === 'Upcoming'
                        ? 'upcoming-row'
                        : refill.status === 'Completed'
                        ? 'completed-row'
                        : ''
                    }
                  >
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
                      {refill.status !== 'Completed' && (
                        <button
                          className="action-button"
                          onClick={() => handleMarkCompleted(refill.id)}
                        >
                          Mark Completed
                        </button>
                      )}
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