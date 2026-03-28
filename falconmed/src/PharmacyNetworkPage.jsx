import React, { useEffect, useMemo, useState } from "react";
import InsightCard from "./components/InsightCard";
import SkeletonCard from "./components/SkeletonCard";
import { supabase } from "./lib/supabaseClient";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";
import { useAnimatedCounter } from "./hooks/useAnimatedCounter";

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
        _isEven: index % 2 === 0,
      })),
    [inventory]
  );

  const imbalanceInsight = useMemo(() => {
    if (loading || groupedByPharmacy.length < 2) return null;

    const activeGroups = groupedByPharmacy.filter((group) => group.items.length > 0);
    if (activeGroups.length < 2) return null;

    const sorted = [...activeGroups].sort((a, b) => b.totalQty - a.totalQty);
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];
    const qtyDiff = Number(highest.totalQty || 0) - Number(lowest.totalQty || 0);

    if (qtyDiff < 40) return null;

    return {
      icon: "⇅",
      tone: "info",
      title: "Smart Insight: Stock Imbalance",
      message: `${highest.pharmacy?.name || "Top site"} carries ${Number(highest.totalQty || 0).toLocaleString()} units vs ${Number(
        lowest.totalQty || 0
      ).toLocaleString()} at ${lowest.pharmacy?.name || "lowest site"}. Consider balancing transfer opportunities.`,
    };
  }, [groupedByPharmacy, loading]);

  return (
    <div style={page}>
      {/* Page header */}
      <div style={pageHeaderRow}>
        <div>
          <h1 style={pageTitle}>Pharmacy Network</h1>
          <p style={pageSub}>View active pharmacies and their inventory records across FalconMed.</p>
        </div>
      </div>

      {error ? (
        <div style={errorBanner}>{error}</div>
      ) : null}

      {/* KPI row */}
      <div style={kpiGrid}>
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard
              key={`pharmacy-kpi-skeleton-${index}`}
              style={{ ...metricCard, borderTop: "4px solid #e2e8f0", minHeight: 116 }}
              blocks={[
                { width: "42%", height: 10, gap: 12 },
                { width: index === 3 ? "68%" : "48%", height: 32, gap: 12 },
                { width: "74%", height: 10, gap: 0 },
              ]}
            />
          ))
        ) : (
          <>
            <MetricCard label="TOTAL PHARMACIES" value={pharmacies.length} accent="#3b82f6" hint="registered" />
            <MetricCard label="INVENTORY RECORDS" value={inventory.length} accent="#8b5cf6" hint="line items" />
            <MetricCard label="TOTAL STOCK QTY" value={totalInventoryQty} accent="#10b981" hint="units on hand" />
            <MetricCard label="TOTAL STOCK VALUE" value={totalInventoryValue} valueFn={formatCurrency} accent="#f59e0b" hint="estimated value" />
          </>
        )}
      </div>

      {/* Content columns */}
      {imbalanceInsight && (
        <InsightCard
          icon={imbalanceInsight.icon}
          tone={imbalanceInsight.tone}
          title={imbalanceInsight.title}
          message={imbalanceInsight.message}
          style={{ marginBottom: 18 }}
        />
      )}

      <div style={contentGrid}>
        {/* Pharmacy list */}
        <div style={contentCard}>
          <h2 style={sectionTitle}>Pharmacies</h2>
          {loading ? (
            <div style={pharmacyList}>
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonCard
                  key={`pharmacy-card-skeleton-${index}`}
                  style={{ ...pharmacyCard, borderTop: "3px solid #e2e8f0", minHeight: 116 }}
                  blocks={[
                    { width: "58%", height: 16, gap: 14 },
                    { width: "90%", height: 10, gap: 10 },
                    { width: "82%", height: 10, gap: 10 },
                    { width: "74%", height: 10, gap: 0 },
                  ]}
                />
              ))}
            </div>
          ) : pharmacies.length === 0 ? (
            <div style={emptyStateBox}>
              <p style={{ margin: 0, fontWeight: 600, color: "#475569" }}>No pharmacies found</p>
              <p style={{ margin: "6px 0 0 0", color: "#94a3b8", fontSize: 13 }}>Add pharmacies to see them here</p>
            </div>
          ) : (
            <div style={pharmacyList}>
              {groupedByPharmacy.map((group) => (
                <div className="ui-hover-lift" key={group.pharmacy.id} style={pharmacyCard}>
                  <div style={pharmacyNameRow}>
                    <span style={pharmacyNameText}>{group.pharmacy.name}</span>
                    <span style={pharmacyItemsBadge}>{group.items.length} items</span>
                  </div>
                  {group.pharmacy.location && (
                    <div style={pharmacyMetaRow}>
                      <span style={pharmacyMetaLabel}>Location</span>
                      <span style={pharmacyMetaValue}>{group.pharmacy.location}</span>
                    </div>
                  )}
                  <div style={pharmacyMetaRow}>
                    <span style={pharmacyMetaLabel}>Total Qty</span>
                    <span style={pharmacyMetaValue}>{group.totalQty}</span>
                  </div>
                  <div style={{ ...pharmacyMetaRow, marginBottom: 0 }}>
                    <span style={pharmacyMetaLabel}>Stock Value</span>
                    <span style={{ ...pharmacyMetaValue, fontWeight: 700, color: "#0f172a" }}>{formatCurrency(group.totalValue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inventory table */}
        <div style={contentCard}>
          <h2 style={sectionTitle}>Pharmacy Inventory</h2>
          {loading ? (
            <div style={tableWrap}>
              <div style={{ padding: 16, display: "grid", gap: 10 }}>
                <SkeletonCard
                  style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
                  blocks={[
                    { width: "100%", height: 38, gap: 10, radius: 10 },
                    { width: "100%", height: 38, gap: 10, radius: 10 },
                    { width: "100%", height: 38, gap: 10, radius: 10 },
                    { width: "100%", height: 38, gap: 10, radius: 10 },
                    { width: "100%", height: 38, gap: 0, radius: 10 },
                  ]}
                />
              </div>
            </div>
          ) : inventory.length === 0 ? (
            <div style={emptyStateBox}>
              <p style={{ margin: 0, fontWeight: 600, color: "#475569" }}>No inventory records</p>
              <p style={{ margin: "6px 0 0 0", color: "#94a3b8", fontSize: 13 }}>Inventory will appear here once synced</p>
            </div>
          ) : (
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
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
                    <tr key={item.id} style={{ background: item._isEven ? "white" : "#f9fafb" }}>
                      <td style={tdStyle}>{pharmacyMap[item.pharmacy_id]?.name || "-"}</td>
                      <td style={{ ...tdStyle, fontWeight: 700, color: "#0f172a" }}>{item.drug_name || "-"}</td>
                      <td style={{ ...tdStyle, color: "#64748b", fontFamily: "monospace", fontSize: 12 }}>{item.barcode || "-"}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{item.quantity}</td>
                      <td style={tdStyle}>{formatCurrency(item.unit_cost)}</td>
                      <td style={tdStyle}>{item.expiry_date || "-"}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{item.batch_no || "-"}</td>
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

function MetricCard({ label, value, accent, hint, valueFn }) {
  // valueFn: optional formatter fn(animatedNum) → string (e.g. formatCurrency)
  // If value is a raw number, animate it; if pre-formatted string, show as-is
  const numericTarget = typeof value === "number" ? value : 0;
  const animated = useAnimatedCounter(numericTarget);
  const display =
    typeof valueFn === "function"
      ? valueFn(animated)
      : typeof value === "number"
      ? animated.toLocaleString()
      : value;

  return (
    <div className="ui-hover-lift" style={{ ...metricCard, borderTop: `4px solid ${accent}` }}>
      <p style={metricLabel}>{label}</p>
      <p style={metricValue}>{display}</p>
      {hint && <p style={metricHint}>{hint}</p>}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const page = {
  maxWidth: 1400,
  margin: "0 auto",
  padding: 0,
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const pageHeaderRow = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  marginBottom: 28,
  paddingBottom: 20,
  borderBottom: "1px solid #f1f5f9",
};

const pageTitle = {
  margin: 0,
  fontSize: 28,
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const pageSub = {
  margin: "4px 0 0 0",
  fontSize: 14,
  color: "#64748b",
  fontWeight: 400,
};

const errorBanner = {
  background: "#fef2f2",
  color: "#b91c1c",
  borderLeft: "4px solid #ef4444",
  borderRadius: 12,
  padding: "12px 16px",
  marginBottom: 24,
  fontWeight: 600,
  fontSize: 14,
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 14,
  marginBottom: 24,
};

const metricCard = {
  background: "white",
  border: "1px solid #e8edf5",
  borderRadius: 18,
  padding: "22px 20px 18px",
  boxShadow: "0 2px 14px rgba(15,23,42,0.06)",
};

const metricLabel = {
  margin: "0 0 10px 0",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: "#94a3b8",
  textTransform: "uppercase",
};

const metricValue = {
  margin: 0,
  fontSize: 32,
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
  lineHeight: 1.1,
};

const metricHint = {
  margin: "4px 0 0 0",
  fontSize: 12,
  color: "#94a3b8",
};

const contentGrid = {
  display: "grid",
  gridTemplateColumns: "300px 1fr",
  gap: 20,
  alignItems: "start",
};

const contentCard = {
  background: "white",
  border: "1px solid #e8edf5",
  borderRadius: 18,
  padding: "22px 22px 26px",
  boxShadow: "0 2px 14px rgba(15,23,42,0.06)",
};

const sectionTitle = {
  margin: "0 0 16px 0",
  fontSize: 16,
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.01em",
  paddingBottom: 12,
  borderBottom: "1px solid #f1f5f9",
};

const emptyStateBox = {
  background: "#f8fafc",
  border: "1px dashed #cbd5e1",
  borderRadius: 14,
  padding: "28px 20px",
  textAlign: "center",
};

const loadingWrap = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "16px 0",
};

const loadingDot = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#3b82f6",
  display: "inline-block",
};

const pharmacyList = {
  display: "grid",
  gap: 10,
};

const pharmacyCard = {
  border: "1px solid #e8edf5",
  borderTop: "3px solid #3b82f6",
  background: "white",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "0 1px 6px rgba(15,23,42,0.04)",
};

const pharmacyNameRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 10,
};

const pharmacyNameText = {
  fontWeight: 800,
  color: "#0f172a",
  fontSize: 14,
};

const pharmacyItemsBadge = {
  background: "#dbeafe",
  color: "#1e40af",
  borderRadius: 999,
  padding: "2px 9px",
  fontSize: 11,
  fontWeight: 700,
};

const pharmacyMetaRow = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: 5,
};

const pharmacyMetaLabel = {
  fontSize: 12,
  color: "#94a3b8",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const pharmacyMetaValue = {
  fontSize: 13,
  color: "#334155",
  fontWeight: 500,
};

const tableWrap = {
  overflowX: "auto",
  borderRadius: 12,
  border: "1px solid #e8edf5",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: 13,
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const thStyle = {
  textAlign: "left",
  position: "sticky",
  top: 0,
  zIndex: 1,
  padding: "10px 14px",
  background: "#f8fafc",
  borderBottom: "1px solid #f1f5f9",
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "#64748b",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "12px 14px",
  color: "#334155",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f8fafc",
};