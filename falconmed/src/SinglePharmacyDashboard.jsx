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
        <div>
          <h1 style={heroTitle}>Single Pharmacy Dashboard</h1>
          <p style={heroSub}>Operational control for one pharmacy at a time.</p>
        </div>
        <WorkspacePharmacySelector
          options={pharmacies}
          value={selectedPharmacyId}
          onChange={onSelectPharmacy}
          label="Active Pharmacy"
        />
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
            <div style={listWrap}>
              {recentMovements.map((item) => (
                <div key={item.id} style={listItem}>
                  <strong>{item.movement_type || "Movement"}</strong>
                  <span>{item.drug_name || "-"} | Qty {formatQty(item.quantity || 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={panel}>
          <h3 style={panelTitle}>Quick Actions</h3>
          <div style={quickGrid}>
            <div style={quickCard}>Receive stock with batch and expiry details</div>
            <div style={quickCard}>Dispense from existing inventory rows</div>
            <div style={quickCard}>Review low stock lines and near expiry lines</div>
            <div style={quickCard}>Open Inventory Overview for full table operations</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const pageWrap = { display: "grid", gap: "16px" };
const heroCard = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "14px",
  background: "linear-gradient(135deg, #0b1326 0%, #1d4ed8 55%, #0ea5e9 100%)",
  color: "#f8fafc",
  borderRadius: "16px",
  padding: "18px",
};
const heroTitle = { margin: 0, fontSize: "24px" };
const heroSub = { marginTop: "6px", marginBottom: 0, opacity: 0.9 };
const errorBox = {
  borderRadius: "10px",
  padding: "10px 12px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  boxShadow: "inset 4px 0 0 #dc2626",
};
const kpiGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" };
const kpiCard = { background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "14px" };
const kpiLabel = { fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 };
const kpiValue = { marginTop: "8px", fontSize: "24px", fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" };
const contentGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" };
const panel = { background: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0", padding: "14px" };
const panelTitle = { marginTop: 0, marginBottom: "10px", color: "#0f172a" };
const listWrap = { display: "grid", gap: "8px" };
const listItem = {
  display: "grid",
  gap: "3px",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  padding: "9px 10px",
  fontSize: "13px",
  color: "#334155",
};
const quickGrid = { display: "grid", gap: "8px" };
const quickCard = {
  border: "1px solid #bfdbfe",
  borderRadius: "10px",
  padding: "10px",
  background: "#eff6ff",
  color: "#1e3a8a",
  fontWeight: 600,
  fontSize: "13px",
};
const empty = { color: "#64748b", fontSize: "13px" };
