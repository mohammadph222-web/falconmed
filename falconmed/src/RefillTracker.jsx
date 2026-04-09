import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMasterLoader";
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
          created_at: new Date().toISOString(),
          created_by: "falconmed.demo@preview",
        };

        let insertResult = await supabase
          .from(REFILL_TABLE)
          .insert({
            ...basePayload,
            daily_usage: Number(formData.daily_usage || 0),
          });

        let { error } = insertResult;

        if (error && String(error.message || '').toLowerCase().includes('created_by')) {
          const { created_by, ...payloadWithoutCreatedBy } = basePayload;

          insertResult = await supabase
            .from(REFILL_TABLE)
            .insert({
              ...payloadWithoutCreatedBy,
              daily_usage: Number(formData.daily_usage || 0),
            });

          error = insertResult.error;

          if (error && String(error.message || '').toLowerCase().includes('daily_usage')) {
            console.error('Missing daily_usage column in refill_requests. Falling back without daily_usage:', error.message);

            const retry = await supabase
              .from(REFILL_TABLE)
              .insert(payloadWithoutCreatedBy);

            error = retry.error;
          }
        }

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

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this refill record?')) return;

    try {
      if (!supabase) {
        console.error('Supabase is not configured. Unable to delete refill.');
        return;
      }

      const { error } = await supabase
        .from(REFILL_TABLE)
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Failed to delete refill request:', error.message);
        return;
      }

      await loadRefills();
    } catch (err) {
      console.error('Refill delete error:', err?.message || err);
    }
  };

  const handleMarkCompleted = async (id) => {
    try {
      if (!supabase) {
        console.error('Supabase is not configured. Unable to update refill status.');
        return;
      }

      const { error } = await supabase
        .from(REFILL_TABLE)
        .update({ status: 'Completed' })
        .eq('id', id);

      if (error) {
        console.error('Failed to mark refill as completed:', error.message);
        return;
      }

      await loadRefills();
    } catch (err) {
      console.error('Refill completion update error:', err?.message || err);
    }
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

  // ─── Style constants ────────────────────────────────────────────────────
  const page = {
    maxWidth: 1400,
    margin: '0 auto',
    padding: 0,
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const pageHeaderRow = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '30px',
    paddingBottom: '22px',
    borderBottom: '1px solid #e2ebf7',
  };

  const pageSub = {
    margin: '4px 0 0 0',
    fontSize: '14px',
    color: '#64748b',
    fontWeight: 400,
  };

  const headerActions = {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  };

  const backBtn = {
    background: '#f8fbff',
    border: '1px solid #d4dfef',
    borderRadius: '10px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#475569',
    cursor: 'pointer',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const exportBtn = {
    background: 'white',
    border: '1px solid #d4dfef',
    borderRadius: '10px',
    padding: '9px 16px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#1e40af',
    cursor: 'pointer',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const kpiGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '14px',
    marginBottom: '24px',
  };

  const kpiCard = (accentColor) => ({
    background: 'white',
    borderRadius: '16px',
    padding: '22px 20px 18px',
    border: '1px solid #dbe7f5',
    boxShadow: '0 12px 24px rgba(15,23,42,0.06)',
    borderTop: `4px solid ${accentColor}`,
  });

  const kpiLabel = {
    fontSize: '10px',
    fontWeight: 700,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    margin: '0 0 10px 0',
  };

  const kpiValue = {
    fontSize: '34px',
    fontWeight: 800,
    color: '#0f172a',
    margin: 0,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
  };

  const kpiHint = {
    fontSize: '12px',
    color: '#94a3b8',
    margin: '4px 0 0 0',
  };

  const formCard = {
    background: 'white',
    borderRadius: '16px',
    padding: '26px',
    border: '1px solid #dbe7f5',
    boxShadow: '0 14px 28px rgba(15,23,42,0.06)',
    marginBottom: '24px',
  };

  const sectionTitle = {
    margin: '0 0 18px 0',
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    paddingBottom: '12px',
    borderBottom: '1px solid #f1f5f9',
  };

  const formGrid = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '14px',
  };

  const fieldGroup = {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  };

  const fieldLabel = {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#374151',
  };

  const inputStyle = {
    padding: '9px 12px',
    border: '1px solid #d4dfef',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: "'Segoe UI', Arial, sans-serif",
    color: '#0f172a',
    background: 'white',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '0 2px 6px rgba(15,23,42,0.03)',
  };

  const primaryBtn = {
    background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    padding: '12px 28px',
    fontSize: '15px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Segoe UI', Arial, sans-serif",
    boxShadow: '0 10px 20px rgba(37,99,235,0.25)',
    marginTop: '4px',
  };

  const tableCard = {
    background: 'white',
    borderRadius: '16px',
    border: '1px solid #dbe7f5',
    boxShadow: '0 16px 30px rgba(15,23,42,0.07)',
    overflow: 'hidden',
  };

  const tableHeaderRow = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 26px 16px',
    borderBottom: '1px solid #e7eef9',
    flexWrap: 'wrap',
    gap: '12px',
  };

  const tableSectionTitle = {
    margin: 0,
    fontSize: '16px',
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  };

  const thStyle = {
    padding: '10px 14px',
    background: '#f8fbff',
    fontWeight: 700,
    color: '#64748b',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: '1px solid #e7eef9',
  };

  const tdStyle = {
    padding: '12px 14px',
    fontSize: '13px',
    color: '#334155',
    borderBottom: '1px solid #edf2fa',
    verticalAlign: 'middle',
  };

  const markCompleteBtn = {
    background: '#e8f1ff',
    color: '#1e40af',
    border: 'none',
    borderRadius: '8px',
    padding: '5px 10px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Segoe UI', Arial, sans-serif",
    marginRight: '6px',
  };

  const deleteBtn = {
    background: '#fff1f2',
    color: '#b91c1c',
    border: 'none',
    borderRadius: '8px',
    padding: '5px 10px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const emptyState = {
    padding: '40px 20px',
    textAlign: 'center',
    background: '#f8fbff',
  };

  // ─── JSX return ─────────────────────────────────────────────────────────
  return (
    <div style={page}>
      {/* Page header */}
      <div style={pageHeaderRow}>
        <div>
          <h2 style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
            Refill Tracker
          </h2>
          <p style={pageSub}>Track and manage patient refill schedules</p>
        </div>
        <div style={headerActions}>
          <button style={exportBtn} onClick={handleExport}>Export to Excel</button>
          <button style={backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={kpiGrid}>
        <div style={kpiCard('#3b82f6')}>
          <p style={kpiLabel}>Total Refills</p>
          <p style={kpiValue}>{summary.total}</p>
          <p style={kpiHint}>all records</p>
        </div>
        <div style={kpiCard('#10b981')}>
          <p style={kpiLabel}>Upcoming</p>
          <p style={{ ...kpiValue, color: '#10b981' }}>{summary.upcoming}</p>
          <p style={kpiHint}>scheduled refills</p>
        </div>
        <div style={kpiCard('#f59e0b')}>
          <p style={kpiLabel}>Due</p>
          <p style={{ ...kpiValue, color: '#f59e0b' }}>{summary.due}</p>
          <p style={kpiHint}>due within 3 days</p>
        </div>
        <div style={kpiCard('#ef4444')}>
          <p style={kpiLabel}>Overdue</p>
          <p style={{ ...kpiValue, color: '#ef4444' }}>{summary.overdue}</p>
          <p style={kpiHint}>past refill date</p>
        </div>
        <div style={kpiCard('#8b5cf6')}>
          <p style={kpiLabel}>Completed</p>
          <p style={{ ...kpiValue, color: '#8b5cf6' }}>{summary.completed}</p>
          <p style={kpiHint}>fulfilled refills</p>
        </div>
      </div>

      {/* Add New Refill Form */}
      <div style={formCard}>
        <h3 style={sectionTitle}>Add New Refill</h3>
        <form onSubmit={handleSubmit}>
          <div style={formGrid}>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Patient Name *</label>
              <input
                type="text"
                name="patient_name"
                value={formData.patient_name}
                onChange={handleInputChange}
                style={inputStyle}
                required
              />
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                style={inputStyle}
              />
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Drug Name *</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  name="drug_name"
                  value={drugSearch || formData.drug_name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDrugSearch(value);
                    setFormData((prev) => ({ ...prev, drug_name: value }));
                  }}
                  onFocus={() => setShowDrugDropdown(true)}
                  style={inputStyle}
                  required
                />
                {showDrugDropdown && filteredMedicines.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: '10px',
                    boxShadow: '0 4px 12px rgba(15,23,42,0.1)',
                    zIndex: 1000,
                    maxHeight: '220px',
                    overflowY: 'auto',
                  }}>
                    {filteredMedicines.map((med, index) => {
                      const displayName = getDrugDisplayName(med);
                      return (
                        <div
                          key={`med-${index}`}
                          style={{ padding: '10px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '14px', color: '#0f172a' }}
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
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: '#f8fafc',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    color: '#64748b',
                    fontSize: '14px',
                    zIndex: 1000,
                  }}>
                    No matching drugs found. You can type a manual item name.
                  </div>
                )}
              </div>
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Dispense Date *</label>
              <input
                type="date"
                name="dispense_date"
                value={formData.dispense_date}
                onChange={handleInputChange}
                style={inputStyle}
                required
              />
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity Dispensed</label>
              <input
                type="number"
                name="quantity_dispensed"
                value={formData.quantity_dispensed}
                onChange={handleInputChange}
                placeholder="e.g., 30"
                min="0"
                step="0.1"
                style={inputStyle}
              />
            </div>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Daily Usage</label>
              <input
                type="number"
                name="daily_usage"
                value={formData.daily_usage}
                onChange={handleInputChange}
                placeholder="e.g., 1"
                min="0.1"
                step="0.1"
                style={inputStyle}
              />
            </div>
            <div style={{ ...fieldGroup, gridColumn: '1 / -1' }}>
              <label style={fieldLabel}>Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows="3"
                placeholder="Additional notes..."
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" style={primaryBtn}>Add Refill</button>
            </div>
          </div>
        </form>
      </div>

      {/* Refills Table */}
      <div style={tableCard}>
        <div style={tableHeaderRow}>
          <h3 style={tableSectionTitle}>
            Refill Records{' '}
            <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '14px' }}>
              ({filteredRefills.length} / {refills.length})
            </span>
          </h3>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['all', 'upcoming', 'due', 'overdue', 'completed'].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  border: filterStatus === s ? 'none' : '1.5px solid #e2e8f0',
                  background: filterStatus === s ? '#1e40af' : '#f8fafc',
                  color: filterStatus === s ? 'white' : '#334155',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: "'Segoe UI', Arial, sans-serif",
                  textTransform: 'capitalize',
                }}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {refills.length === 0 ? (
          <div style={emptyState}>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#475569' }}>No refill records yet</p>
            <p style={{ margin: '6px 0 0 0', color: '#94a3b8', fontSize: '13px' }}>Add a new refill above to get started</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Patient', 'Phone', 'Drug', 'Dispensed', 'Daily Usage', 'Days Supply', 'Next Refill', 'Status', 'Notes', 'Actions'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRefills.map((refill, i) => {
                  const isEven = i % 2 === 1;
                  let rowBg = isEven ? '#f9fafb' : 'white';
                  if (refill.status === 'Overdue') rowBg = '#fee2e2';
                  else if (refill.status === 'Due') rowBg = '#fef3c7';

                  return (
                    <tr key={refill.id} style={{ background: rowBg }}>
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#0f172a' }}>{refill.patient_name}</td>
                      <td style={tdStyle}>{refill.phone}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#0f172a' }}>{refill.drug_name}</td>
                      <td style={tdStyle}>{refill.quantity_dispensed}</td>
                      <td style={tdStyle}>{refill.daily_usage}</td>
                      <td style={tdStyle}>{refill.days_supply}</td>
                      <td style={tdStyle}>{refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString() : 'N/A'}</td>
                      <td style={tdStyle}>
                        <span className={`status-badge ${refill.status.toLowerCase()}`}>
                          {refill.status}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b', maxWidth: '160px' }}>{refill.notes}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                        {refill.status !== 'Completed' && (
                          <button style={markCompleteBtn} onClick={() => handleMarkCompleted(refill.id)}>
                            ✓ Complete
                          </button>
                        )}
                        <button style={deleteBtn} onClick={() => handleDelete(refill.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default RefillTracker;