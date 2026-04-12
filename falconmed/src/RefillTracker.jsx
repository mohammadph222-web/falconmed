import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMasterLoader";
import "./App.css";
import { MetricCard, PageHeader, StatusPill } from "./ui";

const STORAGE_KEY = "falconmed_refills";
const REFILL_TABLE = "refill_requests";
const DUE_WINDOW_DAYS = 3;

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

  const safeDays = Math.ceil(daysSupply);
  const nextRefill = new Date(dispense);
  nextRefill.setDate(dispense.getDate() + safeDays);

  return {
    daysSupply: Number(daysSupply.toFixed(2)),
    nextRefillDate: nextRefill.toISOString().split("T")[0],
  };
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function deriveQueueStatus(nextRefillDate, persistedStatus = "Pending") {
  if (normalizeStatus(persistedStatus) === "completed") {
    return "Completed";
  }

  if (!nextRefillDate) {
    return "Upcoming";
  }

  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const next = new Date(nextRefillDate);
  if (Number.isNaN(next.getTime())) {
    return "Upcoming";
  }

  const nextOnly = new Date(next.getFullYear(), next.getMonth(), next.getDate());
  const diffDays = Math.round((nextOnly - todayOnly) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "Overdue";
  if (diffDays <= DUE_WINDOW_DAYS) return "Due";
  return "Upcoming";
}

function getStatusSortRank(status) {
  if (status === "Overdue") return 0;
  if (status === "Due") return 1;
  if (status === "Upcoming") return 2;
  return 3;
}

const mapDbToUi = (row) => {
  const dispensed = Number(row.dispensed ?? row.quantity ?? 0);
  const usage = Number(row.daily_usage || 0);
  const { daysSupply, nextRefillDate } = calculateRefillInfo(
    dispensed,
    usage,
    row.request_date || ""
  );

  const persistedStatus = row.status || "Pending";

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
    status: persistedStatus,
    queue_status: deriveQueueStatus(nextRefillDate, persistedStatus),
    notes: row.notes || "",
    created_at: row.created_at || new Date().toISOString(),
  };
};

