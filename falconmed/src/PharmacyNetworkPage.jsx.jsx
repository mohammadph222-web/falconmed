import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

export default function PharmacyNetwork() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    const { data: pharmacyData, error: pharmacyError } = await loadPharmaciesWithFallback();

    if (pharmacyError) {
      setError("Live pharmacies unavailable. Showing restored demo pharmacies.");
    }

    if (!supabase) {
      setPharmacies(pharmacyData || []);
      setInventory([]);
      setLoading(false);
      return;
    }

    const { data: inventoryData, error: inventoryError } = await supabase
      .from("pharmacy_inventory")
      .select("*")
      .order("created_at", { ascending: false });

    if (inventoryError) {
      setError(inventoryError.message);
      setLoading(false);
      return;
    }

    setPharmacies(pharmacyData || []);
    setInventory((inventoryData || []).map(normalizeInventoryRow));
    setLoading(false);
  }

  const pharmacyMap = useMemo(() => {
    const map = {};
    for (const p of pharmacies) {
      map[p.id] = p;
    }
    return map;
  }, [pharmacies]);

  const totalInventoryQty = inventory.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );

  const totalInventoryValue = inventory.reduce(
    (sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
    0
  );

  const groupedByPharmacy = useMemo(() => {
    const groups = {};
    for (const p of pharmacies) {
      groups[p.id] = {
        pharmacy: p,
        items: [],
        totalQty: 0,
        totalValue: 0,
      };
    }

    for (const item of inventory) {
      const key = item.pharmacy_id;
      if (!groups[key]) continue;

      groups[key].items.push(item);
      groups[key].totalQty += Number(item.quantity || 0);
      groups[key].totalValue +=
        Number(item.quantity || 0) * Number(item.unit_cost || 0);
    }

    return Object.values(groups);
  }, [pharmacies, inventory]);

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
            Pharmacy Network
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
          View active pharmacies and their inventory records across FalconMed.
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <MetricCard label="TOTAL PHARMACIES" value={pharmacies.length} />
          <MetricCard label="INVENTORY RECORDS" value={inventory.length} />
          <MetricCard label="TOTAL STOCK QTY" value={totalInventoryQty} />
          <MetricCard
            label="TOTAL STOCK VALUE"
            value={formatCurrency(totalInventoryValue)}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe3ee",
              borderRadius: 20,
              padding: 22,
              minHeight: 420,
            }}
          >
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>Pharmacies</h2>

            {pharmacies.length === 0 ? (
              <div
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: 18,
                  padding: 28,
                  textAlign: "center",
                  color: "#64748b",
                  lineHeight: 1.6,
                }}
              >
                No pharmacies found.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {groupedByPharmacy.map((group) => (
                  <div
                    key={group.pharmacy.id}
                    style={{
                      border: "1px solid #dbe3ee",
                      background: "#fff",
                      borderRadius: 16,
                      padding: 14,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0f172a",
                        marginBottom: 6,
                      }}
                    >
                      {group.pharmacy.name}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#64748b",
                        marginBottom: 6,
                      }}
                    >
                      Location: {group.pharmacy.location || "-"}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#64748b",
                        marginBottom: 4,
                      }}
                    >
                      Inventory Items: {group.items.length}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#64748b",
                        marginBottom: 4,
                      }}
                    >
                      Total Qty: {group.totalQty}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#0f172a",
                        fontWeight: 700,
                      }}
                    >
                      Stock Value: {formatCurrency(group.totalValue)}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>
              Pharmacy Inventory
            </h2>

            {loading ? (
              <div style={{ color: "#64748b" }}>Loading...</div>
            ) : inventory.length === 0 ? (
              <div
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: 18,
                  padding: 28,
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                No inventory records found.
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
                      <th style={thStyle}>Pharmacy</th>
                      <th style={thStyle}>Drug</th>
                      <th style={thStyle}>Barcode</th>
                      <th style={thStyle}>Quantity</th>
                      <th style={thStyle}>Unit Cost</th>
                      <th style={thStyle}>Expiry Date</th>
                      <th style={thStyle}>Batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((item) => (
                      <tr
                        key={item.id}
                        style={{ borderBottom: "1px solid #e2e8f0" }}
                      >
                        <td style={tdStyle}>
                          {pharmacyMap[item.pharmacy_id]?.name || "-"}
                        </td>
                        <td style={tdStyle}>{item.drug_name || "-"}</td>
                        <td style={tdStyle}>{item.barcode || "-"}</td>
                        <td style={tdStyle}>{item.quantity}</td>
                        <td style={tdStyle}>
                          {formatCurrency(item.unit_cost)}
                        </td>
                        <td style={tdStyle}>{item.expiry_date || "-"}</td>
                        <td style={tdStyle}>{item.batch_no || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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