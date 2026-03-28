import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";

function formatCurrency(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "AED 0.00";
  return `AED ${n.toFixed(2)}`;
}

function toSafeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

    try {
      const { data: pharmacyData, error: pharmacyError } = await loadPharmaciesWithFallback();

      if (pharmacyError) {
        setError("Live pharmacies unavailable. Showing restored demo pharmacies.");
      }

      if (!supabase) {
        setPharmacies(pharmacyData || []);
        setInventory([]);
        return;
      }

      const { data: inventoryData, error: inventoryError } = await supabase
        .from("pharmacy_inventory")
        .select("*")
        .order("created_at", { ascending: false });

      if (inventoryError) {
        setError(inventoryError.message || "Failed to load pharmacy inventory.");
        return;
      }

      setPharmacies(pharmacyData || []);
      setInventory((inventoryData || []).map(normalizeInventoryRow));
    } catch (loadError) {
      console.error("Pharmacy network load error:", loadError);
      setError("Unexpected error while loading pharmacy network data.");
    } finally {
      setLoading(false);
    }
  }

  const pharmacyMap = useMemo(() => {
    const map = {};
    for (const p of pharmacies) {
      map[p.id] = p;
    }
    return map;
  }, [pharmacies]);

  const totalInventoryQty = useMemo(
    () => inventory.reduce((sum, item) => sum + toSafeNumber(item.quantity), 0),
    [inventory]
  );

  const totalInventoryValue = useMemo(
    () =>
      inventory.reduce(
        (sum, item) => sum + toSafeNumber(item.quantity) * toSafeNumber(item.unit_cost),
        0
      ),
    [inventory]
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
      groups[key].totalQty += toSafeNumber(item.quantity);
      groups[key].totalValue += toSafeNumber(item.quantity) * toSafeNumber(item.unit_cost);
    }

    return Object.values(groups);
  }, [pharmacies, inventory]);

  const inventoryRows = useMemo(
    () =>
      inventory.map((item, index) => ({
        ...item,
        rowBackground: index % 2 === 0 ? "#ffffff" : "#f8fafc",
      })),
    [inventory]
  );

  return (
    <div style={pageWrap}>
      <div style={shellCard}>
        <div style={headerWrap}>
          <h1 style={pageTitle}>
            Pharmacy Network
          </h1>
          <p style={pageSubtitle}>
            View active pharmacies and their inventory records across FalconMed.
          </p>
        </div>

        {error ? (
          <div style={errorBanner}>
            {error}
          </div>
        ) : null}

        <div style={metricGrid}>
          <MetricCard label="TOTAL PHARMACIES" value={pharmacies.length} />
          <MetricCard label="INVENTORY RECORDS" value={inventory.length} />
          <MetricCard label="TOTAL STOCK QTY" value={totalInventoryQty} />
          <MetricCard
            label="TOTAL STOCK VALUE"
            value={formatCurrency(totalInventoryValue)}
          />
        </div>

        <div style={contentGrid}>
          <div style={contentCard}>
            <h2 style={sectionTitle}>Pharmacies</h2>

            {pharmacies.length === 0 ? (
              <div style={emptyStateBox}>
                No pharmacies found.
              </div>
            ) : (
              <div style={pharmacyList}>
                {groupedByPharmacy.map((group) => (
                  <div key={group.pharmacy.id} style={pharmacyCard}>
                    <div style={pharmacyName}>
                      {group.pharmacy.name}
                    </div>

                    <div style={pharmacyMeta}>
                      Location: {group.pharmacy.location || "-"}
                    </div>

                    <div style={pharmacyMeta}>
                      Inventory Items: {group.items.length}
                    </div>

                    <div style={pharmacyMeta}>
                      Total Qty: {group.totalQty}
                    </div>

                    <div style={pharmacyValue}>
                      Stock Value: {formatCurrency(group.totalValue)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={contentCard}>
            <h2 style={sectionTitle}>
              Pharmacy Inventory
            </h2>

            {loading ? (
              <div style={loadingText}>Loading...</div>
            ) : inventory.length === 0 ? (
              <div style={emptyStateBox}>
                No inventory records found.
              </div>
            ) : (
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr style={tableHeadRow}>
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
                    {inventoryRows.map((item) => (
                      <tr
                        key={item.id}
                        style={{
                          ...tableRow,
                          background: item.rowBackground,
                        }}
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
    <div style={metricCard}>
      <div style={metricLabel}>
        {label}
      </div>
      <div style={metricValue}>
        {value}
      </div>
    </div>
  );
}

const pageWrap = {
  padding: 28,
  fontFamily: "Arial, sans-serif",
};

const shellCard = {
  background: "#fff",
  border: "1px solid #dbe3ee",
  borderRadius: 24,
  padding: 28,
  boxShadow: "0 2px 8px rgba(15,23,42,0.03)",
};

const headerWrap = {
  textAlign: "center",
  marginBottom: 24,
};

const pageTitle = {
  margin: 0,
  fontSize: 30,
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const pageSubtitle = {
  color: "#475569",
  fontSize: 15,
  marginTop: 10,
  marginBottom: 0,
};

const errorBanner = {
  background: "#fde7e7",
  color: "#b42318",
  border: "1px solid #f3b4b4",
  borderRadius: 14,
  padding: "14px 18px",
  marginBottom: 20,
  textAlign: "center",
  fontWeight: 600,
};

const metricGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16,
  marginBottom: 20,
};

const contentGrid = {
  display: "grid",
  gridTemplateColumns: "320px 1fr",
  gap: 20,
  alignItems: "start",
};

const contentCard = {
  background: "#fff",
  border: "1px solid #dbe3ee",
  borderRadius: 20,
  padding: 22,
  minHeight: 420,
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: 16,
  color: "#0f172a",
  fontSize: 20,
  fontWeight: 800,
};

const emptyStateBox = {
  border: "1px dashed #cbd5e1",
  borderRadius: 18,
  padding: 28,
  textAlign: "center",
  color: "#64748b",
  lineHeight: 1.6,
  fontSize: 14,
};

const loadingText = {
  color: "#64748b",
  fontSize: 14,
};

const pharmacyList = {
  display: "grid",
  gap: 12,
};

const pharmacyCard = {
  border: "1px solid #dbe3ee",
  background: "#fff",
  borderRadius: 16,
  padding: 14,
};

const pharmacyName = {
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 6,
  fontSize: 15,
};

const pharmacyMeta = {
  fontSize: 13,
  color: "#64748b",
  marginBottom: 4,
};

const pharmacyValue = {
  fontSize: 13,
  color: "#0f172a",
  fontWeight: 700,
};

const metricCard = {
  background: "#fff",
  border: "1px solid #dbe3ee",
  borderRadius: 18,
  padding: 18,
  minHeight: 110,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const metricLabel = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  color: "#64748b",
  marginBottom: 14,
  textAlign: "center",
};

const metricValue = {
  fontSize: 28,
  fontWeight: 900,
  color: "#0f172a",
  textAlign: "center",
};

const tableWrap = {
  overflowX: "auto",
  border: "1px solid #e2e8f0",
  borderRadius: 14,
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: 13,
};

const tableHeadRow = {
  background: "#f8fafc",
  color: "#334155",
};

const tableRow = {
  borderBottom: "1px solid #e2e8f0",
};

const thStyle = {
  textAlign: "left",
  position: "sticky",
  top: 0,
  zIndex: 1,
  padding: "12px 12px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: "0.04em",
};

const tdStyle = {
  padding: "12px 12px",
  color: "#0f172a",
  verticalAlign: "middle",
  fontSize: 13,
};