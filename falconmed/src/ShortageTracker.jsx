import { useEffect, useMemo, useState } from "react";
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
      <h1 style={pageTitle}>Shortage Tracker</h1>

      <div style={cardsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Pending Requests</div>
          <div style={statValue}>{totals.pending}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Ordered Requests</div>
          <div style={statValue}>{totals.ordered}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Completed Requests</div>
          <div style={statValue}>{totals.completed}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Total Quantity Requested</div>
          <div style={statValue}>{totals.totalQty}</div>
        </div>
      </div>

      <div style={formCard}>
        <h2 style={sectionTitle}>Add Shortage Request</h2>

        {message && <div style={messageBox}>{message}</div>}

        <form onSubmit={handleAdd} style={formGrid}>
          <div style={drugSearchContainer}>
            <input
              style={input}
              placeholder="Search drug by brand, generic, strength..."
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

          <input
            style={input}
            placeholder="Drug Name"
            value={form.drugName}
            onChange={(e) => handleChange("drugName", e.target.value)}
          />

          <input
            style={input}
            type="number"
            placeholder="Quantity Requested"
            value={form.quantityRequested}
            onChange={(e) => handleChange("quantityRequested", e.target.value)}
          />

          <input
            style={input}
            placeholder="Patient Name"
            value={form.patientName}
            onChange={(e) => handleChange("patientName", e.target.value)}
          />

          <input
            style={input}
            placeholder="Contact Number"
            value={form.contactNumber}
            onChange={(e) => handleChange("contactNumber", e.target.value)}
          />

          <input
            style={input}
            type="date"
            value={form.requestDate}
            onChange={(e) => handleChange("requestDate", e.target.value)}
          />

          <select
            style={input}
            value={form.status}
            onChange={(e) => handleChange("status", e.target.value)}
          >
            <option value="Pending">Pending</option>
            <option value="Ordered">Ordered</option>
            <option value="Completed">Completed</option>
          </select>

          <input
            style={input}
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
          />

          <button type="submit" style={primaryBtn}>
            Add Request
          </button>
        </form>
      </div>

      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Requests</h2>

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
                <th style={th}>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    Loading shortage requests...
                  </td>
                </tr>
              )}

              {items.map((item) => (
                <tr key={item.id}>
                  <td style={td}>{item.drugName}</td>
                  <td style={td}>{item.quantityRequested}</td>
                  <td style={td}>{item.patientName}</td>
                  <td style={td}>{item.contactNumber}</td>
                  <td style={td}>{item.requestDate}</td>
                  <td style={td}>
                    <span style={getStatusStyle(item.status)}>{item.status}</span>
                  </td>
                  <td style={td}>{item.notes || "-"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        style={smallBtn}
                        onClick={() => updateStatus(item.id, "Pending")}
                        type="button"
                      >
                        Pending
                      </button>
                      <button
                        style={smallBtn}
                        onClick={() => updateStatus(item.id, "Ordered")}
                        type="button"
                      >
                        Ordered
                      </button>
                      <button
                        style={smallBtn}
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
                    No shortage requests found.
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

const pageTitle = {
  fontSize: "28px",
  fontWeight: 700,
  marginTop: 0,
  marginBottom: "18px",
  color: "#0f172a",
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
  marginBottom: "16px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "16px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e5eaf1",
};

const statLabel = {
  fontSize: "12px",
  color: "#64748b",
  marginBottom: "8px",
};

const statValue = {
  fontSize: "22px",
  fontWeight: "bold",
  color: "#0f172a",
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e5eaf1",
  marginBottom: "16px",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "12px",
  color: "#0f172a",
  fontSize: "18px",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const messageBox = {
  marginBottom: "10px",
  padding: "9px 11px",
  borderRadius: "10px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: "13px",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "9px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const drugSearchContainer = {
  position: "relative",
  gridColumn: "1 / -1",
};

const drugDropdown = {
  position: "absolute",
  top: "48px",
  left: 0,
  right: 0,
  background: "white",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.1)",
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
  padding: "10px 14px",
  color: "#64748b",
  fontSize: "14px",
  textAlign: "center",
  background: "#f8fafc",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  marginTop: "4px",
};

const primaryBtn = {
  padding: "10px 12px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "9px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "bold",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e5eaf1",
};

const tableWrap = {
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: "13px",
};

const td = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontSize: "13px",
  verticalAlign: "top",
};

const badgeBase = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "bold",
};

const badgePending = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
};

const badgeOrdered = {
  ...badgeBase,
  background: "#dbeafe",
  color: "#1d4ed8",
};

const badgeCompleted = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
};

const smallBtn = {
  padding: "7px 10px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "7px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};