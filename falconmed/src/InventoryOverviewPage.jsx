import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import WorkspacePharmacySelector from "./components/WorkspacePharmacySelector";
import {
  resolveWorkspacePharmacies,
  resolveWorkspaceSelection,
  writeWorkspacePharmacyId,
} from "./lib/workspacePharmacy";
import { formatAed, formatQty } from "./utils/inventoryAnalytics";

export default function InventoryOverviewPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const loadData = async (nextPharmacyId = "") => {
    setLoading(true);

    if (!supabase) {
      const options = resolveWorkspacePharmacies([]);
      const selected = resolveWorkspaceSelection(options, nextPharmacyId);
      setPharmacies(options);
      setSelectedPharmacyId(selected);
      setRows([]);
      setLoading(false);
      return;
    }

    const [{ data: pharmacyRows }, { data: inventoryRows }] = await Promise.all([
      supabase.from("pharmacies").select("id,name,location").order("name", { ascending: true }),
      supabase
        .from("pharmacy_inventory")
        .select("id,pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
        .order("drug_name", { ascending: true })
        .limit(5000),
    ]);

    const options = resolveWorkspacePharmacies(pharmacyRows || []);
    const selected = resolveWorkspaceSelection(options, nextPharmacyId || selectedPharmacyId);
    setPharmacies(options);
    setSelectedPharmacyId(selected);
    writeWorkspacePharmacyId(selected);

    const filtered = (inventoryRows || []).filter((row) => String(row?.pharmacy_id || "").trim() === selected);
    setRows(filtered);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const viewRows = useMemo(() => {
    const search = String(query || "").trim().toLowerCase();

    return rows.filter((row) => {
      const expiry = String(row?.expiry_date || "").trim();
      const matchesExpiry =
        expiryFilter === "all" ||
        (expiryFilter === "with-expiry" && Boolean(expiry)) ||
        (expiryFilter === "without-expiry" && !expiry);

      if (!matchesExpiry) return false;
      if (!search) return true;

      const text = [
        row?.drug_name,
        row?.batch_no,
        row?.barcode,
        row?.expiry_date,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return text.includes(search);
    });
  }, [expiryFilter, query, rows]);

  const summary = useMemo(() => {
    const totalQty = viewRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
    const totalValue = viewRows.reduce(
      (sum, row) => sum + Number(row?.quantity || 0) * Number(row?.unit_cost || 0),
      0
    );

    return {
      lines: viewRows.length,
      totalQty,
      totalValue,
    };
  }, [viewRows]);

  const onSelectPharmacy = (pharmacyId) => {
    writeWorkspacePharmacyId(pharmacyId);
    void loadData(pharmacyId);
  };

  return (
    <div style={pageWrap}>
      <div style={heroCard}>
        <div>
          <h1 style={heroTitle}>Inventory Overview</h1>
          <p style={heroSub}>Premium operational view for one pharmacy workspace.</p>
        </div>
        <WorkspacePharmacySelector
          options={pharmacies}
          value={selectedPharmacyId}
          onChange={onSelectPharmacy}
          label="Active Pharmacy"
        />
      </div>

      <div style={filterBar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={searchInput}
          placeholder="Search by drug, batch, barcode, expiry"
        />
        <select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)} style={selectInput}>
          <option value="all">All expiry states</option>
          <option value="with-expiry">With expiry date</option>
          <option value="without-expiry">Without expiry date</option>
        </select>
      </div>

      <div style={summaryGrid}>
        <div style={summaryCard}><div style={summaryLabel}>Filtered Lines</div><div style={summaryValue}>{formatQty(summary.lines)}</div></div>
        <div style={summaryCard}><div style={summaryLabel}>Total Qty</div><div style={summaryValue}>{formatQty(summary.totalQty)}</div></div>
        <div style={summaryCard}><div style={summaryLabel}>Total Stock Value</div><div style={summaryValue}>{formatAed(summary.totalValue)}</div></div>
      </div>

      <div style={tableWrap}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Drug</th>
              <th style={th}>Qty</th>
              <th style={th}>Batch</th>
              <th style={th}>Expiry</th>
              <th style={th}>Barcode</th>
              <th style={th}>Unit Cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td style={emptyCell} colSpan={6}>Loading inventory...</td></tr>
            ) : viewRows.length === 0 ? (
              <tr><td style={emptyCell} colSpan={6}>No inventory rows found.</td></tr>
            ) : (
              viewRows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStrong}>{row.drug_name || "-"}</td>
                  <td style={td}>{formatQty(row.quantity || 0)}</td>
                  <td style={td}>{row.batch_no || "-"}</td>
                  <td style={td}>{row.expiry_date || "-"}</td>
                  <td style={td}>{row.barcode || "-"}</td>
                  <td style={td}>{formatAed(row.unit_cost || 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const pageWrap = { display: "grid", gap: "14px" };
const heroCard = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  background: "linear-gradient(120deg, #111827 0%, #1d4ed8 55%, #0284c7 100%)",
  color: "#f8fafc",
  borderRadius: "14px",
  padding: "16px",
};
const heroTitle = { margin: 0, fontSize: "24px" };
const heroSub = { marginTop: "6px", marginBottom: 0, opacity: 0.9 };
const filterBar = { display: "grid", gridTemplateColumns: "1fr 220px", gap: "10px" };
const searchInput = {
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px",
  fontSize: "13px",
};
const selectInput = {
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px",
  fontSize: "13px",
};
const summaryGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" };
const summaryCard = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px" };
const summaryLabel = { fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 };
const summaryValue = { marginTop: "8px", fontSize: "22px", fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" };
const tableWrap = { overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px" };
const table = { width: "100%", borderCollapse: "collapse" };
const th = { textAlign: "left", borderBottom: "1px solid #cbd5e1", padding: "10px", fontSize: "12px", color: "#334155" };
const td = { borderBottom: "1px solid #e2e8f0", padding: "10px", fontSize: "12px", color: "#0f172a" };
const tdStrong = { ...td, fontWeight: 700 };
const emptyCell = { ...td, textAlign: "center", color: "#64748b" };
