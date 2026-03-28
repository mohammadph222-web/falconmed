import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
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

  const handleDrugSelect = (selectedDrug) => {
    const displayName = getDrugDisplayName(selectedDrug);
    const unitPrice = getDrugUnitPrice(selectedDrug, "pharmacy");

    setDrug(displayName);
    if (unitPrice !== null && !cost) {
      setCost(String(unitPrice));
    }
    setShowDrugDropdown(false);
  };

  const pageStyle = {
    padding: "24px",
    background: "#f5f7fb",
    minHeight: "100vh",
    fontFamily: "Arial, sans-serif",
  };

  const cardStyle = {
    background: "#fff",
    borderRadius: "18px",
    padding: "24px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
    marginBottom: "22px",
  };

  const titleStyle = {
    fontSize: "34px",
    fontWeight: "700",
    marginBottom: "20px",
    color: "#0f172a",
  };

  const sectionTitle = {
    fontSize: "22px",
    fontWeight: "700",
    marginBottom: "18px",
    color: "#0f172a",
    textAlign: "center",
  };

  const labelStyle = {
    display: "block",
    fontWeight: "700",
    marginBottom: "8px",
    color: "#1e3557",
    fontSize: "16px",
  };

  const inputStyle = {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "16px",
    boxSizing: "border-box",
    background: "#fff",
  };

  const buttonStyle = {
    padding: "14px 20px",
    borderRadius: "14px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "700",
    fontSize: "16px",
    cursor: "pointer",
  };

  const secondaryButtonStyle = {
    padding: "14px 20px",
    borderRadius: "14px",
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#111827",
    fontWeight: "700",
    fontSize: "16px",
    cursor: "pointer",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "16px",
  };

  const summaryBox = {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: "16px",
    padding: "18px",
  };

  const dropdownStyle = {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.10)",
    zIndex: 30,
    maxHeight: "240px",
    overflowY: "auto",
  };

  const dropdownItemStyle = {
    padding: "12px 14px",
    borderBottom: "1px solid #e2e8f0",
    cursor: "pointer",
    background: "#fff",
  };

  return (
    <div style={pageStyle}>
      <div style={titleStyle}>Inventory Management</div>

      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            padding: "12px 16px",
            borderRadius: "12px",
            marginBottom: "16px",
            fontWeight: "600",
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            background: "#dcfce7",
            color: "#166534",
            padding: "12px 16px",
            borderRadius: "12px",
            marginBottom: "16px",
            fontWeight: "600",
          }}
        >
          {success}
        </div>
      )}

      <div style={cardStyle}>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Select Pharmacy</label>
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
          </div>

          <div style={summaryBox}>
            <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>
              Inventory Summary
            </div>
            <div>Total Quantity: {totalItems}</div>
            <div>Total Value: {formatCurrency(totalValue)}</div>
            <div>Records: {inventory.length}</div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>{editingId ? "Edit Drug" : "Add Drug"}</div>

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
                  placeholder="Search drug by brand or generic name"
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
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>
                          {getDrugDisplayName(result)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
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
                placeholder="Barcode"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Quantity</label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Quantity"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Unit Cost</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Unit Cost"
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
              <label style={labelStyle}>Batch</label>
              <input
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="Batch"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "22px", flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle}>
              {editingId ? "Update Drug" : "Add Drug"}
            </button>

            <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
              Clear
            </button>
          </div>
        </form>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Inventory Records</div>

        {loading ? (
          <div>Loading...</div>
        ) : inventory.length === 0 ? (
          <div>No inventory records found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "#fff",
              }}
            >
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: "14px" }}>Drug</th>
                  <th style={{ padding: "14px" }}>Barcode</th>
                  <th style={{ padding: "14px" }}>Quantity</th>
                  <th style={{ padding: "14px" }}>Unit Cost</th>
                  <th style={{ padding: "14px" }}>Expiry Date</th>
                  <th style={{ padding: "14px" }}>Batch</th>
                  <th style={{ padding: "14px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "14px" }}>{item.drug_name || "-"}</td>
                    <td style={{ padding: "14px" }}>{item.barcode || "-"}</td>
                    <td style={{ padding: "14px" }}>{item.quantity}</td>
                    <td style={{ padding: "14px" }}>{formatCurrency(item.unit_cost)}</td>
                    <td style={{ padding: "14px" }}>{item.expiry_date || "-"}</td>
                    <td style={{ padding: "14px" }}>{item.batch_no || "-"}</td>
                    <td style={{ padding: "14px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => handleEdit(item)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "12px",
                          border: "none",
                          background: "#2563eb",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: "700",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "12px",
                          border: "none",
                          background: "#ef4444",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: "700",
                        }}
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