function RefillTracker({ onBack }) {
  const [refills, setRefills] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [selectedDrugLabel, setSelectedDrugLabel] = useState("");
  const selectAllRef = useRef(null);
  const [formData, setFormData] = useState({
    patient_name: "",
    phone: "",
    drug_name: "",
    quantity_dispensed: "",
    daily_usage: "",
    dispense_date: "",
    status: "Pending",
    notes: "",
  });

  const computedRefillInfo = useMemo(() => {
    return calculateRefillInfo(
      formData.quantity_dispensed,
      formData.daily_usage,
      formData.dispense_date
    );
  }, [formData.quantity_dispensed, formData.daily_usage, formData.dispense_date]);

  const loadRefills = async () => {
    try {
      const { data, error } = await supabase
        .from(REFILL_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load refill requests:", error.message);
        return;
      }

      setRefills((data || []).map(mapDbToUi));
    } catch (error) {
      console.error("Refill fetch error:", error?.message || error);
    }
  };

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
      console.error("Error loading refills cache:", error);
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
        console.error("Error loading medicines:", error);
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refills));
  }, [refills]);

  const sortedRefills = useMemo(() => {
    const list = [...refills];
    list.sort((a, b) => {
      const rankDiff = getStatusSortRank(a.queue_status) - getStatusSortRank(b.queue_status);
      if (rankDiff !== 0) return rankDiff;

      if (a.queue_status === "Completed" && b.queue_status === "Completed") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }

      const aDate = a.next_refill_date ? new Date(a.next_refill_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b.next_refill_date ? new Date(b.next_refill_date).getTime() : Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });
    return list;
  }, [refills]);

  const filteredRefills = useMemo(() => {
    if (filterStatus === "all") return sortedRefills;
    const wanted = filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1);
    return sortedRefills.filter((refill) => refill.queue_status === wanted);
  }, [sortedRefills, filterStatus]);

  const filteredRowIds = useMemo(
    () => filteredRefills.map((row) => row.id).filter(Boolean),
    [filteredRefills]
  );

  const selectedVisibleCount = useMemo(() => {
    if (filteredRowIds.length === 0) return 0;
    const visibleSet = new Set(filteredRowIds);
    return selectedRowIds.filter((id) => visibleSet.has(id)).length;
  }, [filteredRowIds, selectedRowIds]);

  const allVisibleSelected = filteredRowIds.length > 0 && selectedVisibleCount === filteredRowIds.length;
  const hasVisibleSelection = selectedVisibleCount > 0;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = hasVisibleSelection && !allVisibleSelected;
    }
  }, [hasVisibleSelection, allVisibleSelected]);

  useEffect(() => {
    const availableIds = new Set(refills.map((row) => row.id));
    setSelectedRowIds((prev) => prev.filter((id) => availableIds.has(id)));
  }, [refills]);

  const summary = useMemo(() => {
    const total = refills.length;
    const upcoming = refills.filter((r) => r.queue_status === "Upcoming").length;
    const due = refills.filter((r) => r.queue_status === "Due").length;
    const overdue = refills.filter((r) => r.queue_status === "Overdue").length;
    const completed = refills.filter((r) => r.queue_status === "Completed").length;
    return { total, upcoming, due, overdue, completed };
  }, [refills]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (name === "drug_name") {
      setSelectedDrugLabel("");
    }
  };

  const resetForm = () => {
    setFormData({
      patient_name: "",
      phone: "",
      drug_name: "",
      quantity_dispensed: "",
      daily_usage: "",
      dispense_date: "",
      status: "Pending",
      notes: "",
    });
    setDrugSearch("");
    setShowDrugDropdown(false);
    setSelectedDrugLabel("");
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
        alert("Please fill in patient name, phone, drug name, quantity, and dispense date.");
        return;
      }

      const qty = Number(formData.quantity_dispensed);
      const usage = Number(formData.daily_usage || 0);

      if (!Number.isFinite(qty) || qty <= 0) {
        alert("Quantity dispensed must be greater than zero.");
        return;
      }

      if (formData.daily_usage && (!Number.isFinite(usage) || usage <= 0)) {
        alert("Daily usage must be greater than zero when provided.");
        return;
      }

      try {
        const basePayload = {
          patient_name: formData.patient_name,
          contact_number: formData.phone,
          drug_name: formData.drug_name,
          quantity: qty,
          dispensed: qty,
          request_date: formData.dispense_date,
          status: formData.status || "Pending",
          notes: formData.notes,
          created_at: new Date().toISOString(),
          created_by: "falconmed.demo@preview",
        };

        let insertResult = await supabase.from(REFILL_TABLE).insert({
          ...basePayload,
          daily_usage: usage,
        });

        let { error } = insertResult;

        if (error && String(error.message || "").toLowerCase().includes("created_by")) {
          const { created_by, ...payloadWithoutCreatedBy } = basePayload;

          insertResult = await supabase.from(REFILL_TABLE).insert({
            ...payloadWithoutCreatedBy,
            daily_usage: usage,
          });

          error = insertResult.error;

          if (error && String(error.message || "").toLowerCase().includes("daily_usage")) {
            console.error(
              "Missing daily_usage column in refill_requests. Falling back without daily_usage:",
              error.message
            );

            const retry = await supabase.from(REFILL_TABLE).insert(payloadWithoutCreatedBy);
            error = retry.error;
          }
        }

        if (error && String(error.message || "").toLowerCase().includes("daily_usage")) {
          console.error(
            "Missing daily_usage column in refill_requests. Falling back without daily_usage:",
            error.message
          );

          const retry = await supabase.from(REFILL_TABLE).insert(basePayload);
          error = retry.error;
        }

        if (error) {
          console.error("Failed to save refill request:", error.message);
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
        resetForm();
      } catch (err) {
        console.error("Refill save error:", err?.message || err);
      }
    };

    void submit();
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this refill record?")) return;

    try {
      if (!supabase) {
        console.error("Supabase is not configured. Unable to delete refill.");
        return;
      }

      const { error } = await supabase.from(REFILL_TABLE).delete().eq("id", id);

      if (error) {
        console.error("Failed to delete refill request:", error.message);
        return;
      }

      await loadRefills();
    } catch (err) {
      console.error("Refill delete error:", err?.message || err);
    }
  };

  const handleMarkCompleted = async (id) => {
    try {
      if (!supabase) {
        console.error("Supabase is not configured. Unable to update refill status.");
        return;
      }

      const { error } = await supabase.from(REFILL_TABLE).update({ status: "Completed" }).eq("id", id);

      if (error) {
        console.error("Failed to mark refill as completed:", error.message);
        return;
      }

      await loadRefills();
    } catch (err) {
      console.error("Refill completion update error:", err?.message || err);
    }
  };

  const handleMarkDispensed = async (refill) => {
    if (!window.confirm("Mark this refill as dispensed and restart the refill cycle from today?")) {
      return;
    }

    try {
      const today = new Date().toISOString().split("T")[0];

      const { error } = await supabase
        .from(REFILL_TABLE)
        .update({ request_date: today, status: "Pending" })
        .eq("id", refill.id);

      if (error) {
        console.error("Failed to mark refill as dispensed:", error.message);
        return;
      }

      await loadRefills();
    } catch (err) {
      console.error("Refill dispense update error:", err?.message || err);
    }
  };

  const handleToggleRowSelection = (id) => {
    setSelectedRowIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const handleToggleSelectAllVisible = () => {
    if (filteredRowIds.length === 0) return;

    setSelectedRowIds((prev) => {
      if (allVisibleSelected) {
        const visible = new Set(filteredRowIds);
        return prev.filter((id) => !visible.has(id));
      }

      const merged = new Set([...prev, ...filteredRowIds]);
      return Array.from(merged);
    });
  };

  const handleBulkComplete = async () => {
    if (selectedRowIds.length === 0) return;

    try {
      const { error } = await supabase
        .from(REFILL_TABLE)
        .update({ status: "Completed" })
        .in("id", selectedRowIds);

      if (error) {
        console.error("Failed to bulk mark completed:", error.message);
        return;
      }

      await loadRefills();
      setSelectedRowIds([]);
    } catch (err) {
      console.error("Bulk complete error:", err?.message || err);
    }
  };

  const handleBulkDispensed = async () => {
    if (selectedRowIds.length === 0) return;

    try {
      const today = new Date().toISOString().split("T")[0];

      const { error } = await supabase
        .from(REFILL_TABLE)
        .update({ request_date: today, status: "Pending" })
        .in("id", selectedRowIds);

      if (error) {
        console.error("Failed to bulk mark dispensed:", error.message);
        return;
      }

      await loadRefills();
      setSelectedRowIds([]);
    } catch (err) {
      console.error("Bulk dispensed error:", err?.message || err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRowIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedRowIds.length} selected refill record(s)? This cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase.from(REFILL_TABLE).delete().in("id", selectedRowIds);

      if (error) {
        console.error("Failed to bulk delete refill requests:", error.message);
        return;
      }

      await loadRefills();
      setSelectedRowIds([]);
    } catch (err) {
      console.error("Bulk delete error:", err?.message || err);
    }
  };

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(
      sortedRefills.map((item) => ({
        Patient: item.patient_name,
        Phone: item.phone,
        Drug: item.drug_name,
        Dispensed: item.quantity_dispensed,
        "Daily Usage": item.daily_usage,
        "Days Supply": item.days_supply,
        "Next Refill": item.next_refill_date || "",
        Status: item.queue_status,
        Notes: item.notes,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Refills");
    XLSX.writeFile(wb, "FalconMed_refill_export.xlsx");
  };

  const statusPillStyle = (status) => {
    if (status === "Completed") {
      return {
        background: "#eef2ff",
        color: "#4338ca",
        border: "1px solid #c7d2fe",
      };
    }
    if (status === "Overdue") {
      return {
        background: "#fef2f2",
        color: "#b91c1c",
        border: "1px solid #fecaca",
      };
    }
    if (status === "Due") {
      return {
        background: "#fffbeb",
        color: "#b45309",
        border: "1px solid #fde68a",
      };
    }
    return {
      background: "#eff6ff",
      color: "#1d4ed8",
      border: "1px solid #bfdbfe",
    };
  };

  const page = {
    maxWidth: 1400,
    margin: "0 auto",
    padding: 0,
  };

  const pageHeaderRow = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: "28px",
    paddingBottom: "20px",
    borderBottom: "1px solid #e2e8f0",
  };

  const pageSub = {
    margin: "6px 0 0 0",
    fontSize: "14.2px",
    color: "#64748b",
    fontWeight: 400,
  };

  const headerActions = {
    display: "flex",
    gap: "11px",
    alignItems: "center",
  };

  const secondaryBtn = {
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "9px 15px",
    fontSize: "13.2px",
    fontWeight: 700,
    color: "#334155",
    cursor: "pointer",
    boxShadow: "0 6px 14px rgba(15, 23, 42, 0.06)",
  };

  const kpiGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "13px",
    marginBottom: "22px",
  };

  const kpiCard = (accentColor) => ({
    background: "#ffffff",
    borderRadius: "14px",
    padding: "17px 16px 15px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 10px 22px rgba(15,23,42,0.06)",
    borderTop: `3px solid ${accentColor}`,
  });

  const kpiLabel = {
    fontSize: "10.5px",
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    margin: "0 0 8px 0",
  };

  const kpiValue = {
    fontSize: "30px",
    fontWeight: 800,
    color: "#0f172a",
    margin: 0,
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  };

  const kpiHint = {
    fontSize: "12.2px",
    color: "#7b8ea7",
    margin: "4px 0 0 0",
  };

  const formCard = {
    background: "#ffffff",
    borderRadius: "14px",
    padding: "22px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
    marginBottom: "20px",
  };

  const sectionTitle = {
    margin: "0 0 18px 0",
    fontSize: "17px",
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.01em",
    paddingBottom: "10px",
    borderBottom: "1px solid #f1f5f9",
  };

  const formGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  };

  const fieldGroup = {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  };

  const fieldLabel = {
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#334155",
  };

  const inputStyle = {
    padding: "10px 12px",
    border: "1px solid #c4d3e6",
    borderRadius: "10px",
    fontSize: "14px",
    color: "#0f172a",
    background: "#ffffff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  const readonlyInput = {
    ...inputStyle,
    background: "#f8fafc",
    color: "#475569",
  };

  const primaryBtn = {
    background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    padding: "10px 19px",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 8px 16px rgba(37,99,235,0.24)",
  };

  const tableCard = {
    background: "#ffffff",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
    overflow: "hidden",
  };

  const tableHeaderRow = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "17px 19px 15px",
    borderBottom: "1px solid #e2e8f0",
    flexWrap: "wrap",
    gap: "10px",
  };

  const bulkBar = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    padding: "11px 19px",
    borderBottom: "1px solid #dbeafe",
    background: "#f8fbff",
  };

  const bulkText = {
    fontSize: "13px",
    fontWeight: 600,
    color: "#1e3a8a",
  };

  const tableSectionTitle = {
    margin: 0,
    fontSize: "17px",
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.01em",
  };

  const thStyle = {
    padding: "11px 13px",
    background: "#f8fafc",
    fontWeight: 700,
    color: "#64748b",
    fontSize: "10.5px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    position: "sticky",
    top: 0,
    textAlign: "left",
    whiteSpace: "nowrap",
    borderBottom: "1px solid #e2e8f0",
  };

  const tdStyle = {
    padding: "11px 12px",
    fontSize: "13px",
    color: "#334155",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
  };

  const compactMeta = {
    fontSize: "11px",
    color: "#64748b",
    marginTop: "2px",
    lineHeight: 1.35,
  };

  const notesText = {
    display: "block",
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#64748b",
    fontSize: "12px",
  };

  const checkboxStyle = {
    width: "15px",
    height: "15px",
    cursor: "pointer",
  };

  const actionBtn = {
    background: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    borderRadius: "9px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(29, 78, 216, 0.1)",
    marginRight: "6px",
  };

  const actionBtnDanger = {
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    borderRadius: "9px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(185, 28, 28, 0.08)",
  };

  const emptyState = {
    padding: "30px 20px",
    textAlign: "center",
    background: "#f8fafc",
  };

  const filterTabs = ["all", "upcoming", "due", "overdue", "completed"];

  return (
    <div style={page}>
      <div style={pageHeaderRow}>
        <PageHeader
          title="Refill Tracker"
          subtitle="Operational refill queue for outpatient pharmacy follow-up"
          style={{ marginTop: 0, marginBottom: 0, width: "100%" }}
          actions={
            <div style={headerActions}>
              <button style={secondaryBtn} className="fm-action-btn" onClick={handleExport}>Export to Excel</button>
              <button style={secondaryBtn} className="fm-action-btn" onClick={onBack}>← Back</button>
            </div>
          }
        />
      </div>

      <div style={kpiGrid}>
        <MetricCard className="ui-hover-lift" accent="primary" icon="TOTAL" label="Total Refills" value={summary.total} helper="all records" />
        <MetricCard className="ui-hover-lift" accent="success" icon="UP" label="Upcoming" value={summary.upcoming} helper={`next > ${DUE_WINDOW_DAYS} days`} />
        <MetricCard className="ui-hover-lift" accent="warning" icon="DUE" label="Due" value={summary.due} helper={`today to ${DUE_WINDOW_DAYS} days`} />
        <MetricCard className="ui-hover-lift" accent="danger" icon="OVER" label="Overdue" value={summary.overdue} helper="past refill date" />
        <MetricCard className="ui-hover-lift" accent="neutral" icon="DONE" label="Completed" value={summary.completed} helper="fulfilled requests" />
      </div>

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
              <label style={fieldLabel}>Phone *</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                style={inputStyle}
                required
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Drug Name *</label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  name="drug_name"
                  value={drugSearch || formData.drug_name}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDrugSearch(value);
                    setFormData((prev) => ({ ...prev, drug_name: value }));
                    setSelectedDrugLabel("");
                  }}
                  onFocus={() => setShowDrugDropdown(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowDrugDropdown(false), 140);
                  }}
                  placeholder="Search drug master or type manually"
                  style={inputStyle}
                  required
                />
                {showDrugDropdown && filteredMedicines.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 6px 16px rgba(15,23,42,0.10)",
                      zIndex: 1000,
                      maxHeight: "220px",
                      overflowY: "auto",
                    }}
                  >
                    {filteredMedicines.map((med, index) => {
                      const displayName = getDrugDisplayName(med);
                      const code = med?.drug_code ? ` (${med.drug_code})` : "";
                      return (
                        <div
                          key={`med-${index}`}
                          style={{
                            padding: "10px 12px",
                            borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            fontSize: "13px",
                            color: "#0f172a",
                          }}
                          onMouseDown={() => {
                            setFormData((prev) => ({ ...prev, drug_name: displayName }));
                            setDrugSearch(displayName);
                            setSelectedDrugLabel(`${displayName}${code}`);
                            setShowDrugDropdown(false);
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{displayName}</div>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {med?.drug_code ? `Code: ${med.drug_code}` : "Drug master"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {showDrugDropdown && drugSearch && filteredMedicines.length === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      background: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      color: "#64748b",
                      fontSize: "13px",
                      zIndex: 1000,
                    }}
                  >
                    No matching drug in master. You can keep manual entry.
                  </div>
                )}
              </div>
              <div style={{ fontSize: "12px", color: selectedDrugLabel ? "#1d4ed8" : "#64748b" }}>
                {selectedDrugLabel || "Tip: choose from drug master for safer refill tracking."}
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
              <label style={fieldLabel}>Quantity Dispensed *</label>
              <input
                type="number"
                name="quantity_dispensed"
                value={formData.quantity_dispensed}
                onChange={handleInputChange}
                placeholder="e.g. 30"
                min="0"
                step="0.1"
                style={inputStyle}
                required
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Daily Usage</label>
              <input
                type="number"
                name="daily_usage"
                value={formData.daily_usage}
                onChange={handleInputChange}
                placeholder="e.g. 1"
                min="0"
                step="0.1"
                style={inputStyle}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Days Supply (Auto)</label>
              <input
                type="text"
                value={computedRefillInfo.daysSupply > 0 ? computedRefillInfo.daysSupply : "-"}
                readOnly
                style={readonlyInput}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Next Refill (Auto)</label>
              <input
                type="text"
                value={computedRefillInfo.nextRefillDate || "-"}
                readOnly
                style={readonlyInput}
              />
            </div>

            <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
              <label style={fieldLabel}>Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows="3"
                placeholder="Additional notes..."
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-start" }}>
              <button type="submit" style={primaryBtn} className="fm-action-btn">Add Refill</button>
            </div>
          </div>
        </form>
      </div>

      <div style={tableCard}>
        <div style={tableHeaderRow}>
          <h3 style={tableSectionTitle}>
            Refill Queue{" "}
            <span style={{ fontWeight: 500, color: "#94a3b8", fontSize: "14px" }}>
              ({filteredRefills.length} / {refills.length})
            </span>
          </h3>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {filterTabs.map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="fm-action-btn"
                style={{
                  border: filterStatus === s ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                  background: filterStatus === s ? "#2563eb" : "#ffffff",
                  color: filterStatus === s ? "#ffffff" : "#334155",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  textTransform: "capitalize",
                  boxShadow: "none",
                }}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {selectedRowIds.length > 0 && (
          <div style={bulkBar}>
            <div style={bulkText}>{selectedRowIds.length} selected</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button style={actionBtn} className="fm-action-btn" onClick={handleBulkDispensed}>Mark Dispensed</button>
              <button style={actionBtn} className="fm-action-btn" onClick={handleBulkComplete}>Complete</button>
              <button style={actionBtnDanger} className="fm-action-btn" onClick={handleBulkDelete}>Delete Selected</button>
            </div>
          </div>
        )}

        {refills.length === 0 ? (
          <div style={emptyState}>
            <p style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#475569" }}>
              No refill records yet
            </p>
            <p style={{ margin: "6px 0 0 0", color: "#94a3b8", fontSize: "13px" }}>
              Add a new refill above to get started.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: "34px" }}>
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={handleToggleSelectAllVisible}
                      style={checkboxStyle}
                      aria-label="Select all visible rows"
                    />
                  </th>
                  {["Patient", "Drug", "Next Refill", "Status", "Notes", "Actions"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRefills.map((refill) => {
                  const queueStatus = refill.queue_status;
                  const isSelected = selectedRowIds.includes(refill.id);
                  const rowBg =
                    queueStatus === "Overdue"
                      ? "#fff7f7"
                      : queueStatus === "Due"
                      ? "#fffbf0"
                      : "#ffffff";

                  return (
                    <tr key={refill.id} className="fm-table-row" style={{ background: isSelected ? "#eff6ff" : rowBg }}>
                      <td style={{ ...tdStyle, width: "34px" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleRowSelection(refill.id)}
                          style={checkboxStyle}
                          aria-label={`Select refill for ${refill.patient_name}`}
                        />
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{refill.patient_name}</div>
                        <div style={compactMeta}>{refill.phone || "No phone"}</div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: "#0f172a" }}>{refill.drug_name}</div>
                        <div style={compactMeta}>
                          Dispensed: {refill.quantity_dispensed || "-"} | Daily: {refill.daily_usage || "-"} | Supply: {refill.days_supply > 0 ? refill.days_supply : "-"}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        {refill.next_refill_date
                          ? new Date(refill.next_refill_date).toLocaleDateString()
                          : "N/A"}
                      </td>
                      <td style={tdStyle}>
                        <StatusPill
                          variant={
                            queueStatus === "Completed"
                              ? "info"
                              : queueStatus === "Overdue"
                              ? "danger"
                              : queueStatus === "Due"
                              ? "warning"
                              : "info"
                          }
                          style={{
                            ...statusPillStyle(queueStatus),
                            padding: "3px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {queueStatus}
                        </StatusPill>
                      </td>
                      <td style={tdStyle}>
                        <span style={notesText} title={refill.notes || ""}>{refill.notes || "-"}</span>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {queueStatus !== "Completed" && (
                          <>
                            <button style={actionBtn} className="fm-action-btn" onClick={() => handleMarkDispensed(refill)}>
                              Mark Dispensed
                            </button>
                            <button style={actionBtn} className="fm-action-btn" onClick={() => handleMarkCompleted(refill.id)}>
                              Complete
                            </button>
                          </>
                        )}
                        <button style={actionBtnDanger} className="fm-action-btn" onClick={() => handleDelete(refill.id)}>
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
