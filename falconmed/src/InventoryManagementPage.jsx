import React, { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import SkeletonCard from "./components/SkeletonCard";
import { supabase } from "./lib/supabaseClient";
import { useAnimatedCounter } from "./hooks/useAnimatedCounter";
import {
  getDrugDisplayName,
  getDrugUnitPrice,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMaster";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

export default function InventoryManagementPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [allDrugs, setAllDrugs] = useState([]);
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);

  const [drug, setDrug] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [expiry, setExpiry] = useState("");
  const [batch, setBatch] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchPharmacies();
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster().then((rows) => {
      if (isMounted) {
        setAllDrugs(rows || []);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedPharmacyId) {
      fetchInventory(selectedPharmacyId);
    } else {
      setInventory([]);
      setLoading(false);
    }
  }, [selectedPharmacyId]);

  async function fetchPharmacies() {
    setLoading(true);
    setError("");

    const { data, error } = await loadPharmaciesWithFallback();

    if (error) {
      console.error(error);
      setError("Live pharmacies unavailable. Demo pharmacies restored.");
    }

    setPharmacies(data || []);

    if (data && data.length > 0) {
      setSelectedPharmacyId(String(data[0].id));
    } else {
      setLoading(false);
    }
  }

  async function fetchInventory(pharmacyId) {
    setLoading(true);
    setError("");

    if (!supabase) {
      setInventory([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("pharmacy_inventory")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setError("Failed to load inventory records.");
      setLoading(false);
      return;
    }

    setInventory((data || []).map(normalizeInventoryRow));
    setLoading(false);
  }

  function resetForm() {
    setDrug("");
    setBarcode("");
    setQty("");
    setCost("");
    setExpiry("");
    setBatch("");
    setEditingId(null);
    setError("");
    setSuccess("");
  }

  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!selectedPharmacyId) {
      setError("Please select a pharmacy.");
      return;
    }

    if (!drug.trim()) {
      setError("Please enter drug name.");
      return;
    }

    if (!qty || Number(qty) < 0) {
      setError("Please enter valid quantity.");
      return;
    }

    const payload = {
      pharmacy_id: selectedPharmacyId,
      drug_name: drug.trim(),
      barcode: barcode.trim() || null,
      quantity: Number(qty) || 0,
      unit_cost: Number(cost) || 0,
      expiry_date: expiry || null,
      batch_no: batch.trim() || null,
    };

    const legacyPayload = {
      pharmacy_id: selectedPharmacyId,
      drug: drug.trim(),
      barcode: barcode.trim() || null,
      quantity: Number(qty) || 0,
      unit_cost: Number(cost) || 0,
      expiry_date: expiry || null,
      batch: batch.trim() || null,
    };

    const executeMutation = async (body) => {
      if (editingId) {
        return supabase.from("pharmacy_inventory").update(body).eq("id", editingId);
      }

      return supabase.from("pharmacy_inventory").insert([body]);
    };

    let mutation = await executeMutation(payload);

    if (mutation.error) {
      const message = String(mutation.error.message || "").toLowerCase();
      const missingCanonicalColumns =
        message.includes("drug_name") || message.includes("batch_no") || message.includes("column");

      if (missingCanonicalColumns) {
        mutation = await executeMutation(legacyPayload);
      }
    }

    if (mutation.error) {
      console.error(mutation.error);
      setError(editingId ? "Failed to update record." : "Failed to add record.");
      return;
    }

    setSuccess(editingId ? "Inventory record updated successfully." : "Drug added successfully.");

    resetForm();
    fetchInventory(selectedPharmacyId);
  }

  function handleEdit(item) {
    setEditingId(item.id);
    setDrug(item.drug_name || item.drug || "");
    setBarcode(item.barcode || "");
    setQty(item.quantity ?? "");
    setCost(item.unit_cost ?? "");
    setExpiry(item.expiry_date || "");
    setBatch(item.batch_no || item.batch || "");
    setShowDrugDropdown(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(id) {
    const confirmed = window.confirm("Are you sure you want to delete this record?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("pharmacy_inventory")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      setError("Failed to delete record.");
      return;
    }

    setSuccess("Record deleted successfully.");
    fetchInventory(selectedPharmacyId);
  }

  const totalItems = useMemo(() => {
    return inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [inventory]);

  const totalValue = useMemo(() => {
    return inventory.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
      0
    );
  }, [inventory]);

  const filteredDrugs = useMemo(() => searchDrugMaster(allDrugs, drug, 20), [allDrugs, drug]);

  // Animated KPI counters
  const animTotalItems = useAnimatedCounter(totalItems);
  const animTotalValue = useAnimatedCounter(totalValue);
  const animRecords = useAnimatedCounter(inventory.length);

  const inventoryInsight = useMemo(() => {
    if (loading || inventory.length === 0) return null;

    const lowStockRows = inventory.filter(
      (item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 10
    );
    if (lowStockRows.length === 0) return null;

    const topLow = [...lowStockRows].sort(
      (a, b) => Number(a.quantity || 0) - Number(b.quantity || 0)
    )[0];

    return {
      icon: "▾",
      tone: "warning",
      title: "Smart Insight: Low Stock Warning",
      message: `${lowStockRows.length} SKU${lowStockRows.length === 1 ? "" : "s"} are at or below 10 units. Lowest stock: ${topLow?.drug_name || "Unknown"} (${Number(
        topLow?.quantity || 0
      )} units).`,
    };
  }, [inventory, loading]);

  const handleDrugSelect = (selectedDrug) => {
    const displayName = getDrugDisplayName(selectedDrug);
    const unitPrice = getDrugUnitPrice(selectedDrug, "pharmacy");

    setDrug(displayName);
    if (unitPrice !== null && !cost) {
      setCost(String(unitPrice));
    }
    setShowDrugDropdown(false);
  };

  // ─── Style constants ──────────────────────────────────────────────────────────

  const pageStyle = {
    padding: "32px",
    background: "#eef2f7",
    minHeight: "100vh",
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const headerCard = {
    background: "white",
    borderRadius: "20px",
    padding: "26px 32px",
    boxShadow: "0 2px 16px rgba(15,23,42,0.07)",
    marginBottom: "24px",
    borderLeft: "5px solid #1e40af",
  };

  const headerTitle = {
    margin: 0,
    fontSize: "30px",
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  };

  const headerSub = {
    marginTop: "6px",
    marginBottom: 0,
    fontSize: "14px",
    color: "#64748b",
    lineHeight: 1.6,
  };

  const cardStyle = {
    background: "#fff",
    borderRadius: "18px",
    padding: "24px 28px",
    boxShadow: "0 2px 14px rgba(15,23,42,0.06)",
    marginBottom: "22px",
    border: "1px solid #e8edf5",
  };

  const sectionTitle = {
    fontSize: "15px",
    fontWeight: 800,
    marginBottom: "18px",
    marginTop: 0,
    color: "#0f172a",
    letterSpacing: "-0.01em",
    paddingBottom: "12px",
    borderBottom: "1px solid #f1f5f9",
  };

  const labelStyle = {
    display: "block",
    fontWeight: 700,
    marginBottom: "6px",
    color: "#374151",
    fontSize: "11px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 13px",
    borderRadius: "10px",
    border: "1.5px solid #e2e8f0",
    outline: "none",
    fontSize: "14px",
    boxSizing: "border-box",
    background: "#fff",
    color: "#0f172a",
    fontFamily: "'Segoe UI', Arial, sans-serif",
  };

  const buttonStyle = {
    padding: "10px 22px",
    borderRadius: "10px",
    border: "none",
    background: "#1e40af",
    color: "#fff",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(30,64,175,0.25)",
    letterSpacing: "0.01em",
  };

  const secondaryButtonStyle = {
    padding: "10px 22px",
    borderRadius: "10px",
    border: "1.5px solid #e2e8f0",
    background: "#fff",
    color: "#374151",
    fontWeight: 600,
    fontSize: "14px",
    cursor: "pointer",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "16px",
  };

  const kpiGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "14px",
  };

  const kpiCard = {
    background: "white",
    borderRadius: "14px",
    padding: "16px 18px",
    boxShadow: "0 2px 10px rgba(15,23,42,0.05)",
    border: "1px solid #e8edf5",
    textAlign: "center",
  };

  const kpiLabel = {
    fontSize: "10px",
    fontWeight: 700,
    color: "#94a3b8",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "8px",
  };

  const kpiValue = {
    fontSize: "26px",
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  };

  const kpiHint = {
    fontSize: "11px",
    color: "#94a3b8",
    marginTop: "5px",
    lineHeight: 1.4,
  };

  const dropdownStyle = {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1.5px solid #e2e8f0",
    borderRadius: "12px",
    boxShadow: "0 10px 30px rgba(15,23,42,0.10)",
    zIndex: 30,
    maxHeight: "240px",
    overflowY: "auto",
  };

  const dropdownItemStyle = {
    padding: "11px 14px",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
  };

  const thStyle = {
    padding: "11px 14px",
    fontWeight: 700,
    fontSize: "11px",
    color: "#64748b",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    background: "#f8fafc",
    textAlign: "left",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
  };

  const tdStyle = {
    padding: "12px 14px",
    fontSize: "14px",
    color: "#0f172a",
    verticalAlign: "middle",
  };

  const editBtnStyle = {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#dbeafe",
    color: "#1e40af",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    letterSpacing: "0.02em",
  };

  const deleteBtnStyle = {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#fee2e2",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    letterSpacing: "0.02em",
  };

  const bannerError = {
    background: "#fee2e2",
    color: "#991b1b",
    padding: "12px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
    fontWeight: 600,
    fontSize: "14px",
    borderLeft: "4px solid #ef4444",
  };

  const bannerSuccess = {
    background: "#dcfce7",
    color: "#166534",
    padding: "12px 16px",
    borderRadius: "12px",
    marginBottom: "16px",
    fontWeight: 600,
    fontSize: "14px",
    borderLeft: "4px solid #22c55e",
  };

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerCard}>
        <h1 style={headerTitle}>Inventory Management</h1>
        <p style={headerSub}>
          Track, add, and manage drug stock levels across all pharmacy sites.
        </p>
      </div>

      {/* Banners */}
      {error && <div style={bannerError}>{error}</div>}
      {success && <div style={bannerSuccess}>{success}</div>}

      {/* Pharmacy selector + KPI summary */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Pharmacy &amp; Summary</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: "24px",
            alignItems: "start",
          }}
        >
          <div>
            <label style={labelStyle}>Select Pharmacy</label>
            {loading && pharmacies.length === 0 ? (
              <SkeletonCard
                style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
                blocks={[{ width: "100%", height: 42, gap: 0, radius: 10 }]}
              />
            ) : (
              <select
                value={selectedPharmacyId}
                onChange={(e) => setSelectedPharmacyId(e.target.value)}
                style={inputStyle}
              >
                <option value="">Choose pharmacy</option>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={kpiGrid}>
            {loading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <SkeletonCard
                  key={`inventory-kpi-skeleton-${index}`}
                  style={{ ...kpiCard, borderTop: "4px solid #e2e8f0", minHeight: 112 }}
                  blocks={[
                    { width: "46%", height: 10, gap: 12 },
                    { width: index === 1 ? "70%" : "52%", height: 28, gap: 12 },
                    { width: "76%", height: 10, gap: 0 },
                  ]}
                />
              ))
            ) : (
              <>
                <div className="ui-hover-lift" style={{ ...kpiCard, borderTop: "4px solid #3b82f6" }}>
                  <div style={kpiLabel}>Total Quantity</div>
                  <div style={kpiValue}>{animTotalItems.toLocaleString()}</div>
                  <div style={kpiHint}>Units across all SKUs</div>
                </div>
                <div className="ui-hover-lift" style={{ ...kpiCard, borderTop: "4px solid #10b981" }}>
                  <div style={kpiLabel}>Total Value</div>
                  <div style={{ ...kpiValue, fontSize: "20px" }}>{formatCurrency(animTotalValue)}</div>
                  <div style={kpiHint}>Stock valuation at cost</div>
                </div>
                <div className="ui-hover-lift" style={{ ...kpiCard, borderTop: "4px solid #8b5cf6" }}>
                  <div style={kpiLabel}>Records</div>
                  <div style={kpiValue}>{animRecords}</div>
                  <div style={kpiHint}>Inventory line items</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Add / Edit form */}
      <div style={cardStyle}>
        <div style={sectionTitle}>
          {editingId ? "Edit Drug Record" : "Add Drug to Inventory"}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Drug Name</label>
              <div style={{ position: "relative" }}>
                <input
                  value={drug}
                  onChange={(e) => setDrug(e.target.value)}
                  onFocus={() => setShowDrugDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDrugDropdown(false), 160)}
                  placeholder="Search by brand or generic"
                  style={inputStyle}
                />

                {showDrugDropdown && filteredDrugs.length > 0 ? (
                  <div style={dropdownStyle}>
                    {filteredDrugs.map((result) => (
                      <div
                        key={result.drug_code || result.display_name}
                        style={dropdownItemStyle}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleDrugSelect(result);
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "14px" }}>
                          {getDrugDisplayName(result)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                          {result.generic_name || "Generic name unavailable"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Barcode</label>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Barcode (optional)"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Quantity</label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 100"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Unit Cost (AED)</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="e.g. 12.50"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Expiry Date</label>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Batch No.</label>
              <input
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="e.g. BT-2026-01"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", marginTop: "20px", flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle}>
              {editingId ? "Update Record" : "Add Drug"}
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
              Clear
            </button>
          </div>
        </form>
      </div>

      {/* Inventory table */}
      <div style={cardStyle}>
        <div style={sectionTitle}>Inventory Records</div>

        {inventoryInsight && (
          <InsightCard
            icon={inventoryInsight.icon}
            tone={inventoryInsight.tone}
            title={inventoryInsight.title}
            message={inventoryInsight.message}
            style={{ marginTop: -2 }}
          />
        )}

        {loading ? (
          <div style={{ display: "grid", gap: "10px", paddingTop: "4px" }}>
            <SkeletonCard
              style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
              blocks={[
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 0, radius: 10 },
              ]}
            />
          </div>
        ) : inventory.length === 0 ? (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e8edf5",
              borderRadius: "12px",
              padding: "36px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: "14px",
            }}
          >
            No inventory records found for this pharmacy.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                background: "#fff",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Drug</th>
                  <th style={thStyle}>Barcode</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Unit Cost</th>
                  <th style={thStyle}>Expiry</th>
                  <th style={thStyle}>Batch</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{item.drug_name || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.barcode || "-"}</td>
                    <td style={tdStyle}>{item.quantity}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(item.unit_cost)}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.expiry_date || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.batch_no || "-"}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => handleEdit(item)} style={editBtnStyle}>
                          Edit
                        </button>
                        <button onClick={() => handleDelete(item.id)} style={deleteBtnStyle}>
                          Delete
                        </button>
                      </div>
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