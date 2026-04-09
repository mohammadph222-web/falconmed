import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import WorkspacePharmacySelector from "./components/WorkspacePharmacySelector";
import {
  resolveWorkspacePharmacies,
  resolveWorkspaceSelection,
  writeWorkspacePharmacyId,
} from "./lib/workspacePharmacy";
import { formatAed, formatQty, isNearExpiry } from "./utils/inventoryAnalytics";

function isLowStock(value) {
  const qty = Number(value || 0);
  return Number.isFinite(qty) && qty > 0 && qty <= 10;
}

export default function SinglePharmacyDashboard() {
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [inventoryRows, setInventoryRows] = useState([]);
  const [recentMovements, setRecentMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");

      try {
        if (!supabase) {
          const options = resolveWorkspacePharmacies([]);
          setPharmacies(options);
          const selected = resolveWorkspaceSelection(options, "");
          setSelectedPharmacyId(selected);
          setInventoryRows([]);
          setRecentMovements([]);
          return;
        }

        const [{ data: pharmacyRows }, { data: inventory }, { data: movements }] = await Promise.all([
          supabase.from("pharmacies").select("id,name,location").order("name", { ascending: true }),
          supabase
            .from("pharmacy_inventory")
            .select("pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
            .order("created_at", { ascending: false })
            .limit(5000),
          supabase
            .from("stock_movements")
            .select("id,movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

        const options = resolveWorkspacePharmacies(pharmacyRows || []);
        const selected = resolveWorkspaceSelection(options, selectedPharmacyId);
        setPharmacies(options);
        setSelectedPharmacyId(selected);

        const filteredInventory = (inventory || []).filter(
          (row) => String(row?.pharmacy_id || "").trim() === selected
        );

        const selectedName = options.find((option) => option.id === selected)?.name || "";

        const filteredMovements = (movements || []).filter((row) => {
          const fromName = String(row?.from_pharmacy || "").trim();
          const toName = String(row?.to_pharmacy || "").trim();
          if (!selectedName) return false;
          return fromName === selectedName || toName === selectedName;
        });

        setInventoryRows(filteredInventory);
        setRecentMovements(filteredMovements.slice(0, 8));
      } catch {
        setError("Unable to load single pharmacy dashboard right now.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const onSelectPharmacy = (pharmacyId) => {
    setSelectedPharmacyId(pharmacyId);
    writeWorkspacePharmacyId(pharmacyId);

    if (!supabase) return;

    const loadForPharmacy = async () => {
      setLoading(true);
      try {
        const [{ data: inventory }, { data: movements }] = await Promise.all([
          supabase
            .from("pharmacy_inventory")
            .select("pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
            .eq("pharmacy_id", pharmacyId)
            .order("created_at", { ascending: false })
            .limit(5000),
          supabase
            .from("stock_movements")
            .select("id,movement_type,drug_name,quantity,from_pharmacy,to_pharmacy,created_at")
            .order("created_at", { ascending: false })
            .limit(40),
        ]);

        const selectedName = pharmacies.find((item) => item.id === pharmacyId)?.name || "";
        const filteredMovements = (movements || []).filter((row) => {
          const fromName = String(row?.from_pharmacy || "").trim();
          const toName = String(row?.to_pharmacy || "").trim();
          if (!selectedName) return false;
          return fromName === selectedName || toName === selectedName;
        });

        setInventoryRows(inventory || []);
        setRecentMovements(filteredMovements.slice(0, 8));
      } catch {
        setError("Unable to refresh selected pharmacy data.");
      } finally {
        setLoading(false);
      }
    };

    void loadForPharmacy();
  };

  const metrics = useMemo(() => {
    const totalQty = inventoryRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
    const totalValue = inventoryRows.reduce(
      (sum, row) => sum + Number(row?.quantity || 0) * Number(row?.unit_cost || 0),
      0
    );
    const nearExpiryCount = inventoryRows.reduce(
      (sum, row) => sum + (isNearExpiry(row?.expiry_date) ? 1 : 0),
      0
    );
    const lowStockCount = inventoryRows.reduce(
      (sum, row) => sum + (isLowStock(row?.quantity) ? 1 : 0),
      0
    );

    return {
      totalQty,
      totalValue,
      nearExpiryCount,
      lowStockCount,
    };
  }, [inventoryRows]);

  return (
    <div style={pageWrap}>
      <div style={heroCard}>
        <div style={heroContent}>
          <h1 style={heroTitle}>Single Pharmacy Dashboard</h1>
          <p style={heroSub}>Operational control for one pharmacy at a time.</p>
        </div>
        <div style={selectorWrap}>
          <WorkspacePharmacySelector
            options={pharmacies}
            value={selectedPharmacyId}
            onChange={onSelectPharmacy}
            label="Active Pharmacy"
          />
        </div>
      </div>

      {error ? <div style={errorBox}>{error}</div> : null}

      <div style={kpiGrid}>
        <div style={kpiCard}><div style={kpiLabel}>Total Stock Qty</div><div style={kpiValue}>{formatQty(metrics.totalQty)}</div></div>
        <div style={kpiCard}><div style={kpiLabel}>Total Stock Value</div><div style={kpiValue}>{formatAed(metrics.totalValue)}</div></div>
        <div style={kpiCard}><div style={kpiLabel}>Near Expiry</div><div style={kpiValue}>{formatQty(metrics.nearExpiryCount)}</div></div>
        <div style={kpiCard}><div style={kpiLabel}>Low Stock</div><div style={kpiValue}>{formatQty(metrics.lowStockCount)}</div></div>
      </div>

      <div style={contentGrid}>
        <div style={panel}>
          <h3 style={panelTitle}>Recent Stock Movements</h3>
          {loading ? (
            <div style={empty}>Loading recent movements...</div>
          ) : recentMovements.length === 0 ? (
            <div style={empty}>No recent movement found for the selected pharmacy.</div>
          ) : (
            <div style={listWrap} className="movements-feed">
              {recentMovements.map((item) => (
                <div key={item.id} style={listItem} className="movements-feed-item">
                  <div style={movementHead}>
                    <strong style={movementType}>{item.movement_type || "Movement"}</strong>
                    <span style={movementQty}>Qty {formatQty(item.quantity || 0)}</span>
                  </div>
                  <span style={movementDrug}>{item.drug_name || "-"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={panel}>
          <h3 style={panelTitle}>Quick Actions</h3>
          <div style={quickGrid}>
            <div style={quickCard} className="quick-action-item"><span style={quickText}>Receive stock with batch and expiry details</span><span style={quickMeta}>-&gt;</span></div>
            <div style={quickCard} className="quick-action-item"><span style={quickText}>Dispense from existing inventory rows</span><span style={quickMeta}>-&gt;</span></div>
            <div style={quickCard} className="quick-action-item"><span style={quickText}>Review low stock lines and near expiry lines</span><span style={quickMeta}>-&gt;</span></div>
            <div style={quickCard} className="quick-action-item"><span style={quickText}>Open Inventory Overview for full table operations</span><span style={quickMeta}>-&gt;</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const tokens = {
  bg: "#f3f6fb",
  card: "#ffffff",
  border: "#e2e8f0",
  borderSoft: "#edf2f7",
  text: "#0f172a",
  muted: "#475569",
  subtle: "#64748b",
  primary: "#2563eb",
};

const pageWrap = {
  display: "grid",
  gap: "18px",
  padding: "2px 2px 10px",
  background: tokens.bg,
  borderRadius: "14px",
};
const heroCard = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
  background: tokens.card,
  color: tokens.text,
  borderRadius: "14px",
  padding: "16px 18px",
  border: `1px solid ${tokens.border}`,
  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.035)",
};
const heroContent = { minWidth: "250px", flex: "1 1 320px" };
const selectorWrap = {
  minWidth: "220px",
  maxWidth: "300px",
  flex: "0 1 280px",
  padding: "10px 11px",
  borderRadius: "10px",
  border: `1px solid ${tokens.borderSoft}`,
  background: "#fbfdff",
};
const heroTitle = {
  margin: 0,
  fontSize: "30px",
  lineHeight: 1.2,
  letterSpacing: "-0.02em",
  color: tokens.text,
  fontWeight: 760,
};
const heroSub = {
  marginTop: "6px",
  marginBottom: 0,
  color: tokens.muted,
  fontSize: "14px",
  lineHeight: 1.45,
  maxWidth: "620px",
};
const errorBox = {
  borderRadius: "12px",
  padding: "11px 13px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  boxShadow: "inset 3px 0 0 #dc2626",
};
const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};
const kpiCard = {
  background: tokens.card,
  borderRadius: "12px",
  border: "1px solid #edf3fa",
  borderTop: "2px solid #dbeafe",
  padding: "16px 18px",
  boxShadow: "0 4px 10px rgba(15, 23, 42, 0.025)",
};
const kpiLabel = {
  fontSize: "9px",
  color: "#94a3b8",
  textTransform: "uppercase",
  fontWeight: 700,
  letterSpacing: "0.09em",
};
const kpiValue = {
  marginTop: "11px",
  fontSize: "36px",
  fontWeight: 750,
  color: tokens.text,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.025em",
  lineHeight: 1.1,
};
const contentGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
  gap: "12px",
};
const panel = {
  background: tokens.card,
  borderRadius: "12px",
  border: `1px solid ${tokens.borderSoft}`,
  padding: "16px",
  boxShadow: "0 5px 12px rgba(15, 23, 42, 0.03)",
};
const panelTitle = {
  marginTop: 0,
  marginBottom: "12px",
  color: tokens.text,
  fontSize: "17px",
  fontWeight: 700,
  letterSpacing: "-0.01em",
};
const listWrap = { display: "grid", gap: "10px" };
const listItem = {
  display: "grid",
  gap: "8px",
  border: "1px solid #eef3f8",
  borderRadius: "10px",
  padding: "13px 14px",
  fontSize: "13px",
  color: tokens.muted,
  background: "#fcfeff",
  transition: "border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease",
};
const movementHead = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
};
const movementType = {
  color: tokens.subtle,
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
};
const movementQty = {
  fontSize: "11px",
  color: "#1e40af",
  background: "#f5f9ff",
  border: "1px solid #e6eefc",
  borderRadius: "999px",
  padding: "4px 10px",
  fontWeight: 600,
  whiteSpace: "nowrap",
  lineHeight: 1,
};
const movementDrug = {
  color: tokens.text,
  lineHeight: 1.42,
  fontWeight: 600,
  fontSize: "14px",
  wordBreak: "break-word",
};
const quickGrid = { display: "grid", gap: "12px" };
const quickCard = {
  border: "1px solid #edf2f8",
  borderRadius: "10px",
  padding: "13px 14px",
  background: "linear-gradient(180deg, #ffffff 0%, #fcfeff 100%)",
  color: tokens.text,
  fontWeight: 600,
  fontSize: "13px",
  lineHeight: 1.45,
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: "10px",
  boxShadow: "0 1px 4px rgba(15, 23, 42, 0.02)",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
};
const quickText = {
  color: tokens.text,
};
const quickMeta = {
  fontSize: "12px",
  color: "#1d4ed8",
  letterSpacing: "0.02em",
  fontWeight: 700,
  lineHeight: 1,
};
const empty = { color: tokens.subtle, fontSize: "13px" };
