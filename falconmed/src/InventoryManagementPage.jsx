import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

export default function InventoryManagementPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");

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
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");
    setSuccess("");

    const { data: pharmacyData, error: pharmacyError } = await supabase
      .from("pharmacies")
      .select("*")
      .order("name", { ascending: true });

    if (pharmacyError) {
      setError(pharmacyError.message);
      setLoading(false);
      return;
    }

    const { data: inventoryData, error: inventoryError } = await supabase
      .from("pharmacy_inventory")
      .select("*")
      .order("drug_name", { ascending: true });

    if (inventoryError) {
      setError(inventoryError.message);
      setLoading(false);
      return;
    }

    setPharmacies(pharmacyData || []);
    setInventory(inventoryData || []);

    if (!selectedPharmacyId && pharmacyData && pharmacyData.length > 0) {
      setSelectedPharmacyId(pharmacyData[0].id);
    }

    setLoading(false);
  }

  function clearForm() {
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

  async function addDrug() {
    setError("");
    setSuccess("");

    if (!selectedPharmacyId) {
      setError("Please choose a pharmacy.");
      return;
    }

    if (!drug.trim()) {
      setError("Please enter a drug name.");
      return;
    }

    if (!qty || Number(qty) < 0) {
      setError("Please enter a valid quantity.");
      return;
    }

    const { error: insertError } = await supabase
      .from("pharmacy_inventory")
      .insert([
        {
          pharmacy_id: selectedPharmacyId,
          drug_name: drug.trim(),
          barcode: barcode.trim() || null,
          quantity: Number(qty || 0),
          unit_cost: Number(cost || 0),
          expiry_date: expiry || null,
          batch_no: batch.trim() || null,
        },
      ]);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess("Drug added successfully.");
    clearForm();
    await loadData();
  }

  async function updateDrug() {
    setError("");
    setSuccess("");

    if (!editingId) return;

    if (!drug.trim()) {
      setError("Please enter a drug name.");
      return;
    }

    if (!qty || Number(qty) < 0) {
      setError("Please enter a valid quantity.");
      return;
    }

    const { error: updateError } = await supabase
      .from("pharmacy_inventory")
      .update({
        drug_name: drug.trim(),
        barcode: barcode.trim() || null,
        quantity: Number(qty || 0),
        unit_cost: Number(cost || 0),
        expiry_date: expiry || null,
        batch_no: batch.trim() || null,
      })
      .eq("id", editingId);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Drug updated successfully.");
    clearForm();
    await loadData();
  }

  async function deleteDrug(id) {
    setError("");
    setSuccess("");

    const ok = window.confirm("Delete this inventory item?");
    if (!ok) return;

    const { error: deleteError } = await supabase
      .from("pharmacy_inventory")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setSuccess("Drug deleted successfully.");
    await loadData();
  }

  function editDrug(item) {
    setDrug(item.drug_name || "");
    setBarcode(item.barcode || "");
    setQty(item.quantity ?? "");
    setCost(item.unit_cost ?? "");
    setExpiry(item.expiry_date || "");
    setBatch(item.batch_no || "");
    setEditingId(item.id);
    setError("");
    setSuccess("");
  }

  const selectedPharmacy = useMemo(() => {
    return pharmacies.find((p) => p.id === selectedPharmacyId) || null;
  }, [pharmacies, selectedPharmacyId]);

  const filteredInventory = useMemo(() => {
    if (!selectedPharmacyId) return [];
    return inventory.filter((item) => item.pharmacy_id === selectedPharmacyId);
  }, [inventory, selectedPharmacyId]);

  const totalQty = filteredInventory.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const totalValue = filteredInventory.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
    0
  );

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #dbe3ee",
          borderRadius: 24,
          padding: 28,
          boxShadow: "0 2px 8px rgba(15,23,42,0.03)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 28, color: "#0f172a" }}>
            Inventory Management
          </h1>
        </div>

        <p
          style={{
            textAlign: "center",
            color: "#475569",
            fontSize: 16,
            marginTop: 0,
            marginBottom: 24,
          }}
        >
          Add, edit, and delete pharmacy inventory records.
        </p>

        {error ? (
          <div
            style={{
              background: "#fde7e7",
              color: "#b42318",
              border: "1px solid #f3b4b4",
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: 20,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        {success ? (
          <div
            style={{
              background: "#e8f8ec",
              color: "#137333",
              border: "1px solid #b7e1c0",
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: 20,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {success}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <MetricCard
            label="SELECTED PHARMACY"
            value={selectedPharmacy ? selectedPharmacy.name : "-"}
          />
          <MetricCard label="TOTAL QTY" value={totalQty} />
          <MetricCard
            label="TOTAL STOCK VALUE"
            value={formatCurrency(totalValue)}
          />
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe3ee",
            borderRadius: 20,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <label style={labelStyle}>Choose Pharmacy</label>
          <select
            value={selectedPharmacyId}
            onChange={(e) => setSelectedPharmacyId(e.target.value)}
            style={inputStyle}
          >
            {pharmacies.map((pharmacy) => (
              <option key={pharmacy.id} value={pharmacy.id}>
                {pharmacy.name} - {pharmacy.location}
              </option>
            ))}
          </select>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe3ee",
            borderRadius: 20,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h2 style={{ marginTop: 0, color: "#0f172a" }}>
            {editingId ? "Edit Drug" : "Add Drug"}
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Drug Name</label>
              <input
                value={drug}
                onChange={(e) => setDrug(e.target.value)}
                placeholder="Drug Name"
                style={inputStyle}
              />
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
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Quantity"
                type="number"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Unit Cost</label>
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Unit Cost"
                type="number"
                step="0.01"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Expiry Date</label>
              <input
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                type="date"
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

          <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
            {editingId ? (
              <button onClick={updateDrug} style={primaryBtnStyle}>
                Update Drug
              </button>
            ) : (
              <button onClick={addDrug} style={primaryBtnStyle}>
                Add Drug
              </button>
            )}

            <button onClick={clearForm} style={secondaryBtnStyle}>
              Clear
            </button>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe3ee",
            borderRadius: 20,
            padding: 22,
            minHeight: 420,
          }}
        >
          <h2 style={{ marginTop: 0, color: "#0f172a" }}>Inventory Records</h2>

          {loading ? (
            <div style={{ color: "#64748b" }}>Loading...</div>
          ) : filteredInventory.length === 0 ? (
            <div
              style={{
                border: "1px dashed #cbd5e1",
                borderRadius: 18,
                padding: 28,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No inventory records found for this pharmacy.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr style={{ background: "#f8fafc", color: "#334155" }}>
                    <th style={thStyle}>Drug</th>
                    <th style={thStyle}>Barcode</th>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Unit Cost</th>
                    <th style={thStyle}>Expiry Date</th>
                    <th style={thStyle}>Batch</th>
                    <th style={thStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => (
                    <tr
                      key={item.id}
                      style={{ borderBottom: "1px solid #e2e8f0" }}
                    >
                      <td style={tdStyle}>{item.drug_name}</td>
                      <td style={tdStyle}>{item.barcode || "-"}</td>
                      <td style={tdStyle}>{item.quantity}</td>
                      <td style={tdStyle}>{formatCurrency(item.unit_cost)}</td>
                      <td style={tdStyle}>{item.expiry_date || "-"}</td>
                      <td style={tdStyle}>{item.batch_no || "-"}</td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => editDrug(item)}
                            style={smallEditBtn}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteDrug(item.id)}
                            style={smallDeleteBtn}
                          >
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
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #dbe3ee",
        borderRadius: 18,
        padding: 18,
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: "#64748b",
          marginBottom: 14,
          textAlign: "center",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 900,
          color: "#0f172a",
          textAlign: "center",
        }}
      >
        {value}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  fontSize: 15,
  background: "#fff",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  marginBottom: 8,
  fontWeight: 700,
  color: "#334155",
};

const thStyle = {
  textAlign: "left",
  padding: "12px 10px",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 800,
};

const tdStyle = {
  padding: "12px 10px",
  color: "#0f172a",
  verticalAlign: "middle",
};

const primaryBtnStyle = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtnStyle = {
  background: "#fff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const smallEditBtn = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};

const smallDeleteBtn = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};