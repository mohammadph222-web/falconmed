import { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import { supabase } from "./lib/supabaseClient";
import {
  getDrugDisplayName,
  getDrugUnitPrice,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMaster";

const EXPIRY_TABLE = "expiry_records";

const mapDbToUi = (row) => ({
  id: row.id,
  drugName: row.drug_name || "",
  batchNo: row.batch_no || "",
  quantity: Number(row.quantity || 0),
  expiryDate: row.expiry_date || "",
  unitPrice: Number(row.unit_price || 0),
  location: row.location || "-",
  notes: row.notes || "",
  status: row.status || "Active",
  value: Number(row.value || 0),
});

export default function ExpiryTracker({ user, profile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [generatingTestData, setGeneratingTestData] = useState(false);

  // Drug search and dropdown state
  const [allDrugs, setAllDrugs] = useState([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState(null);

  const [form, setForm] = useState({
    drugName: "",
    batchNo: "",
    quantity: "",
    expiryDate: "",
    unitPrice: "",
    location: "",
    notes: "",
  });

  const today = new Date();

  const getMonthsLeft = (dateStr) => {
    const expiry = new Date(dateStr);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays / 30;
  };

  const getStatus = (dateStr) => {
    if (!dateStr) return "Active";
    const monthsLeft = getMonthsLeft(dateStr);

    if (monthsLeft < 0) return "Expired";
    if (monthsLeft <= 3) return "High Risk";
    if (monthsLeft <= 6) return "Near Expiry";
    return "OK";
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case "Expired":
        return badgeExpired;
      case "High Risk":
        return badgeHighRisk;
      case "Near Expiry":
        return badgeNear;
      default:
        return badgeOk;
    }
  };
  // Load drugs CSV for dropdown
  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setAllDrugs(rows || []);
        }
      })
      .catch((error) => {
        console.error("Error loading drugs for expiry tracker:", error);
        if (isMounted) {
          setAllDrugs([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filter drugs based on search
  const filteredDrugs = useMemo(
    () => (showDrugDropdown ? searchDrugMaster(allDrugs, drugSearch, 25) : []),
    [allDrugs, drugSearch, showDrugDropdown]
  );

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDrugSelect = (drug) => {
    const displayName = getDrugDisplayName(drug);

    if (!displayName || displayName === "Unknown") {
      console.error("Failed mapping selected drug to form name:", drug);
    }

    const normalizedPrice = getDrugUnitPrice(drug, "public");
    const safePrice = normalizedPrice !== null ? String(normalizedPrice) : "";

    if (drug.public_price && !safePrice) {
      console.error("Failed mapping selected drug price to form unitPrice:", drug);
    }

    setSelectedDrug(drug);
    setForm((prev) => ({
      ...prev,
      drugName: displayName,
      unitPrice: safePrice || prev.unitPrice,
    }));
    setDrugSearch(displayName);
    setShowDrugDropdown(false);
  };

  const buildDrugDisplayName = (drug) => {
    return getDrugDisplayName(drug);
  };

  const formatDateInput = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const randomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const randomBatchNo = () => {
    return `BATCH-${randomInt(10000, 99999)}`;
  };

  const randomExpiryDate = () => {
    const now = new Date();
    const roll = Math.random();
    let offsetDays = 0;

    if (roll < 0.4) {
      offsetDays = randomInt(1, 30);
    } else if (roll < 0.7) {
      offsetDays = randomInt(31, 60);
    } else if (roll < 0.9) {
      offsetDays = randomInt(61, 120);
    } else {
      offsetDays = -randomInt(1, 120);
    }

    const target = new Date(now);
    target.setDate(now.getDate() + offsetDays);
    return formatDateInput(target);
  };

  const handleGenerateTestInventory = async () => {
    if (!supabase) return;

    if (!allDrugs.length) {
      setMessage("Unable to generate test inventory: drug list is not loaded yet.");
      return;
    }

    setGeneratingTestData(true);
    setMessage("");

    try {
      const rows = Array.from({ length: 20 }).map(() => {
        const picked = allDrugs[randomInt(0, allDrugs.length - 1)] || {};
        const pickedName = buildDrugDisplayName(picked);

        return {
          drug_name: pickedName && pickedName !== "Unknown" ? pickedName : "Unknown",
          batch_no: randomBatchNo(),
          expiry_date: randomExpiryDate(),
          quantity: randomInt(5, 120),
          notes: "test_stock",
        };
      });

      const { error } = await supabase.from(EXPIRY_TABLE).insert(rows);

      if (error) {
        console.error("Failed to generate test inventory:", error.message);
        setMessage("Failed to generate test inventory.");
        return;
      }

      const { data: refreshed, error: refreshError } = await supabase
        .from(EXPIRY_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (refreshError) {
        console.error("Failed to refresh after test inventory generation:", refreshError.message);
      } else {
        const mapped = (refreshed || []).map(mapDbToUi);
        setItems(mapped);
        localStorage.setItem(
          "falconmed_expiries",
          JSON.stringify(
            mapped.map((item) => ({
              id: item.id,
              drug_name: item.drugName,
              batch_no: item.batchNo,
              quantity: item.quantity,
              expiry_date: item.expiryDate,
              notes: item.notes || "",
              status: getStatus(item.expiryDate),
              created_at: item.expiryDate,
            }))
          )
        );
      }

      setMessage("Test inventory generated successfully.");
    } catch (error) {
      console.error("Test inventory generation error:", error?.message || "Unknown error");
      setMessage("Failed to generate test inventory.");
    } finally {
      setGeneratingTestData(false);
    }
  };

  // Load expiry records on mount
  useEffect(() => {
    const loadItems = async () => {
      setMessage("");

      try {
        const { data, error } = await supabase
          .from(EXPIRY_TABLE)
          .select("*")
          .order("created_at", { ascending: false });

        if (error) {
          setItems([]);
          setMessage("Failed to load expiry records.");
          console.error("Failed to load expiry records:", error.message);
          localStorage.setItem("falconmed_expiries", JSON.stringify([]));
          return;
        }

        const mapped = (data || []).map(mapDbToUi);
        setItems(mapped);

        localStorage.setItem(
          "falconmed_expiries",
          JSON.stringify(
            mapped.map((item) => ({
              id: item.id,
              drug_name: item.drugName,
              batch_no: item.batchNo,
              quantity: item.quantity,
              expiry_date: item.expiryDate,
              notes: item.notes || "",
              status: getStatus(item.expiryDate),
              created_at: item.expiryDate,
            }))
          )
        );
      } catch (err) {
        setItems([]);
        setMessage("Failed to load expiry records.");
        console.error("Expiry load error:", err?.message || "Unknown error");
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
      !form.batchNo ||
      !form.quantity ||
      !form.expiryDate
    ) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from(EXPIRY_TABLE)
        .insert({
          drug_name: form.drugName,
          batch_no: form.batchNo,
          quantity: Number(form.quantity),
          unit_price: Number(form.unitPrice || 0),
          location: form.location || "-",
          expiry_date: form.expiryDate,
          notes: form.notes,
        })
        .select("*")
        .single();

      if (error) {
        setMessage("Failed to save expiry item.");
        console.error("Failed to save expiry item:", error.message);
        return;
      }

      const newItem = mapDbToUi(data);
      const refreshItems = async () => {
        try {
          const { data: refreshed, error: refreshError } = await supabase
            .from(EXPIRY_TABLE)
            .select("*")
            .order("created_at", { ascending: false });

          if (refreshError) {
            console.error("Failed to refresh expiry records after insert:", refreshError.message);
            setItems((prev) => [newItem, ...prev]);
            return;
          }

          const mapped = (refreshed || []).map(mapDbToUi);
          setItems(mapped);
          localStorage.setItem(
            "falconmed_expiries",
            JSON.stringify(
              mapped.map((item) => ({
                id: item.id,
                drug_name: item.drugName,
                batch_no: item.batchNo,
                quantity: item.quantity,
                expiry_date: item.expiryDate,
                notes: item.notes || "",
                status: getStatus(item.expiryDate),
                created_at: item.expiryDate,
              }))
            )
          );
        } catch (refreshCatchErr) {
          console.error(
            "Failed to refresh expiry records after insert:",
            refreshCatchErr?.message || "Unknown error"
          );
          setItems((prev) => [newItem, ...prev]);
        }
      };

      await refreshItems();

      try {
        const { error: activityError } = await supabase.from("activity_log").insert({
          module: "Expiry",
          action: "Added",
          description: `Expiry item added: ${form.drugName}`,
        });

        if (activityError) {
          console.error("Failed to log expiry activity:", activityError.message);
        }
      } catch (activityErr) {
        console.error("Expiry activity log error:", activityErr?.message || "Unknown error");
      }

      setMessage("Item added successfully.");
    } catch (err) {
      setMessage("Failed to save expiry item.");
      console.error("Expiry save error:", err?.message || "Unknown error");
      return;
    }

    setForm({
      drugName: "",
      batchNo: "",
      quantity: "",
      expiryDate: "",
      unitPrice: "",
      notes: "",
      location: "",
    });
    setSelectedDrug(null);
    setDrugSearch("");
    setShowDrugDropdown(false);
  };

  const totals = useMemo(() => {
    let totalValue = 0;
    let nearExpiryValue = 0;
    let highRiskValue = 0;
    let expiredValue = 0;

    items.forEach((item) => {
      const value = Number(item.quantity) * Number(item.unitPrice);
      const status = getStatus(item.expiryDate);

      totalValue += value;
      if (status === "Near Expiry") nearExpiryValue += value;
      if (status === "High Risk") highRiskValue += value;
      if (status === "Expired") expiredValue += value;
    });

    return {
      totalValue,
      nearExpiryValue,
      highRiskValue,
      expiredValue,
    };
  }, [items]);

  const expiryInsight = useMemo(() => {
    if (loading || items.length === 0) return null;

    const highRiskItems = items.filter((item) => getStatus(item.expiryDate) === "High Risk");
    const nearExpiryItems = items.filter((item) => getStatus(item.expiryDate) === "Near Expiry");

    const atRiskCount = highRiskItems.length + nearExpiryItems.length;
    if (atRiskCount === 0) return null;

    const atRiskValue = [...highRiskItems, ...nearExpiryItems].reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
      0
    );

    return {
      icon: "⏳",
      tone: highRiskItems.length > 0 ? "warning" : "info",
      title: "Smart Insight: Expiry Pressure",
      message: `${atRiskCount} item${atRiskCount === 1 ? "" : "s"} are approaching expiry (${highRiskItems.length} high risk). Estimated at-risk value: AED ${Math.round(
        atRiskValue
      ).toLocaleString()}.`,
    };
  }, [items, loading]);

  return (
    <div>
      {/* Page header */}
      <div style={pageHeaderRow}>
        <div>
          <h1 style={pageTitle}>Expiry Tracker</h1>
          <p style={pageSub}>Monitor stock expiry risk and near-expiry inventory value.</p>
        </div>
        <button
          type="button"
          style={testBtn}
          onClick={handleGenerateTestInventory}
          disabled={generatingTestData || loading}
          title="TEST ONLY"
        >
          {generatingTestData ? "Generating…" : "Generate Test Inventory"}
        </button>
      </div>

      {/* KPI strip */}
      <div style={cardsGrid}>
        <div style={{ ...statCard, borderTop: "4px solid #3b82f6" }}>
          <div style={statLabel}>Total Stock Value</div>
          <div style={statValue}>{totals.totalValue.toLocaleString()} AED</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #f59e0b" }}>
          <div style={statLabel}>Near Expiry Value</div>
          <div style={statValue}>{totals.nearExpiryValue.toLocaleString()} AED</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #ef4444" }}>
          <div style={statLabel}>High Risk Value</div>
          <div style={statValue}>{totals.highRiskValue.toLocaleString()} AED</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #94a3b8" }}>
          <div style={statLabel}>Expired Value</div>
          <div style={statValue}>{totals.expiredValue.toLocaleString()} AED</div>
        </div>
      </div>

      {/* Add form */}
      <div style={formCard}>
        <h2 style={sectionTitle}>Add Expiry Item</h2>

        {message && (
          <div
            style={
              message.toLowerCase().includes("success") ||
              message.toLowerCase().includes("generated")
                ? messageBoxSuccess
                : message.toLowerCase().includes("fail") ||
                    message.toLowerCase().includes("error") ||
                    message.toLowerCase().includes("unable")
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
                setSelectedDrug(null);
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
              style={inputReadOnly}
              placeholder="Auto-filled from search above"
              value={form.drugName}
              onChange={(e) => handleChange("drugName", e.target.value)}
              readOnly
            />
          </div>

          <div>
            <div style={fieldLabel}>Batch No.</div>
            <input
              style={input}
              placeholder="e.g. BATCH-10001"
              value={form.batchNo}
              onChange={(e) => handleChange("batchNo", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Quantity</div>
            <input
              style={input}
              type="number"
              placeholder="e.g. 50"
              value={form.quantity}
              onChange={(e) => handleChange("quantity", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Expiry Date</div>
            <input
              style={input}
              type="date"
              value={form.expiryDate}
              onChange={(e) => handleChange("expiryDate", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Unit Price (AED)</div>
            <input
              style={input}
              type="number"
              placeholder="e.g. 12.50"
              value={form.unitPrice}
              onChange={(e) => handleChange("unitPrice", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Location</div>
            <input
              style={input}
              placeholder="e.g. Shelf A3"
              value={form.location}
              onChange={(e) => handleChange("location", e.target.value)}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={fieldLabel}>Notes</div>
            <textarea
              style={textarea}
              placeholder="Storage conditions, supplier info…"
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" style={primaryBtn}>
              Add Item
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Items</h2>

        {expiryInsight && (
          <InsightCard
            icon={expiryInsight.icon}
            tone={expiryInsight.tone}
            title={expiryInsight.title}
            message={expiryInsight.message}
            style={{ marginTop: -2 }}
          />
        )}

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Drug</th>
                <th style={th}>Batch</th>
                <th style={th}>Qty</th>
                <th style={th}>Unit Price</th>
                <th style={th}>Value</th>
                <th style={th}>Expiry Date</th>
                <th style={th}>Location</th>
                <th style={th}>Notes</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="9" style={emptyCell}>
                    Loading expiry records…
                  </td>
                </tr>
              )}

              {items.map((item, idx) => {
                const status = item.expiryDate ? getStatus(item.expiryDate) : item.status || "Active";
                const value = Number(item.quantity) * Number(item.unitPrice);

                return (
                  <tr
                    key={item.id}
                    style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                  >
                    <td style={{ ...td, fontWeight: 700 }}>{item.drugName}</td>
                    <td style={{ ...td, color: "#64748b" }}>{item.batchNo}</td>
                    <td style={td}>{item.quantity}</td>
                    <td style={td}>{item.unitPrice} AED</td>
                    <td style={{ ...td, fontWeight: 600 }}>{value.toLocaleString()} AED</td>
                    <td style={{ ...td, color: "#64748b" }}>{item.expiryDate}</td>
                    <td style={{ ...td, color: "#64748b" }}>{item.location}</td>
                    <td style={{ ...td, color: "#64748b", maxWidth: "160px" }}>{item.notes}</td>
                    <td style={td}>
                      <span style={getStatusStyle(status)}>{status}</span>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="9" style={emptyCell}>
                    No expiry items found. Use the form above to add your first item.
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

const testBtn = {
  padding: "9px 15px",
  background: "#f59e0b",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 700,
  flexShrink: 0,
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
  fontSize: "26px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
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

const inputReadOnly = {
  ...input,
  background: "#f8fafc",
  color: "#64748b",
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

const textarea = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "10px",
  border: "1.5px solid #e2e8f0",
  boxSizing: "border-box",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  resize: "vertical",
  minHeight: "72px",
  color: "#0f172a",
  background: "#fff",
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

const badgeOk = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
  border: "1px solid #bbf7d0",
};

const badgeNear = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const badgeHighRisk = {
  ...badgeBase,
  background: "#fee2e2",
  color: "#b91c1c",
  border: "1px solid #fecaca",
};

const badgeExpired = {
  ...badgeBase,
  background: "#f1f5f9",
  color: "#475569",
  border: "1px solid #cbd5e1",
};

const emptyCell = {
  padding: "40px 20px",
  textAlign: "center",
  color: "#94a3b8",
  fontSize: "14px",
  background: "#f8fafc",
};