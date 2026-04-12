import { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import { supabase } from "./lib/supabaseClient";
import {
  getDrugDisplayName,
  getDrugUnitPrice,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMasterLoader";
import { loadPharmaciesWithFallback } from "./utils/pharmacyData";
import { ActionButton, MetricCard, PageHeader, StatusPill } from "./ui";

const EXPIRY_TABLE = "pharmacy_inventory";

const mapDbToUi = (row) => ({
  id: row.id,
  pharmacyId: String(row.pharmacy_id ?? ""),
  drugName: row.drug_name || row.drug || "",
  batchNo: row.batch_no || row.batch || "",
  quantity: Number(row.quantity || 0),
  expiryDate: row.expiry_date || "",
  // unit_cost in pharmacy_inventory maps to unitPrice for display compatibility
  unitPrice: Number(row.unit_cost || 0),
  status: "Active", // derived from expiryDate in getStatus()
  value: 0,          // computed at render time
});

function buildUniquePharmacies(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const id = String(row?.id || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      name: String(row?.name || "").trim(),
      location: String(row?.location || "").trim(),
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

export default function ExpiryTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [generatingTestData, setGeneratingTestData] = useState(false);

  // Pharmacy selector (needed for inserts into pharmacy_inventory)
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");

  const pharmacyMap = useMemo(() => {
    const map = new Map();
    (pharmacies || []).forEach((row) => {
      const id = String(row?.id || "").trim();
      if (!id || map.has(id)) return;
      map.set(id, {
        id,
        name: String(row?.name || "").trim(),
        location: String(row?.location || "").trim(),
      });
    });
    return map;
  }, [pharmacies]);

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
  // Load pharmacies for the Add-Item pharmacy selector
  useEffect(() => {
    loadPharmaciesWithFallback().then(({ data }) => {
      const uniquePharmacies = buildUniquePharmacies(data || []);
      setPharmacies(uniquePharmacies);
      if (uniquePharmacies.length > 0 && !selectedPharmacyId) {
        setSelectedPharmacyId(String(uniquePharmacies[0].id));
      }
    });
  }, []);

  // Load drugs CSV for dropdown
  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setAllDrugs(rows || []);
        }
      })
      .catch(() => {
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

    const normalizedPrice = getDrugUnitPrice(drug, "public");
    const safePrice = normalizedPrice !== null ? String(normalizedPrice) : "";

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
      const nowIso = new Date().toISOString();
      const rows = Array.from({ length: 20 }).map(() => {
        const picked = allDrugs[randomInt(0, allDrugs.length - 1)] || {};
        const pickedName = buildDrugDisplayName(picked);

        return {
          pharmacy_id: selectedPharmacyId || null,
          drug_name: pickedName && pickedName !== "Unknown" ? pickedName : "Unknown",
          batch_no: randomBatchNo(),
          expiry_date: randomExpiryDate(),
          quantity: randomInt(5, 120),
          unit_cost: 0,
          created_at: nowIso,
          created_by: "falconmed.demo@preview",
        };
      });

      let insertResult = await supabase.from(EXPIRY_TABLE).insert(rows);

      if (insertResult.error) {
        const msg = String(insertResult.error.message || "").toLowerCase();
        const createdByMissing = msg.includes("created_by") && msg.includes("column");

        if (createdByMissing) {
          const fallbackRows = rows.map(({ created_by, ...rest }) => rest);
          insertResult = await supabase.from(EXPIRY_TABLE).insert(fallbackRows);
        }
      }

      const { error } = insertResult;

      if (error) {
        setMessage("Failed to generate test inventory.");
        return;
      }

      const { data: refreshed, error: refreshError } = await supabase
        .from(EXPIRY_TABLE)
        .select("*")
        .not("expiry_date", "is", null)
        .order("expiry_date", { ascending: true });

      if (!refreshError) {
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
          .not("expiry_date", "is", null)
          .order("expiry_date", { ascending: true });

        if (error) {
          setItems([]);
          setMessage("Failed to load expiry records.");
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
      !form.expiryDate ||
      !selectedPharmacyId
    ) {
      setMessage("Please fill in all required fields and select a pharmacy.");
      return;
    }

    try {
      const payload = {
        pharmacy_id: selectedPharmacyId,
        drug_name: form.drugName,
        batch_no: form.batchNo,
        quantity: Number(form.quantity),
        unit_cost: Number(form.unitPrice || 0),
        expiry_date: form.expiryDate,
        created_at: new Date().toISOString(),
        created_by: "falconmed.demo@preview",
      };

      let insertResult = await supabase
        .from(EXPIRY_TABLE)
        .insert(payload)
        .select("*")
        .single();

      if (insertResult.error) {
        const msg = String(insertResult.error.message || "").toLowerCase();
        const createdByMissing = msg.includes("created_by") && msg.includes("column");

        if (createdByMissing) {
          const { created_by, ...fallbackPayload } = payload;
          insertResult = await supabase
            .from(EXPIRY_TABLE)
            .insert(fallbackPayload)
            .select("*")
            .single();
        }
      }

      const { data, error } = insertResult;

      if (error) {
        setMessage("Failed to save expiry item.");
        return;
      }

      const newItem = mapDbToUi(data);
      const refreshItems = async () => {
        try {
          const { data: refreshed, error: refreshError } = await supabase
            .from(EXPIRY_TABLE)
            .select("*")
            .not("expiry_date", "is", null)
            .order("expiry_date", { ascending: true });

          if (refreshError) {
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
      } catch (activityErr) {
        // Ignore activity logging failures.
      }

      setMessage("Item added successfully.");
    } catch (err) {
      setMessage("Failed to save expiry item.");
      return;
    }

    setForm({
      drugName: "",
      batchNo: "",
      quantity: "",
      expiryDate: "",
      unitPrice: "",
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
      <PageHeader
        title="Expiry Tracker"
        subtitle="Monitor stock expiry risk and near-expiry inventory value."
        style={pageHeaderRow}
        actions={
          <ActionButton
            type="button"
            variant="secondary"
            className="fm-action-btn"
            style={testBtn}
            onClick={handleGenerateTestInventory}
            disabled={generatingTestData || loading}
            title="TEST ONLY"
          >
            {generatingTestData ? "Generating..." : "Generate Test Inventory"}
          </ActionButton>
        }
      />

      {/* KPI strip */}
      <div style={cardsGrid}>
        <MetricCard
          className="ui-hover-lift"
          accent="info"
          icon="AED"
          label="Total Stock Value"
          value={`${totals.totalValue.toLocaleString()} AED`}
        />
        <MetricCard
          className="ui-hover-lift"
          accent="warning"
          icon="NEAR"
          label="Near Expiry Value"
          value={`${totals.nearExpiryValue.toLocaleString()} AED`}
        />
        <MetricCard
          className="ui-hover-lift"
          accent="danger"
          icon="RISK"
          label="High Risk Value"
          value={`${totals.highRiskValue.toLocaleString()} AED`}
        />
        <MetricCard
          className="ui-hover-lift"
          accent="neutral"
          icon="EXP"
          label="Expired Value"
          value={`${totals.expiredValue.toLocaleString()} AED`}
        />
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
            <div style={fieldLabel}>Unit Cost (AED)</div>
            <input
              style={input}
              type="number"
              placeholder="e.g. 12.50"
              value={form.unitPrice}
              onChange={(e) => handleChange("unitPrice", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Pharmacy *</div>
            <select
              style={input}
              value={selectedPharmacyId}
              onChange={(e) => setSelectedPharmacyId(e.target.value)}
              required
            >
              <option value="">-- Select Pharmacy --</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" style={primaryBtn} className="fm-action-btn">
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
                <th style={th}>Unit Cost</th>
                <th style={th}>Value</th>
                <th style={th}>Expiry Date</th>
                <th style={th}>Pharmacy</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
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
                    className="fm-table-row"
                    style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                  >
                    <td style={{ ...td, fontWeight: 700 }}>{item.drugName}</td>
                    <td style={{ ...td, color: "#64748b" }}>{item.batchNo}</td>
                    <td style={td}>{item.quantity}</td>
                    <td style={td}>{item.unitPrice} AED</td>
                    <td style={{ ...td, fontWeight: 600 }}>{value.toLocaleString()} AED</td>
                    <td style={{ ...td, color: "#64748b" }}>{item.expiryDate}</td>
                    <td style={{ ...td, color: "#64748b" }}>
                      {pharmacyMap.get(String(item.pharmacyId || "").trim())?.name || "Unknown Pharmacy"}
                    </td>
                    <td style={td}>
                      <StatusPill
                        variant={
                          status === "OK"
                            ? "success"
                            : status === "Near Expiry"
                            ? "warning"
                            : status === "High Risk"
                            ? "danger"
                            : "neutral"
                        }
                        style={getStatusStyle(status)}
                      >
                        {status}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
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
  fontSize: "32px",
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
  marginBottom: "26px",
  paddingBottom: "22px",
  borderBottom: "1px solid #e7eef9",
  flexWrap: "wrap",
};

const testBtn = {
  padding: "9px 15px",
  background: "linear-gradient(135deg, #d97706 0%, #f59e0b 100%)",
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
  borderRadius: "14px",
  padding: "20px 18px 16px",
  boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
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
  borderRadius: "14px",
  padding: "24px 26px",
  boxShadow: "0 14px 28px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
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
  boxShadow: "inset 4px 0 0 #3b82f6",
  color: "#1e3a5f",
  fontSize: "13px",
  fontWeight: 600,
};

const messageBoxSuccess = {
  ...messageBox,
  background: "#dcfce7",
  border: "1px solid #bbf7d0",
  boxShadow: "inset 4px 0 0 #22c55e",
  color: "#166534",
};

const messageBoxError = {
  ...messageBox,
  background: "#fee2e2",
  border: "1px solid #fecaca",
  boxShadow: "inset 4px 0 0 #ef4444",
  color: "#991b1b",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "10px",
  border: "1px solid #d4dfef",
  boxSizing: "border-box",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  color: "#0f172a",
  background: "#fff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.03)",
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

const primaryBtn = {
  padding: "10px 22px",
  background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.01em",
  boxShadow: "0 10px 20px rgba(37,99,235,0.25)",
};

const tableCard = {
  background: "white",
  borderRadius: "14px",
  padding: "24px 26px",
  boxShadow: "0 16px 30px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
};

const tableWrap = {
  overflowX: "auto",
  borderRadius: "10px",
  border: "1px solid #dbe7f5",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
};

const th = {
  textAlign: "left",
  padding: "11px 14px",
  background: "#f8fbff",
  borderBottom: "1px solid #dbe7f5",
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
  borderBottom: "1px solid #edf2fa",
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