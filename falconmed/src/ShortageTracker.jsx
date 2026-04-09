import { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMasterLoader";
import { loadPharmaciesWithFallback } from "./utils/pharmacyData";

// Read/write to pharmacy_inventory — items where quantity is at or below this threshold.
const SHORTAGE_TABLE = "pharmacy_inventory";
const SHORTAGE_THRESHOLD = 10;

const mapDbToUi = (row) => ({
  id: row.id,
  pharmacyId: String(row.pharmacy_id ?? ""),
  drugName: row.drug_name || row.drug || "",
  batchNo: row.batch_no || row.batch || "",
  quantity: Number(row.quantity ?? 0),
  expiryDate: row.expiry_date || "",
  unitCost: Number(row.unit_cost || 0),
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

export default function ShortageTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [pharmacies, setPharmacies] = useState([]);
  const [pharmacyNameMap, setPharmacyNameMap] = useState(new Map());

  const [allDrugs, setAllDrugs] = useState([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);

  const [form, setForm] = useState({
    drugName: "",
    pharmacyId: "",
    quantity: "0",
    batchNo: "",
    expiryDate: "",
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    loadPharmaciesWithFallback().then(({ data }) => {
      const list = buildUniquePharmacies(data || []);
      setPharmacies(list);
      const nameMap = new Map();
      list.forEach((p) => nameMap.set(String(p.id), p.name || "Unknown Pharmacy"));
      setPharmacyNameMap(nameMap);
    });
  }, []);

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
          .lte("quantity", SHORTAGE_THRESHOLD)
          .order("quantity", { ascending: true });

        if (error) {
          setItems([]);
          setMessage("Failed to load shortage records.");
          return;
        }

        const mapped = (data || []).map(mapDbToUi);
        setItems(mapped);
      } catch (err) {
        setItems([]);
        setMessage("Failed to load shortage records.");
      } finally {
        setLoading(false);
      }
    };

    void loadItems();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!form.drugName || !form.pharmacyId) {
      setMessage("Please select a drug and a pharmacy.");
      return;
    }

    try {
      const payload = {
        pharmacy_id: form.pharmacyId,
        drug_name: form.drugName,
        quantity: Number(form.quantity ?? 0),
        batch_no: form.batchNo || null,
        expiry_date: form.expiryDate || null,
        unit_cost: 0,
        created_at: new Date().toISOString(),
        created_by: "falconmed.demo@preview",
      };

      let insertResult = await supabase
        .from(SHORTAGE_TABLE)
        .insert(payload)
        .select("*")
        .single();

      if (insertResult.error) {
        const msg = String(insertResult.error.message || "").toLowerCase();
        const createdByMissing = msg.includes("created_by") && msg.includes("column");
        if (createdByMissing) {
          const { created_by, ...fallbackPayload } = payload;
          insertResult = await supabase
            .from(SHORTAGE_TABLE)
            .insert(fallbackPayload)
            .select("*")
            .single();
        }
      }

      const { error } = insertResult;
      if (error) {
        setMessage("Failed to record shortage item.");
        return;
      }

      // Refresh low-stock list
      const { data: refreshed } = await supabase
        .from(SHORTAGE_TABLE)
        .select("*")
        .lte("quantity", SHORTAGE_THRESHOLD)
        .order("quantity", { ascending: true });
      setItems((refreshed || []).map(mapDbToUi));
      setMessage("Shortage item recorded successfully.");
    } catch (err) {
      setMessage("Failed to record shortage item.");
      return;
    }

    setForm({ drugName: "", pharmacyId: "", quantity: "0", batchNo: "", expiryDate: "" });
    setDrugSearch("");
  };

  const handleRestock = async (id) => {
    const raw = window.prompt("Enter new stock quantity for this item:", "0");
    if (raw === null) return;
    const newQty = Number(raw);
    if (!Number.isFinite(newQty) || newQty < 0) return;

    const { error } = await supabase
      .from(SHORTAGE_TABLE)
      .update({ quantity: newQty })
      .eq("id", id);

    if (error) {
      setMessage("Failed to update stock quantity.");
      return;
    }

    // Refresh list (restocked items above threshold disappear from the shortage view)
    const { data: refreshed } = await supabase
      .from(SHORTAGE_TABLE)
      .select("*")
      .lte("quantity", SHORTAGE_THRESHOLD)
      .order("quantity", { ascending: true });
    setItems((refreshed || []).map(mapDbToUi));
  };

  const totals = useMemo(() => {
    const outOfStock = items.filter((x) => x.quantity === 0).length;
    const critical = items.filter((x) => x.quantity > 0 && x.quantity <= 5).length;
    const lowStock = items.filter((x) => x.quantity > 5 && x.quantity <= SHORTAGE_THRESHOLD).length;
    return { outOfStock, critical, lowStock, total: items.length };
  }, [items]);

  const shortageInsight = useMemo(() => {
    if (loading || items.length === 0) return null;

    const outOfStockItems = items.filter((item) => item.quantity === 0);
    if (outOfStockItems.length === 0) return null;

    const mostUrgent = outOfStockItems[0];

    return {
      icon: "⚠",
      tone: "warning",
      title: "Smart Insight: Stock Depletion Alert",
      message: `${outOfStockItems.length} item${outOfStockItems.length === 1 ? "" : "s"} completely out of stock. Urgent restocking required — starting with ${mostUrgent?.drugName || "unknown drug"}.`,
    };
  }, [items, loading]);

  const getStatusStyle = (qty) => {
    if (qty === 0) return badgeOutOfStock;
    if (qty <= 5) return badgeCritical;
    return badgeLowStock;
  };

  const getStatusLabel = (qty) => {
    if (qty === 0) return "Out of Stock";
    if (qty <= 5) return "Critical";
    return "Low Stock";
  };

  return (
    <div>
      {/* Page header */}
      <div style={pageHeaderRow}>
        <div>
          <h1 style={pageTitle}>Shortage Tracker</h1>
          <p style={pageSub}>Monitor low-stock and out-of-stock drugs across all pharmacies (from pharmacy_inventory).</p>
        </div>
      </div>

      {/* KPI strip */}
      <div style={cardsGrid}>
        <div style={{ ...statCard, borderTop: "4px solid #ef4444" }}>
          <div style={statLabel}>Out of Stock</div>
          <div style={statValue}>{totals.outOfStock}</div>
          <div style={statHint}>Zero units available</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #f59e0b" }}>
          <div style={statLabel}>Critical (1–5)</div>
          <div style={statValue}>{totals.critical}</div>
          <div style={statHint}>Urgent restock needed</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #3b82f6" }}>
          <div style={statLabel}>Low Stock (6–10)</div>
          <div style={statValue}>{totals.lowStock}</div>
          <div style={statHint}>Monitor closely</div>
        </div>
        <div style={{ ...statCard, borderTop: "4px solid #8b5cf6" }}>
          <div style={statLabel}>Total Shortage Items</div>
          <div style={statValue}>{totals.total}</div>
          <div style={statHint}>From pharmacy_inventory</div>
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
            <div style={fieldLabel}>Drug Name *</div>
            <input
              style={input}
              placeholder="Drug name"
              value={form.drugName}
              onChange={(e) => handleChange("drugName", e.target.value)}
            />
          </div>

          <div>
            <div style={fieldLabel}>Pharmacy *</div>
            <select
              style={input}
              value={form.pharmacyId}
              onChange={(e) => handleChange("pharmacyId", e.target.value)}
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

          <div>
            <div style={fieldLabel}>Current Stock Qty</div>
            <input
              style={input}
              type="number"
              placeholder="e.g. 0"
              value={form.quantity}
              onChange={(e) => handleChange("quantity", e.target.value)}
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
            <div style={fieldLabel}>Expiry Date</div>
            <input
              style={input}
              type="date"
              value={form.expiryDate}
              onChange={(e) => handleChange("expiryDate", e.target.value)}
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <button type="submit" style={primaryBtn}>
              Record Shortage Item
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div style={tableCard}>
        <h2 style={sectionTitle}>Low-Stock &amp; Out-of-Stock Items</h2>

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
                <th style={th}>Pharmacy</th>
                <th style={th}>Qty in Stock</th>
                <th style={th}>Batch</th>
                <th style={th}>Expiry Date</th>
                <th style={th}>Status</th>
                <th style={th}>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan="7" style={emptyCell}>
                    Loading shortage data…
                  </td>
                </tr>
              )}

              {items.map((item, idx) => (
                <tr
                  key={item.id}
                  style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                >
                  <td style={{ ...td, fontWeight: 700 }}>{item.drugName}</td>
                  <td style={{ ...td, color: "#64748b" }}>
                    {pharmacyNameMap.get(item.pharmacyId) || "Unknown Pharmacy"}
                  </td>
                  <td style={td}>{item.quantity}</td>
                  <td style={{ ...td, color: "#64748b" }}>{item.batchNo || "-"}</td>
                  <td style={{ ...td, color: "#64748b" }}>{item.expiryDate || "-"}</td>
                  <td style={td}>
                    <span style={getStatusStyle(item.quantity)}>{getStatusLabel(item.quantity)}</span>
                  </td>
                  <td style={td}>
                    <button
                      style={smallBtnRestock}
                      onClick={() => handleRestock(item.id)}
                      type="button"
                    >
                      Restock
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="7" style={emptyCell}>
                    No low-stock items found. All drugs are above the threshold ({SHORTAGE_THRESHOLD} units).
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
  marginBottom: "26px",
  paddingBottom: "22px",
  borderBottom: "1px solid #e7eef9",
  flexWrap: "wrap",
};

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

const badgeOutOfStock = {
  ...badgeBase,
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fecaca",
};

const badgeCritical = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const badgeLowStock = {
  ...badgeBase,
  background: "#dbeafe",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
};

const smallBtnRestock = {
  padding: "5px 12px",
  border: "1px solid #bbf7d0",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.02em",
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