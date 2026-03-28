import { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMaster";

const SHORTAGE_TABLE = "shortage_requests";

const mapDbToUi = (row) => ({
  id: row.id,
  drugName: row.drug_name || "",
  quantityRequested: Number(row.quantity_requested || 0),
  patientName: row.patient_name || "",
  contactNumber: row.contact_number || "",
  requestDate: row.request_date || "",
  status: row.status || "Pending",
  notes: row.notes || "",
});

const toReportRecord = (item) => ({
  id: item.id,
  drug_name: item.drugName,
  quantity: item.quantityRequested,
  requested_at: item.requestDate,
  status: item.status,
  created_at: item.requestDate,
});

export default function ShortageTracker({ user, profile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [allDrugs, setAllDrugs] = useState([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);

  const [form, setForm] = useState({
    drugName: "",
    quantityRequested: "",
    patientName: "",
    contactNumber: "",
    requestDate: "",
    status: "Pending",
    notes: "",
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setAllDrugs(rows || []);
        }
      })
      .catch((error) => {
        console.error("Error loading drugs for shortage tracker:", error);
        if (isMounted) {
          setAllDrugs([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredDrugs = useMemo(
    () => (showDrugDropdown ? searchDrugMaster(allDrugs, drugSearch, 25) : []),
    [allDrugs, drugSearch, showDrugDropdown]
  );

  const handleDrugSelect = (drug) => {
    const displayName = getDrugDisplayName(drug);

    setForm((prev) => ({ ...prev, drugName: displayName }));
    setDrugSearch(displayName);
    setShowDrugDropdown(false);
  };

  useEffect(() => {
    const loadItems = async () => {
      setLoading(true);
      setMessage("");

      try {
        const { data, error } = await supabase
          .from(SHORTAGE_TABLE)
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          setItems([]);
          setMessage("Failed to load shortage records.");
          console.error("Failed to load shortage records:", error.message);
          localStorage.setItem("falconmed_shortages", JSON.stringify([]));
          return;
        }

        const mapped = (data || []).map(mapDbToUi);
        setItems(mapped);
        localStorage.setItem(
          "falconmed_shortages",
          JSON.stringify(mapped.map(toReportRecord))
        );
      } catch (err) {
        setItems([]);
        setMessage("Failed to load shortage records.");
        console.error("Shortage load error:", err?.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void loadItems();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setMessage("");

    if (
      !form.drugName ||
      !form.quantityRequested ||
      !form.patientName ||
      !form.contactNumber ||
      !form.requestDate
    ) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from(SHORTAGE_TABLE)
        .insert({
          drug_name: form.drugName,
          quantity_requested: Number(form.quantityRequested),
          patient_name: form.patientName,
          contact_number: form.contactNumber,
          request_date: form.requestDate,
          status: form.status,
          notes: form.notes,
        })
        .select("*")
        .single();

      if (error) {
        setMessage("Failed to save shortage request.");
        console.error("Failed to save shortage request:", error.message);
        return;
      }

      const newItem = mapDbToUi(data);

      try {
        const { data: refreshed, error: refreshError } = await supabase
          .from(SHORTAGE_TABLE)
          .select("*")
          .order("created_at", { ascending: false });

        if (refreshError) {
          console.error("Failed to refresh shortage requests after insert:", refreshError.message);
          setItems((prev) => {
            const next = [newItem, ...prev];
            localStorage.setItem(
              "falconmed_shortages",
              JSON.stringify(next.map(toReportRecord))
            );
            return next;
          });
        } else {
          const mapped = (refreshed || []).map(mapDbToUi);
          setItems(mapped);
          localStorage.setItem(
            "falconmed_shortages",
            JSON.stringify(mapped.map(toReportRecord))
          );
        }
      } catch (refreshErr) {
        console.error(
          "Failed to refresh shortage requests after insert:",
          refreshErr?.message || "Unknown error"
        );
        setItems((prev) => {
          const next = [newItem, ...prev];
          localStorage.setItem(
            "falconmed_shortages",
            JSON.stringify(next.map(toReportRecord))
          );
          return next;
        });
      }

      try {
        const { error: activityError } = await supabase.from("activity_log").insert({
          module: "Shortage",
          action: "Created",
          description: `Shortage request created: ${form.drugName} (${form.quantityRequested})`,
        });

        if (activityError) {
          console.error("Failed to log shortage activity:", activityError.message);
        }
      } catch (activityErr) {
        console.error("Shortage activity log error:", activityErr?.message || "Unknown error");
      }
    } catch (err) {
      setMessage("Failed to save shortage request.");
      console.error("Shortage save error:", err?.message || "Unknown error");
      return;
    }

    setForm({
      drugName: "",
      quantityRequested: "",
      patientName: "",
      contactNumber: "",
      requestDate: "",
      status: "Pending",
      notes: "",
    });
  };

  const updateStatus = async (id, newStatus) => {
    setMessage("");

    try {
      const { error } = await supabase
        .from(SHORTAGE_TABLE)
        .update({ status: newStatus })
        .eq("id", id);

      if (error) {
        setMessage("Failed to update status.");
        console.error("Failed to update shortage status:", error.message);
        return;
      }

      setItems((prev) => {
        const next = prev.map((item) =>
          item.id === id ? { ...item, status: newStatus } : item
        );
        localStorage.setItem(
          "falconmed_shortages",
          JSON.stringify(next.map(toReportRecord))
        );
        return next;
      });
    } catch (err) {
      setMessage("Failed to update status.");
      console.error("Shortage status update error:", err?.message || "Unknown error");
    }
  };

  const totals = useMemo(() => {
    const pending = items.filter((x) => x.status === "Pending").length;
    const ordered = items.filter((x) => x.status === "Ordered").length;
    const completed = items.filter((x) => x.status === "Completed").length;
    const totalQty = items.reduce(
      (sum, x) => sum + Number(x.quantityRequested || 0),
      0
    );

    return { pending, ordered, completed, totalQty };
  }, [items]);

  const shortageInsight = useMemo(() => {
    if (loading || items.length === 0) return null;

    const unresolved = items.filter((item) => item.status === "Pending" || item.status === "Ordered");
    if (unresolved.length === 0) return null;

    const byDrug = new Map();
    unresolved.forEach((item) => {
      const key = String(item.drugName || "").trim().toLowerCase();
      if (!key) return;
      byDrug.set(key, (byDrug.get(key) || 0) + 1);
    });

    let strongestDrug = "";
    let strongestCount = 0;
    byDrug.forEach((count, key) => {
      if (count > strongestCount) {
        strongestCount = count;
        strongestDrug = key;
      }
    });

    if (strongestCount < 2) return null;

    const titleCaseDrug = strongestDrug
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

    return {
      icon: "⚠",
      tone: "warning",
      title: "Smart Insight: Cross-Pharmacy Signal",
      message: `${titleCaseDrug || "A shared item"} appears in ${strongestCount} unresolved requests, suggesting multi-site shortage pressure.`,
    };
  }, [items, loading]);

  const getStatusStyle = (status) => {
    switch (status) {
      case "Pending":
        return badgePending;
      case "Ordered":
        return badgeOrdered;
      case "Completed":
        return badgeCompleted;
      default:
        return badgePending;
    }
  };

  return (
    <div>
      {/* Page header */}
      <div style={pageHeaderRow}>
        <div>
          <h1 style={pageTitle}>Shortage Tracker</h1>
          <p style={pageSub}>Log and manage drug shortage requests across all sites.</p>
        </div>
      </div>

      {/* KPI strip */}
      <div style={cardsGrid}>
        <div style={{ ...statCard, borderTop: "4px solid #f59e0b" }}>
          <div style={statLabel}>Pending</div>
          <div style={statValue}>{totals.pending}</div>
          <div style={statHint}>Awaiting action</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #3b82f6" }}>
          <div style={statLabel}>Ordered</div>
          <div style={statValue}>{totals.ordered}</div>
          <div style={statHint}>In procurement</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #10b981" }}>
          <div style={statLabel}>Completed</div>
          <div style={statValue}>{totals.completed}</div>
          <div style={statHint}>Fulfilled requests</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #8b5cf6" }}>
          <div style={statLabel}>Total Qty Requested</div>
          <div style={statValue}>{totals.totalQty.toLocaleString()}</div>
          <div style={statHint}>Units across all requests</div>
        </div>
      </div>

      {/* Add form */}
      <div style={formCard}>
        <h2 style={sectionTitle}>Add Shortage Request</h2>

        {message && (
          <div
            style={
              message.toLowerCase().includes("success")
                ? messageBoxSuccess
                : message.toLowerCase().includes("fail") ||
                    message.toLowerCase().includes("error")
                  ? messageBoxError
                  : messageBox
            }
          >
            {message}
          </div>
        )}

        <form onSubmit={handleAdd} style={formGrid}>
          <div style={drugSearchContainer}>
            <div style={fieldLabel}>Search Drug</div>
            <input
              style={input}
              placeholder="Search by brand, generic, strength…"
              value={drugSearch}
              onChange={(e) => {
                setDrugSearch(e.target.value);
                handleChange("drugName", e.target.value);
              }}
              onFocus={() => setShowDrugDropdown(true)}
            />
            {showDrugDropdown && filteredDrugs.length > 0 && (
              <div style={drugDropdown}>
                {filteredDrugs.map((drug, idx) => (
                  <div
                    key={idx}
                    style={drugOption}
                    onClick={() => handleDrugSelect(drug)}
                  >
                    {drug.brand_name ? `${drug.brand_name}` : drug.generic_name}
                    {drug.strength && ` (${drug.strength})`}
                  </div>
                ))}
              </div>
            )}
            {drugSearch && filteredDrugs.length === 0 && showDrugDropdown && (
              <div style={drugDropdownEmpty}>No matching drugs found</div>
            )}
          </div>

          <div>
            <div style={fieldLabel}>Drug Name</div>
            <input
              style={input}
              placeholder="Drug name"
              value={form.drugName}
              onChange={(e) => handleChange("drugName", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Quantity Requested</div>
            <input
              style={input}
              type="number"
              placeholder="e.g. 20"
              value={form.quantityRequested}
              onChange={(e) => handleChange("quantityRequested", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Patient Name</div>
            <input
              style={input}
              placeholder="Patient name"
              value={form.patientName}
              onChange={(e) => handleChange("patientName", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Contact Number</div>
            <input
              style={input}
              placeholder="e.g. 050 000 0000"
              value={form.contactNumber}
              onChange={(e) => handleChange("contactNumber", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Request Date</div>
            <input
              style={input}
              type="date"
              value={form.requestDate}
              onChange={(e) => handleChange("requestDate", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Status</div>
            <select
              style={input}
              value={form.status}
              onChange={(e) => handleChange("status", e.target.value)}
            >
              <option value="Pending">Pending</option>
              <option value="Ordered">Ordered</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div>
            <div style={fieldLabel}>Notes</div>
            <input
              style={input}
              placeholder="Optional notes"
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" style={primaryBtn}>
              Add Request
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Requests</h2>

        {shortageInsight && (
          <InsightCard
            icon={shortageInsight.icon}
            tone={shortageInsight.tone}
            title={shortageInsight.title}
            message={shortageInsight.message}
            style={{ marginTop: -2 }}
          />
        )}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Drug</th>
                <th style={th}>Qty</th>
                <th style={th}>Patient</th>
                <th style={th}>Contact</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={th}>Notes</th>
                <th style={th}>Update Status</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    Loading shortage requests…
                  </td>
                </tr>
              )}

              {items.map((item, idx) => (
                <tr
                  key={item.id}
                  style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                >
                  <td style={{ ...td, fontWeight: 700 }}>{item.drugName}</td>
                  <td style={td}>{item.quantityRequested}</td>
                  <td style={{ ...td, color: "#64748b" }}>{item.patientName}</td>
                  <td style={{ ...td, color: "#64748b" }}>{item.contactNumber}</td>
                  <td style={{ ...td, color: "#64748b" }}>{item.requestDate}</td>
                  <td style={td}>
                    <span style={getStatusStyle(item.status)}>{item.status}</span>
                  </td>
                  <td style={{ ...td, color: "#64748b" }}>{item.notes || "-"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        style={smallBtnPending}
                        onClick={() => updateStatus(item.id, "Pending")}
                        type="button"
                      >
                        Pending
                      </button>
                      <button
                        style={smallBtnOrdered}
                        onClick={() => updateStatus(item.id, "Ordered")}
                        type="button"
                      >
                        Ordered
                      </button>
                      <button
                        style={smallBtnCompleted}
                        onClick={() => updateStatus(item.id, "Completed")}
                        type="button"
                      >
                        Completed
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    No shortage requests found. Use the form above to log your first request.
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

const pageHeaderRow = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "24px",
  paddingBottom: "20px",
  borderBottom: "1px solid #f1f5f9",
  flexWrap: "wrap",
};

const pageTitle = {
  fontSize: "30px",
  fontWeight: 800,
  margin: 0,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.2,
};

const pageSub = {
  margin: "6px 0 0",
  fontSize: "14px",
  color: "#64748b",
  lineHeight: 1.6,
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "16px",
  marginBottom: "24px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px 18px 16px",
  boxShadow: "0 2px 10px rgba(15,23,42,0.05)",
  border: "1px solid #e8edf5",
  textAlign: "center",
};

const statLabel = {
  fontSize: "10px",
  color: "#94a3b8",
  marginBottom: "10px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const statValue = {
  fontSize: "34px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
};

const statHint = {
  marginTop: "8px",
  fontSize: "11px",
  color: "#94a3b8",
  lineHeight: 1.4,
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px 26px",
  boxShadow: "0 2px 10px rgba(15,23,42,0.05)",
  border: "1px solid #e8edf5",
  marginBottom: "22px",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  color: "#0f172a",
  fontSize: "16px",
  fontWeight: 800,
  letterSpacing: "-0.01em",
  paddingBottom: "12px",
  borderBottom: "1px solid #f1f5f9",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "14px",
};

const fieldLabel = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#374151",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  marginBottom: "6px",
};

const messageBox = {
  marginBottom: "14px",
  padding: "11px 14px",
  borderRadius: "10px",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderLeft: "4px solid #3b82f6",
  color: "#1e3a5f",
  fontSize: "13px",
  fontWeight: 600,
};

const messageBoxSuccess = {
  ...messageBox,
  background: "#dcfce7",
  border: "1px solid #bbf7d0",
  borderLeft: "4px solid #22c55e",
  color: "#166534",
};

const messageBoxError = {
  ...messageBox,
  background: "#fee2e2",
  border: "1px solid #fecaca",
  borderLeft: "4px solid #ef4444",
  color: "#991b1b",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "10px",
  border: "1.5px solid #e2e8f0",
  boxSizing: "border-box",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  color: "#0f172a",
  background: "#fff",
};

const drugSearchContainer = {
  position: "relative",
  gridColumn: "1 / -1",
};

const drugDropdown = {
  position: "absolute",
  top: "calc(100% + 6px)",
  left: 0,
  right: 0,
  background: "white",
  border: "1.5px solid #e2e8f0",
  borderRadius: "12px",
  boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
  zIndex: 1000,
  maxHeight: "250px",
  overflowY: "auto",
};

const drugOption = {
  padding: "10px 14px",
  cursor: "pointer",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "14px",
  color: "#0f172a",
};

const drugDropdownEmpty = {
  padding: "11px 16px",
  color: "#64748b",
  fontSize: "14px",
  textAlign: "center",
  background: "#f8fafc",
  border: "1.5px solid #e2e8f0",
  borderRadius: "12px",
  marginTop: "4px",
};

const primaryBtn = {
  padding: "10px 22px",
  background: "#1e40af",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.01em",
  boxShadow: "0 2px 10px rgba(30,64,175,0.25)",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px 26px",
  boxShadow: "0 2px 10px rgba(15,23,42,0.05)",
  border: "1px solid #e8edf5",
};

const tableWrap = {
  overflowX: "auto",
  borderRadius: "10px",
  border: "1px solid #e8edf5",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
};

const th = {
  textAlign: "left",
  padding: "11px 14px",
  background: "#f8fafc",
  borderBottom: "1px solid #e8edf5",
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  position: "sticky",
  top: 0,
  whiteSpace: "nowrap",
};

const td = {
  padding: "11px 14px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontSize: "13px",
  verticalAlign: "middle",
};

const badgeBase = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
};

const badgePending = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const badgeOrdered = {
  ...badgeBase,
  background: "#dbeafe",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
};

const badgeCompleted = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #bbf7d0",
};

const smallBtnBase = {
  padding: "5px 10px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.02em",
};

const smallBtnPending = {
  ...smallBtnBase,
  background: "#fef3c7",
  color: "#92400e",
};

const smallBtnOrdered = {
  ...smallBtnBase,
  background: "#dbeafe",
  color: "#1d4ed8",
};

const smallBtnCompleted = {
  ...smallBtnBase,
  background: "#dcfce7",
  color: "#166534",
};

const emptyCell = {
  padding: "40px 20px",
  textAlign: "center",
  color: "#94a3b8",
  fontSize: "14px",
  background: "#f8fafc",
};