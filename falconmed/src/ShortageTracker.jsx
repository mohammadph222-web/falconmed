import { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import { supabase } from "./lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "./utils/drugMasterLoader";
import { loadPharmaciesWithFallback } from "./utils/pharmacyData";
import { MetricCard, PageHeader, StatusPill } from "./ui";

const INVENTORY_TABLE = "pharmacy_inventory";
const SHORTAGE_THRESHOLD = 10;

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalize(value) {
  return String(value || "").trim();
}

const mapDbToUi = (row) => ({
  id: row.id,
  pharmacyId: String(row.pharmacy_id ?? ""),
  drugName: row.drug_name || row.drug || "",
  drugCode: row.drug_code || "",
  batchNo: row.batch_no || row.batch || "",
  quantity: toNumber(row.quantity),
  expiryDate: row.expiry_date || "",
  createdAt: row.created_at || "",
});

function getShortageStatus(qty) {
  if (qty <= 0) return "Out of Stock";
  if (qty <= 5) return "Critical";
  if (qty <= 10) return "Low Stock";
  return "Healthy";
}

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

function aggregateInventoryRows(rows, pharmacyNameMap) {
  const grouped = new Map();

  for (const row of rows) {
    const pharmacyId = normalize(row.pharmacyId);
    const drugName = normalize(row.drugName);
    const batchNo = normalize(row.batchNo);
    const key = `${pharmacyId}__${drugName.toLowerCase()}__${batchNo.toLowerCase() || "no-batch"}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        groupKey: key,
        pharmacyId,
        pharmacyName: pharmacyNameMap.get(pharmacyId) || "Unknown Pharmacy",
        drugName,
        drugCode: normalize(row.drugCode),
        batchNo,
        expiryDate: row.expiryDate || "",
        quantity: 0,
        sourceRowIds: [],
        sourceRows: [],
      });
    }

    const current = grouped.get(key);
    current.quantity += toNumber(row.quantity);
    current.sourceRowIds.push(row.id);
    current.sourceRows.push(row);

    if (!current.expiryDate && row.expiryDate) {
      current.expiryDate = row.expiryDate;
    } else if (current.expiryDate && row.expiryDate) {
      const existingTs = new Date(current.expiryDate).getTime();
      const nextTs = new Date(row.expiryDate).getTime();
      if (Number.isFinite(existingTs) && Number.isFinite(nextTs) && nextTs < existingTs) {
        current.expiryDate = row.expiryDate;
      }
    }

    if (!current.drugCode && normalize(row.drugCode)) {
      current.drugCode = normalize(row.drugCode);
    }
  }

  return Array.from(grouped.values()).map((item) => ({
    ...item,
    quantity: Number(item.quantity.toFixed(2)),
    status: getShortageStatus(item.quantity),
  }));
}

export default function ShortageTracker() {
  const [inventoryRows, setInventoryRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [pharmacies, setPharmacies] = useState([]);
  const [pharmacyNameMap, setPharmacyNameMap] = useState(new Map());

  const [allDrugs, setAllDrugs] = useState([]);
  const [drugSearch, setDrugSearch] = useState("");
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [pharmacyFilter, setPharmacyFilter] = useState("all");
  const [searchText, setSearchText] = useState("");

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

  const loadInventory = async () => {
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from(INVENTORY_TABLE)
        .select("*")
        .order("quantity", { ascending: true });

      if (error) {
        setInventoryRows([]);
        setMessage("Failed to load shortage records.");
        return;
      }

      setInventoryRows((data || []).map(mapDbToUi));
    } catch {
      setInventoryRows([]);
      setMessage("Failed to load shortage records.");
    } finally {
      setLoading(false);
    }
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

  useEffect(() => {
    void loadInventory();
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

  const groupedRows = useMemo(
    () => aggregateInventoryRows(inventoryRows, pharmacyNameMap),
    [inventoryRows, pharmacyNameMap]
  );

  const shortageRows = useMemo(
    () => groupedRows.filter((row) => row.status !== "Healthy"),
    [groupedRows]
  );

  const filteredRows = useMemo(() => {
    const q = normalize(searchText).toLowerCase();

    const byStatus = shortageRows.filter((row) => {
      if (statusFilter === "all") return true;
      return row.status.toLowerCase() === statusFilter;
    });

    const byPharmacy = byStatus.filter((row) => {
      if (pharmacyFilter === "all") return true;
      return String(row.pharmacyId) === String(pharmacyFilter);
    });

    if (!q) return byPharmacy;

    return byPharmacy.filter((row) => {
      const haystack = [
        row.drugName,
        row.drugCode,
        row.pharmacyName,
        row.batchNo,
      ]
        .map((v) => normalize(v).toLowerCase())
        .join(" ");

      return haystack.includes(q);
    });
  }, [shortageRows, statusFilter, pharmacyFilter, searchText]);

  const totals = useMemo(() => {
    const outOfStock = shortageRows.filter((x) => x.status === "Out of Stock").length;
    const critical = shortageRows.filter((x) => x.status === "Critical").length;
    const lowStock = shortageRows.filter((x) => x.status === "Low Stock").length;
    return { outOfStock, critical, lowStock, total: shortageRows.length };
  }, [shortageRows]);

  const shortageInsight = useMemo(() => {
    if (loading || shortageRows.length === 0) return null;

    if (totals.outOfStock > 0) {
      return {
        icon: "⚠",
        tone: "warning",
        title: "Smart Insight: Out-of-Stock Alert",
        message: `${totals.outOfStock} item${totals.outOfStock === 1 ? " is" : "s are"} completely out of stock. Immediate procurement is required.`,
      };
    }

    if (totals.critical > 0) {
      return {
        icon: "⚠",
        tone: "warning",
        title: "Smart Insight: Critical Shortage",
        message: `${totals.critical} critical item${totals.critical === 1 ? " needs" : "s need"} urgent replenishment within the next cycle.`,
      };
    }

    return {
      icon: "ℹ",
      tone: "info",
      title: "Smart Insight: Monitor Low Stock",
      message: `${totals.lowStock} low-stock item${totals.lowStock === 1 ? " is" : "s are"} currently in monitoring range (6-10 units).`,
    };
  }, [loading, shortageRows, totals]);

  const getStatusStyle = (status) => {
    if (status === "Out of Stock") return badgeOutOfStock;
    if (status === "Critical") return badgeCritical;
    return badgeLowStock;
  };

  const getSuggestedQty = (row) => {
    const gapToThreshold = Math.max(SHORTAGE_THRESHOLD - toNumber(row.quantity), 1);
    if (row.status === "Out of Stock") return Math.max(gapToThreshold, 10);
    if (row.status === "Critical") return Math.max(gapToThreshold, 6);
    return Math.max(gapToThreshold, 3);
  };

  const createPurchaseRequest = async (row) => {
    try {
      const payload = {
        drug_name: row.drugName,
        suggested_qty: getSuggestedQty(row),
        priority: row.status === "Out of Stock" ? "high" : row.status === "Critical" ? "high" : "medium",
        reason: `Shortage monitor: ${row.status} at ${row.pharmacyName}${row.batchNo ? ` (Batch ${row.batchNo})` : ""}`,
        status: "pending",
      };

      const { error } = await supabase.from("purchase_requests").insert([payload]);

      if (error) {
        setMessage("Failed to create purchase request.");
        return;
      }

      setMessage(`Purchase request created for ${row.drugName}.`);
    } catch {
      setMessage("Failed to create purchase request.");
    }
  };

  const handleRestock = async (row) => {
    if (!row || row.sourceRowIds.length !== 1) {
      setMessage("This shortage is grouped from multiple inventory rows. Use Create Request for safe handling.");
      return;
    }

    const raw = window.prompt("Enter new stock quantity for this item:", String(row.quantity));
    if (raw === null) return;

    const newQty = Number(raw);
    if (!Number.isFinite(newQty) || newQty < 0) return;

    const sourceId = row.sourceRowIds[0];
    const { error } = await supabase
      .from(INVENTORY_TABLE)
      .update({ quantity: newQty })
      .eq("id", sourceId);

    if (error) {
      setMessage("Failed to update stock quantity.");
      return;
    }

    await loadInventory();
    setMessage("Stock quantity updated successfully.");
  };

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
        .from(INVENTORY_TABLE)
        .insert(payload)
        .select("*")
        .single();

      if (insertResult.error) {
        const msg = String(insertResult.error.message || "").toLowerCase();
        const createdByMissing = msg.includes("created_by") && msg.includes("column");
        if (createdByMissing) {
          const { created_by, ...fallbackPayload } = payload;
          insertResult = await supabase
            .from(INVENTORY_TABLE)
            .insert(fallbackPayload)
            .select("*")
            .single();
        }
      }

      if (insertResult.error) {
        setMessage("Failed to record shortage item.");
        return;
      }

      await loadInventory();
      setMessage("Shortage item recorded successfully.");
    } catch {
      setMessage("Failed to record shortage item.");
      return;
    }

    setForm({ drugName: "", pharmacyId: "", quantity: "0", batchNo: "", expiryDate: "" });
    setDrugSearch("");
  };

  return (
    <div>
      <div style={pageHeaderRow}>
        <PageHeader
          title="Shortage Tracker"
          subtitle="Smart shortage monitoring from pharmacy inventory with deduplicated operational view."
          style={{ marginTop: 0, marginBottom: 0 }}
        />
      </div>

      <div style={cardsGrid}>
        <MetricCard
          className="ui-hover-lift"
          accent="danger"
          icon="OUT"
          label="Out of Stock"
          value={totals.outOfStock}
          helper="Qty <= 0"
        />
        <MetricCard
          className="ui-hover-lift"
          accent="warning"
          icon="CRIT"
          label="Critical (1-5)"
          value={totals.critical}
          helper="Urgent restock needed"
        />
        <MetricCard
          className="ui-hover-lift"
          accent="info"
          icon="LOW"
          label="Low Stock (6-10)"
          value={totals.lowStock}
          helper="Monitor closely"
        />
        <MetricCard
          className="ui-hover-lift"
          accent="neutral"
          icon="TOTAL"
          label="Total Shortage Items"
          value={totals.total}
          helper="Deduplicated monitor rows"
        />
      </div>

      <div style={tableCard}>
        <div style={tableHeaderRow}>
          <h2 style={sectionTitleNoBorder}>Smart Shortage Monitor</h2>
          <div style={filtersWrap}>
            {[
              { key: "all", label: "All" },
              { key: "out of stock", label: "Out of Stock" },
              { key: "critical", label: "Critical" },
              { key: "low stock", label: "Low Stock" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={statusFilter === tab.key ? filterTabActive : filterTab}
                className="fm-action-btn"
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {shortageInsight && (
          <InsightCard
            icon={shortageInsight.icon}
            tone={shortageInsight.tone}
            title={shortageInsight.title}
            message={shortageInsight.message}
            style={{ marginBottom: 14 }}
          />
        )}

        <div style={searchRow}>
          <input
            style={searchInput}
            placeholder="Search by drug, code, pharmacy, or batch"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <select
            style={pharmacySelect}
            value={pharmacyFilter}
            onChange={(e) => setPharmacyFilter(e.target.value)}
          >
            <option value="all">All Pharmacies</option>
            {pharmacies.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

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
                  <td colSpan="7" style={emptyCell}>Loading shortage data...</td>
                </tr>
              )}

              {!loading && filteredRows.map((row, idx) => (
                <tr
                  key={row.groupKey}
                  className="fm-table-row"
                  style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                >
                  <td style={{ ...td, fontWeight: 700 }}>
                    <div>{row.drugName || "Unnamed Drug"}</div>
                    {row.drugCode ? <div style={subMeta}>Code: {row.drugCode}</div> : null}
                  </td>
                  <td style={{ ...td, color: "#64748b" }}>{row.pharmacyName}</td>
                  <td style={td}>{row.quantity}</td>
                  <td style={{ ...td, color: "#64748b" }}>{row.batchNo || "-"}</td>
                  <td style={{ ...td, color: "#64748b" }}>{row.expiryDate || "-"}</td>
                  <td style={td}>
                    <StatusPill
                      variant={
                        row.status === "Out of Stock"
                          ? "danger"
                          : row.status === "Critical"
                          ? "warning"
                          : "info"
                      }
                      style={getStatusStyle(row.status)}
                    >
                      {row.status}
                    </StatusPill>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        style={smallBtnRequest}
                        className="fm-action-btn"
                        onClick={() => createPurchaseRequest(row)}
                        type="button"
                      >
                        Create Request
                      </button>
                      <button
                        style={smallBtnRestock}
                        className="fm-action-btn"
                        onClick={() => handleRestock(row)}
                        type="button"
                      >
                        Restock
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan="7" style={emptyCell}>
                    No shortage rows match current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={manualCard}>
        <div style={manualHeader}>
          <h2 style={sectionTitleNoBorder}>Manual Shortage Entry (Optional)</h2>
          <button
            type="button"
            style={toggleBtn}
            className="fm-action-btn"
            onClick={() => setShowManualForm((v) => !v)}
          >
            {showManualForm ? "Hide" : "Show"}
          </button>
        </div>

        {message && (
          <div
            style={
              message.toLowerCase().includes("success")
                ? messageBoxSuccess
                : message.toLowerCase().includes("fail") || message.toLowerCase().includes("error")
                ? messageBoxError
                : messageBox
            }
          >
            {message}
          </div>
        )}

        {showManualForm && (
          <form onSubmit={handleAdd} style={formGrid}>
            <div style={drugSearchContainer}>
              <div style={fieldLabel}>Search Drug</div>
              <input
                style={input}
                placeholder="Search by brand, generic, strength..."
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
                    <div key={idx} style={drugOption} onClick={() => handleDrugSelect(drug)}>
                      {getDrugDisplayName(drug)}
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
              <button type="submit" style={primaryBtn} className="fm-action-btn">
                Record Shortage Item
              </button>
            </div>
          </form>
        )}
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
  paddingBottom: "20px",
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
  margin: "7px 0 0",
  fontSize: "14.2px",
  color: "#64748b",
  lineHeight: 1.6,
};

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "15px",
  marginBottom: "22px",
};

const statCard = {
  background: "white",
  borderRadius: "14px",
  padding: "19px 17px 15px",
  boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
  textAlign: "center",
};

const statLabel = {
  fontSize: "10.5px",
  color: "#7f91a8",
  marginBottom: "8px",
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

const statValue = {
  fontSize: "32px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
};

const statHint = {
  marginTop: "7px",
  fontSize: "11.5px",
  color: "#71839a",
};

const tableCard = {
  background: "white",
  borderRadius: "14px",
  padding: "19px 19px 17px",
  boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
  marginBottom: "18px",
};

const tableHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  marginBottom: "8px",
  flexWrap: "wrap",
};

const sectionTitleNoBorder = {
  marginTop: 0,
  marginBottom: 0,
  color: "#0f172a",
  fontSize: "17px",
  fontWeight: 800,
  letterSpacing: "-0.01em",
};

const filtersWrap = {
  display: "flex",
  gap: "7px",
  flexWrap: "wrap",
};

const filterTab = {
  padding: "7px 12px",
  borderRadius: "9px",
  border: "1px solid #dbe7f5",
  background: "#f7fbff",
  color: "#334155",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 700,
  boxShadow: "0 3px 8px rgba(15, 23, 42, 0.03)",
};

const filterTabActive = {
  ...filterTab,
  border: "1px solid #1d4ed8",
  background: "#1d4ed8",
  color: "#fff",
};

const searchRow = {
  display: "grid",
  gridTemplateColumns: "1fr minmax(200px, 280px)",
  gap: "11px",
  marginBottom: "12px",
};

const searchInput = {
  width: "100%",
  padding: "10px 13px",
  borderRadius: "11px",
  border: "1px solid #cad8ea",
  fontSize: "14px",
  color: "#0f172a",
  background: "#fff",
};

const pharmacySelect = {
  ...searchInput,
  background: "#fff",
};

const tableWrap = {
  overflowX: "auto",
  borderRadius: "12px",
  border: "1px solid #dbe7f5",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
};

const th = {
  textAlign: "left",
  padding: "11px 13px",
  background: "#f8fbff",
  borderBottom: "1px solid #dbe7f5",
  color: "#64748b",
  fontSize: "10.5px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const td = {
  padding: "12px 13px",
  borderBottom: "1px solid #edf2fa",
  color: "#0f172a",
  fontSize: "13.2px",
  verticalAlign: "middle",
};

const subMeta = {
  marginTop: "2px",
  fontSize: "11px",
  color: "#64748b",
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
  padding: "6px 11px",
  border: "1px solid #bbf7d0",
  borderRadius: "9px",
  cursor: "pointer",
  fontSize: "11.5px",
  fontWeight: 700,
  background: "#dcfce7",
  color: "#166534",
  boxShadow: "0 4px 10px rgba(22, 101, 52, 0.1)",
};

const smallBtnRequest = {
  padding: "6px 11px",
  border: "1px solid #bfdbfe",
  borderRadius: "9px",
  cursor: "pointer",
  fontSize: "11.5px",
  fontWeight: 700,
  background: "#eff6ff",
  color: "#1d4ed8",
  boxShadow: "0 4px 10px rgba(29, 78, 216, 0.12)",
};

const emptyCell = {
  padding: "28px 20px",
  textAlign: "center",
  color: "#94a3b8",
  fontSize: "14px",
  background: "#f8fafc",
};

const manualCard = {
  background: "white",
  borderRadius: "14px",
  padding: "18px 19px",
  boxShadow: "0 12px 24px rgba(15,23,42,0.06)",
  border: "1px solid #dbe7f5",
};

const manualHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  marginBottom: "10px",
  flexWrap: "wrap",
};

const toggleBtn = {
  padding: "7px 12px",
  borderRadius: "9px",
  border: "1px solid #d4dfef",
  background: "#f8fbff",
  color: "#334155",
  fontSize: "12px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 4px 10px rgba(15, 23, 42, 0.04)",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "13px",
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
  marginBottom: "12px",
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
  padding: "10px 13px",
  fontSize: "14px",
  borderRadius: "11px",
  border: "1px solid #cad8ea",
  boxSizing: "border-box",
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
  padding: "10px 21px",
  background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
  color: "white",
  border: "none",
  borderRadius: "11px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.01em",
  boxShadow: "0 10px 18px rgba(37,99,235,0.24)",
};
