import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { ActionButton, PageHeader, StatusPill } from "./ui";

// ── Pure helpers ───────────────────────────────────────────────────────────

function text(value) {
  return String(value || "").trim();
}

function displayDrug(row) {
  return text(row?.drug_name) || text(row?.drug_code) || "Unnamed Drug";
}

function parseBulkLines(rawText) {
  const lines = rawText.split("\n");
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const commaIdx = raw.lastIndexOf(",");
    if (commaIdx === -1) {
      result.push({ lineNo: i + 1, rawDrug: raw, rawQty: "", qty: 0, error: "Missing quantity — add comma then number" });
      continue;
    }
    const rawDrug = text(raw.slice(0, commaIdx));
    const rawQty = text(raw.slice(commaIdx + 1));
    if (!rawDrug) {
      result.push({ lineNo: i + 1, rawDrug: "", rawQty, qty: 0, error: "Missing drug name or code" });
      continue;
    }
    const qty = Number(rawQty);
    if (!rawQty || !Number.isFinite(qty) || qty <= 0) {
      result.push({ lineNo: i + 1, rawDrug, rawQty, qty: 0, error: "Quantity must be a positive number" });
      continue;
    }
    result.push({ lineNo: i + 1, rawDrug, rawQty, qty, error: null });
  }
  return result;
}

function matchDrug(inventory, rawDrug) {
  const q = text(rawDrug).toLowerCase();
  if (!q) return { row: null, confidence: "not_found" };

  // 1. exact drug_code
  let row = inventory.find(
    (r) => text(r.drug_code).toLowerCase() === q && Number(r.quantity) > 0
  );
  if (row) return { row, confidence: "exact" };

  // 2. exact drug_name
  row = inventory.find(
    (r) => text(r.drug_name).toLowerCase() === q && Number(r.quantity) > 0
  );
  if (row) return { row, confidence: "exact" };

  // 3. contains drug_code — only safe when single match
  const codeHits = inventory.filter(
    (r) => text(r.drug_code).toLowerCase().includes(q) && Number(r.quantity) > 0
  );
  if (codeHits.length === 1) return { row: codeHits[0], confidence: "contains" };
  if (codeHits.length > 1) return { row: null, confidence: "ambiguous" };

  // 4. contains drug_name — only safe when single match
  const nameHits = inventory.filter(
    (r) => text(r.drug_name).toLowerCase().includes(q) && Number(r.quantity) > 0
  );
  if (nameHits.length === 1) return { row: nameHits[0], confidence: "contains" };
  if (nameHits.length > 1) return { row: null, confidence: "ambiguous" };

  return { row: null, confidence: "not_found" };
}

// ── Style constants ────────────────────────────────────────────────────────

const BADGE = {
  OK:                   { background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  "Insufficient Stock": { background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  "Not Found":          { background: "#fee2e2", color: "#b91c1c", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  "Review Needed":      { background: "#fef9c3", color: "#713f12", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
  "Parse Error":        { background: "#f3f4f6", color: "#4b5563", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" },
};

const ROW_BG = {
  OK:                   "transparent",
  "Insufficient Stock": "#fffbeb",
  "Not Found":          "#fef2f2",
  "Review Needed":      "#fefce8",
  "Parse Error":        "#f9fafb",
};

const S = {
  page: {
    maxWidth: 1240,
    margin: "0 auto",
    display: "grid",
    gap: 14,
  },
  pageHeaderCard: {
    background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
    border: "1px solid #dbe7f5",
    borderRadius: 15,
    padding: "16px 18px",
    boxShadow: "0 12px 24px rgba(15,23,42,0.05)",
  },
  tabs: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  tab: (active) => ({
    padding: "8px 18px",
    borderRadius: 10,
    border: active ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
    cursor: "pointer",
    fontWeight: 700,
    background: active ? "#2563eb" : "#ffffff",
    color: active ? "#ffffff" : "#334155",
    boxShadow: active ? "0 8px 14px rgba(37,99,235,0.22)" : "0 4px 10px rgba(15,23,42,0.04)",
    fontSize: 13,
  }),
  tabSm: (active) => ({
    padding: "7px 14px",
    borderRadius: 10,
    border: active ? "1px solid #1e40af" : "1px solid #cbd5e1",
    cursor: "pointer",
    fontWeight: 700,
    background: active ? "#1e3a8a" : "#ffffff",
    color: active ? "#ffffff" : "#334155",
    boxShadow: active ? "0 8px 14px rgba(30,58,138,0.22)" : "0 4px 10px rgba(15,23,42,0.04)",
    fontSize: 13,
  }),
  card: {
    background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
    border: "1px solid #dbe7f5",
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    boxShadow: "0 12px 24px rgba(15,23,42,0.05)",
  },
  label: { display: "block", fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6, marginTop: 14, textTransform: "uppercase", letterSpacing: "0.05em" },
  labelFirst: { display: "block", fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6, marginTop: 0, textTransform: "uppercase", letterSpacing: "0.05em" },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 14, color: "#0f172a", background: "#fff" },
  select: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 14, background: "#fff", color: "#0f172a" },
  btn: { marginTop: 18, padding: "10px 18px", background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14, boxShadow: "0 8px 16px rgba(37,99,235,0.24)" },
  btnPurple: { marginTop: 0, padding: "10px 18px", background: "linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14, boxShadow: "0 8px 16px rgba(91,33,182,0.24)" },
  btnGhost: { padding: "10px 16px", background: "#fff", color: "#374151", border: "1px solid #cbd5e1", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13, boxShadow: "0 4px 10px rgba(15,23,42,0.05)" },
  th: { background: "#f8fbff", padding: "11px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", borderBottom: "1px solid #dbe7f5", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em" },
  td: { padding: "11px 12px", borderBottom: "1px solid #edf2fa", color: "#0f172a", fontSize: 13 },
  summary: { background: "#f0f7ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "13px 16px", marginBottom: 14 },
  summaryTitle: { fontWeight: 700, fontSize: 15, marginBottom: 6, color: "#1e40af" },
  summaryMeta: { fontSize: 13, color: "#334155", marginBottom: 2 },
  msgOk: { marginTop: 12, color: "#16a34a", fontWeight: 600, fontSize: 14 },
  msgErr: { marginTop: 12, color: "#dc2626", fontWeight: 600, fontSize: 14 },
  subhead: { marginTop: 0, marginBottom: 5, fontSize: 17, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" },
  hint: { margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.5 },
  textarea: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 13, fontFamily: "monospace", minHeight: 120, resize: "vertical" },
  resultCard: { background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "16px 20px", marginBottom: 16 },
  resultTitle: { fontWeight: 700, fontSize: 15, color: "#15803d", marginBottom: 8 },
  resultRow: { display: "flex", gap: 24, flexWrap: "wrap" },
  resultStat: { fontSize: 14, color: "#374151" },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function StockMovementPage() {
  // Top section: "single" | "bulk"
  const [section, setSection] = useState("single");

  // ── Single movement state ──────────────────────────────────────────────
  const [mode, setMode] = useState("receive"); // "receive" | "dispense"
  const [pharmacies, setPharmacies] = useState([]);
  const [pharmacy, setPharmacy] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", ok: true });

  // receive fields
  const [drugName, setDrugName] = useState("");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");

  // dispense fields
  const [inventory, setInventory] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [dispenseQty, setDispenseQty] = useState("");

  // ── Bulk state ─────────────────────────────────────────────────────────
  const [bulkOp, setBulkOp] = useState("bulk_dispense");
  const [bulkSrc, setBulkSrc] = useState("");
  const [bulkDst, setBulkDst] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    void loadPharmacies();
  }, []);

  // Reset single form on mode change
  useEffect(() => {
    setPharmacy("");
    setMessage({ text: "", ok: true });
    setSearch("");
    setSelectedRow(null);
    setInventory([]);
    setQty("");
    setDispenseQty("");
    setDrugName("");
    setBatch("");
    setExpiry("");
    setBarcode("");
  }, [mode]);

  // Reset bulk when section or operation switches
  useEffect(() => {
    setBulkSrc("");
    setBulkDst("");
    setBulkText("");
    setBulkPreview(null);
    setBulkResult(null);
    setMessage({ text: "", ok: true });
  }, [section, bulkOp]);

  // Load inventory for single dispense
  useEffect(() => {
    if (section === "single" && mode === "dispense" && pharmacy) {
      void loadInventory(pharmacy);
    } else if (section === "single" && mode === "dispense") {
      setInventory([]);
      setSelectedRow(null);
    }
  }, [section, mode, pharmacy]);

  // ── Data loaders ───────────────────────────────────────────────────────

  async function loadPharmacies() {
    const { data, error } = await supabase.from("pharmacies").select("id, name").order("name");
    if (!error && Array.isArray(data)) setPharmacies(data);
  }

  async function loadInventory(pharmacyId) {
    const { data, error } = await supabase
      .from("pharmacy_inventory")
      .select("id, drug_name, drug_code, batch_no, barcode, expiry_date, quantity")
      .eq("pharmacy_id", pharmacyId)
      .gt("quantity", 0)
      .order("expiry_date", { ascending: true });
    if (!error && Array.isArray(data)) setInventory(data);
    else setInventory([]);
  }

  async function fetchPharmacyInventory(pharmacyId) {
    const { data, error } = await supabase
      .from("pharmacy_inventory")
      .select("id, drug_name, drug_code, batch_no, barcode, expiry_date, quantity")
      .eq("pharmacy_id", pharmacyId)
      .gt("quantity", 0)
      .order("expiry_date", { ascending: true });
    return error ? [] : (data || []);
  }

  // ── Derived ────────────────────────────────────────────────────────────

  const pharmacyName = useMemo(
    () => pharmacies.find((p) => String(p.id) === String(pharmacy))?.name || "",
    [pharmacies, pharmacy]
  );

  const filteredInventory = useMemo(() => {
    const q = text(search).toLowerCase();
    if (!q) return inventory;
    return inventory.filter((row) =>
      [row.drug_name, row.drug_code, row.batch_no, row.barcode]
        .map((v) => text(v).toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [inventory, search]);

  // ── Single movement save ───────────────────────────────────────────────

  function flash(msg, ok = true) {
    setMessage({ text: msg, ok });
  }

  async function handleSave() {
    setMessage({ text: "", ok: true });
    if (!pharmacy) { flash("Select a pharmacy", false); return; }

    if (mode === "receive") {
      if (!text(drugName)) { flash("Enter drug name", false); return; }
      const numQty = Number(qty);
      if (!numQty || numQty <= 0) { flash("Enter a valid quantity", false); return; }
      setBusy(true);
      const { error } = await supabase.from("pharmacy_inventory").insert({
        pharmacy_id: pharmacy,
        drug_name: text(drugName),
        quantity: numQty,
        batch_no: text(batch) || null,
        expiry_date: text(expiry) || null,
        barcode: text(barcode) || null,
      });
      setBusy(false);
      if (error) { flash(error.message, false); return; }
      flash("Stock received successfully");
      setDrugName(""); setBatch(""); setExpiry(""); setBarcode(""); setQty("");
      return;
    }

    if (mode === "dispense") {
      if (!selectedRow) { flash("Select an inventory row", false); return; }
      const numQty = Number(dispenseQty);
      if (!numQty || numQty <= 0) { flash("Enter a valid quantity", false); return; }
      const available = Number(selectedRow.quantity || 0);
      if (numQty > available) { flash(`Insufficient stock — available: ${available}`, false); return; }
      setBusy(true);
      const { error: upErr } = await supabase
        .from("pharmacy_inventory")
        .update({ quantity: available - numQty })
        .eq("id", selectedRow.id);
      if (upErr) { setBusy(false); flash(upErr.message, false); return; }
      const { error: mvErr } = await supabase.from("stock_movements").insert({
        movement_type: "Dispense",
        drug_name: displayDrug(selectedRow),
        quantity: numQty,
        from_pharmacy: pharmacyName || String(pharmacy),
        to_pharmacy: null,
        batch_no: selectedRow.batch_no || null,
        expiry_date: selectedRow.expiry_date || null,
        reference_no: null,
        notes: null,
        created_at: new Date().toISOString(),
      });
      setBusy(false);
      if (mvErr) { flash(mvErr.message, false); return; }
      flash("Dispensed successfully");
      setSelectedRow(null); setDispenseQty("");
      await loadInventory(pharmacy);
    }
  }

  // ── Bulk preview ───────────────────────────────────────────────────────

  async function handleBulkPreview() {
    setMessage({ text: "", ok: true });
    setBulkResult(null);
    if (!bulkSrc) { flash("Select source pharmacy", false); return; }
    if (bulkOp === "bulk_transfer") {
      if (!bulkDst) { flash("Select destination pharmacy", false); return; }
      if (String(bulkSrc) === String(bulkDst)) { flash("Source and destination must be different pharmacies", false); return; }
    }
    if (!text(bulkText)) { flash("Enter at least one item in the text area", false); return; }

    setBulkBusy(true);
    const inv = await fetchPharmacyInventory(bulkSrc);
    const parsed = parseBulkLines(bulkText);

    const preview = parsed.map((p) => {
      if (p.error) {
        return { ...p, matchedRow: null, status: "Parse Error", statusDetail: p.error };
      }
      const { row, confidence } = matchDrug(inv, p.rawDrug);
      if (confidence === "ambiguous") {
        return { ...p, matchedRow: null, status: "Review Needed", statusDetail: "Multiple partial matches — be more specific" };
      }
      if (confidence === "not_found" || !row) {
        return { ...p, matchedRow: null, status: "Not Found", statusDetail: "" };
      }
      const available = Number(row.quantity);
      if (p.qty > available) {
        return { ...p, matchedRow: row, status: "Insufficient Stock", statusDetail: `Available: ${available}` };
      }
      const detail = confidence === "contains" ? "Partial match — verify drug" : "";
      return { ...p, matchedRow: row, status: "OK", statusDetail: detail };
    });

    setBulkPreview(preview);
    setBulkBusy(false);
  }

  // ── Bulk dispense confirm ──────────────────────────────────────────────

  async function confirmBulkDispense() {
    if (!bulkPreview) return;
    const valid = bulkPreview.filter((r) => r.status === "OK");
    if (valid.length === 0) { flash("No valid rows to process", false); return; }

    setBulkBusy(true);
    const srcName = pharmacies.find((p) => String(p.id) === String(bulkSrc))?.name || String(bulkSrc);
    let ok = 0;
    let failed = 0;

    for (const item of valid) {
      const available = Number(item.matchedRow.quantity);
      const { error: upErr } = await supabase
        .from("pharmacy_inventory")
        .update({ quantity: available - item.qty })
        .eq("id", item.matchedRow.id);
      if (upErr) { failed++; continue; }

      const { error: mvErr } = await supabase.from("stock_movements").insert({
        movement_type: "Dispense",
        drug_name: displayDrug(item.matchedRow),
        quantity: item.qty,
        from_pharmacy: srcName,
        to_pharmacy: null,
        batch_no: item.matchedRow.batch_no || null,
        expiry_date: item.matchedRow.expiry_date || null,
        reference_no: null,
        notes: "Bulk Dispense",
        created_at: new Date().toISOString(),
      });
      if (mvErr) { failed++; continue; }
      ok++;
    }

    setBulkBusy(false);
    setBulkResult({ total: valid.length, ok, failed });
    setBulkPreview(null);
    setBulkText("");
  }

  // ── Bulk transfer confirm ──────────────────────────────────────────────

  async function confirmBulkTransfer() {
    if (!bulkPreview) return;
    const valid = bulkPreview.filter((r) => r.status === "OK");
    if (valid.length === 0) { flash("No valid rows to process", false); return; }

    setBulkBusy(true);
    const srcName = pharmacies.find((p) => String(p.id) === String(bulkSrc))?.name || String(bulkSrc);
    const dstName = pharmacies.find((p) => String(p.id) === String(bulkDst))?.name || String(bulkDst);
    let ok = 0;
    let failed = 0;

    for (const item of valid) {
      const src = item.matchedRow;
      const available = Number(src.quantity);

      // 1. Subtract from source
      const { error: srcUpErr } = await supabase
        .from("pharmacy_inventory")
        .update({ quantity: available - item.qty })
        .eq("id", src.id);
      if (srcUpErr) { failed++; continue; }

      // 2. Add to destination — match by drug_name + batch_no + expiry_date
      let dstQ = supabase
        .from("pharmacy_inventory")
        .select("id, quantity")
        .eq("pharmacy_id", bulkDst)
        .eq("drug_name", text(src.drug_name));
      dstQ = src.batch_no ? dstQ.eq("batch_no", src.batch_no) : dstQ.is("batch_no", null);
      dstQ = src.expiry_date ? dstQ.eq("expiry_date", src.expiry_date) : dstQ.is("expiry_date", null);
      const { data: dstRows } = await dstQ.limit(1);
      const dstExisting = dstRows?.[0] || null;

      if (dstExisting) {
        const { error: dstUpErr } = await supabase
          .from("pharmacy_inventory")
          .update({ quantity: Number(dstExisting.quantity) + item.qty })
          .eq("id", dstExisting.id);
        if (dstUpErr) { failed++; continue; }
      } else {
        const { error: dstInsErr } = await supabase.from("pharmacy_inventory").insert({
          pharmacy_id: bulkDst,
          drug_name: text(src.drug_name),
          quantity: item.qty,
          batch_no: src.batch_no || null,
          expiry_date: src.expiry_date || null,
          barcode: src.barcode || null,
        });
        if (dstInsErr) { failed++; continue; }
      }

      // 3. Transfer Out movement
      const { error: outErr } = await supabase.from("stock_movements").insert({
        movement_type: "Transfer Out",
        drug_name: displayDrug(src),
        quantity: item.qty,
        from_pharmacy: srcName,
        to_pharmacy: dstName,
        batch_no: src.batch_no || null,
        expiry_date: src.expiry_date || null,
        reference_no: null,
        notes: "Bulk Transfer",
        created_at: new Date().toISOString(),
      });
      if (outErr) { failed++; continue; }

      // 4. Transfer In movement
      const { error: inErr } = await supabase.from("stock_movements").insert({
        movement_type: "Transfer In",
        drug_name: displayDrug(src),
        quantity: item.qty,
        from_pharmacy: srcName,
        to_pharmacy: dstName,
        batch_no: src.batch_no || null,
        expiry_date: src.expiry_date || null,
        reference_no: null,
        notes: "Bulk Transfer",
        created_at: new Date().toISOString(),
      });
      if (inErr) { failed++; continue; }

      ok++;
    }

    setBulkBusy(false);
    setBulkResult({ total: valid.length, ok, failed });
    setBulkPreview(null);
    setBulkText("");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const validBulkCount = bulkPreview ? bulkPreview.filter((r) => r.status === "OK").length : 0;

  return (
    <div style={S.page}>
      <div style={S.pageHeaderCard}>
        <PageHeader
          title="Stock Movement"
          subtitle="Execute receive, dispense, and bulk stock workflows with stronger operational clarity."
        />
      </div>

      {/* Top section tabs */}
      <div style={S.tabs}>
        <button style={S.tab(section === "single")} className="fm-action-btn" onClick={() => setSection("single")}>
          Single Movement
        </button>
        <button style={S.tab(section === "bulk")} className="fm-action-btn" onClick={() => setSection("bulk")}>
          Bulk Actions
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SINGLE MOVEMENT
      ═══════════════════════════════════════════════════════════════════ */}
      {section === "single" && (
        <>
          <div style={{ ...S.tabs, marginBottom: 16 }}>
            <button style={S.tabSm(mode === "receive")} className="fm-action-btn" onClick={() => setMode("receive")}>
              Receive
            </button>
            <button style={S.tabSm(mode === "dispense")} className="fm-action-btn" onClick={() => setMode("dispense")}>
              Dispense
            </button>
          </div>

          {/* RECEIVE */}
          {mode === "receive" && (
            <div style={S.card}>
              <h3 style={S.subhead}>Receive Stock</h3>
              <p style={S.hint}>Add incoming stock to a pharmacy&apos;s inventory.</p>

              <label style={S.labelFirst}>Pharmacy *</label>
              <select style={S.select} value={pharmacy} onChange={(e) => setPharmacy(e.target.value)}>
                <option value="">Select pharmacy...</option>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <label style={S.label}>Drug Name *</label>
              <input
                style={S.input}
                placeholder="e.g. Amoxicillin 500mg"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
              />

              <label style={S.label}>Batch No (optional)</label>
              <input
                style={S.input}
                placeholder="e.g. BTC-2024-001"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
              />

              <label style={S.label}>Expiry Date (optional)</label>
              <input
                style={S.input}
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />

              <label style={S.label}>Barcode (optional)</label>
              <input
                style={S.input}
                placeholder="Scan or type barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />

              <label style={S.label}>Quantity *</label>
              <input
                style={{ ...S.input, maxWidth: 200 }}
                type="number"
                min="1"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />

              <button style={S.btn} className="fm-action-btn" onClick={handleSave} disabled={busy}>
                {busy ? "Saving..." : "Save Receipt"}
              </button>
            </div>
          )}

          {/* DISPENSE */}
          {mode === "dispense" && (
            <>
              <div style={S.card}>
                <h3 style={S.subhead}>Dispense From Inventory</h3>
                <p style={S.hint}>Select source pharmacy, search for the drug, then confirm quantity.</p>

                <label style={S.labelFirst}>Source Pharmacy *</label>
                <select
                  style={S.select}
                  value={pharmacy}
                  onChange={(e) => {
                    setPharmacy(e.target.value);
                    setSelectedRow(null);
                    setSearch("");
                    setDispenseQty("");
                  }}
                >
                  <option value="">Select pharmacy...</option>
                  {pharmacies.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {pharmacy && (
                <div style={S.card}>
                  <label style={S.labelFirst}>Search Stock</label>
                  <input
                    style={S.input}
                    placeholder="Drug name, drug code, batch no, or barcode..."
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSelectedRow(null);
                      setDispenseQty("");
                    }}
                  />

                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th style={S.th}>Drug</th>
                        <th style={S.th}>Code</th>
                        <th style={S.th}>Batch</th>
                        <th style={S.th}>Expiry</th>
                        <th style={S.th}>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInventory.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            style={{ ...S.td, color: "#9ca3af", textAlign: "center", padding: "20px 0" }}
                          >
                            {search ? "No matching stock found." : "No stock available at this pharmacy."}
                          </td>
                        </tr>
                      ) : (
                        filteredInventory.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => { setSelectedRow(row); setDispenseQty(""); }}
                            className="fm-table-row"
                            style={{
                              background: selectedRow?.id === row.id ? "#eff6ff" : "transparent",
                              cursor: "pointer",
                              outline: selectedRow?.id === row.id ? "2px solid #3b82f6" : "none",
                              outlineOffset: -2,
                            }}
                          >
                            <td style={S.td}>{displayDrug(row)}</td>
                            <td style={S.td}>{text(row.drug_code) || "-"}</td>
                            <td style={S.td}>{text(row.batch_no) || "-"}</td>
                            <td style={S.td}>{text(row.expiry_date) || "-"}</td>
                            <td style={{ ...S.td, fontWeight: 600 }}>{row.quantity}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedRow && (
                <div style={S.card}>
                  <div style={S.summary}>
                    <div style={S.summaryTitle}>{displayDrug(selectedRow)}</div>
                    <div style={S.summaryMeta}>
                      Available stock: <strong>{selectedRow.quantity}</strong>
                    </div>
                    {selectedRow.batch_no && (
                      <div style={S.summaryMeta}>Batch: {selectedRow.batch_no}</div>
                    )}
                    {selectedRow.expiry_date && (
                      <div style={S.summaryMeta}>Expiry: {selectedRow.expiry_date}</div>
                    )}
                    {selectedRow.barcode && (
                      <div style={S.summaryMeta}>Barcode: {selectedRow.barcode}</div>
                    )}
                  </div>

                  <label style={S.labelFirst}>Quantity to Dispense *</label>
                  <input
                    style={{ ...S.input, maxWidth: 200 }}
                    type="number"
                    min="1"
                    max={selectedRow.quantity}
                    placeholder="0"
                    value={dispenseQty}
                    onChange={(e) => setDispenseQty(e.target.value)}
                  />

                  <button style={S.btn} className="fm-action-btn" onClick={handleSave} disabled={busy}>
                    {busy ? "Saving..." : "Confirm Dispense"}
                  </button>
                </div>
              )}
            </>
          )}

          {message.text && (
            <p style={message.ok ? S.msgOk : S.msgErr}>{message.text}</p>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          BULK ACTIONS
      ═══════════════════════════════════════════════════════════════════ */}
      {section === "bulk" && (
        <>
          {/* Bulk operation sub-tabs */}
          <div style={{ ...S.tabs, marginBottom: 16 }}>
            <button style={S.tabSm(bulkOp === "bulk_dispense")} className="fm-action-btn" onClick={() => setBulkOp("bulk_dispense")}>
              Bulk Dispense
            </button>
            <button style={S.tabSm(bulkOp === "bulk_transfer")} className="fm-action-btn" onClick={() => setBulkOp("bulk_transfer")}>
              Bulk Transfer
            </button>
          </div>

          {/* Config card */}
          <div style={S.card}>
            <h3 style={S.subhead}>
              {bulkOp === "bulk_dispense" ? "Bulk Dispense" : "Bulk Transfer"}
            </h3>
            <p style={S.hint}>
              {bulkOp === "bulk_dispense"
                ? "Dispense multiple drugs from one pharmacy in a single batch."
                : "Transfer multiple drugs between two pharmacies in a single batch."}
            </p>

            <label style={S.labelFirst}>Source Pharmacy *</label>
            <select
              style={S.select}
              value={bulkSrc}
              onChange={(e) => {
                setBulkSrc(e.target.value);
                setBulkPreview(null);
                setBulkResult(null);
              }}
            >
              <option value="">Select source pharmacy...</option>
              {pharmacies.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {bulkOp === "bulk_transfer" && (
              <>
                <label style={S.label}>Destination Pharmacy *</label>
                <select
                  style={S.select}
                  value={bulkDst}
                  onChange={(e) => {
                    setBulkDst(e.target.value);
                    setBulkPreview(null);
                    setBulkResult(null);
                  }}
                >
                  <option value="">Select destination pharmacy...</option>
                  {pharmacies
                    .filter((p) => String(p.id) !== String(bulkSrc))
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
              </>
            )}

            <label style={S.label}>Items *</label>
            <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b7280" }}>
              One line per item: drug name or drug code, then comma, then quantity
            </p>
            <textarea
              style={S.textarea}
              placeholder={"WEGOVY, 2\n123456, 5\nAmoxicillin 500mg, 10"}
              value={bulkText}
              onChange={(e) => {
                setBulkText(e.target.value);
                setBulkPreview(null);
                setBulkResult(null);
              }}
            />

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button
                style={{ ...S.btn, marginTop: 0 }}
                className="fm-action-btn"
                onClick={handleBulkPreview}
                disabled={bulkBusy}
              >
                {bulkBusy ? "Loading..." : "Preview"}
              </button>
              <button
                style={S.btnGhost}
                className="fm-action-btn"
                onClick={() => {
                  setBulkText("");
                  setBulkPreview(null);
                  setBulkResult(null);
                  setMessage({ text: "", ok: true });
                }}
              >
                Reset
              </button>
            </div>
          </div>

          {/* Preview table */}
          {bulkPreview && (
            <div style={S.card}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#374151" }}>
                  Preview &mdash; {bulkPreview.length} line{bulkPreview.length !== 1 ? "s" : ""} parsed,{" "}
                  <span style={{ color: validBulkCount > 0 ? "#15803d" : "#dc2626" }}>
                    {validBulkCount} valid
                  </span>
                </h4>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th>
                    <th style={S.th}>Drug Input</th>
                    <th style={S.th}>Matched Drug</th>
                    <th style={S.th}>Code</th>
                    <th style={S.th}>Available</th>
                    <th style={S.th}>Requested</th>
                    <th style={S.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreview.map((row, idx) => (
                    <tr key={idx} style={{ background: ROW_BG[row.status] || "transparent" }}>
                      <td style={{ ...S.td, color: "#9ca3af" }}>{row.lineNo}</td>
                      <td style={S.td}>
                        {row.rawDrug || <em style={{ color: "#9ca3af" }}>empty</em>}
                      </td>
                      <td style={S.td}>
                        {row.matchedRow
                          ? displayDrug(row.matchedRow)
                          : <span style={{ color: "#9ca3af" }}>—</span>}
                      </td>
                      <td style={S.td}>
                        {row.matchedRow ? (text(row.matchedRow.drug_code) || "—") : "—"}
                      </td>
                      <td style={S.td}>
                        {row.matchedRow ? row.matchedRow.quantity : "—"}
                      </td>
                      <td style={{ ...S.td, fontWeight: row.status === "OK" ? 600 : 400 }}>
                        {row.qty > 0 ? row.qty : (row.rawQty || "—")}
                      </td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <StatusPill
                          variant={
                            row.status === "OK"
                              ? "success"
                              : row.status === "Insufficient Stock"
                              ? "warning"
                              : row.status === "Not Found"
                              ? "danger"
                              : "neutral"
                          }
                          style={BADGE[row.status] || {}}
                        >
                          {row.status}
                        </StatusPill>
                        {row.statusDetail
                          ? <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>{row.statusDetail}</span>
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {validBulkCount > 0 && (
                <button
                  style={bulkOp === "bulk_transfer" ? S.btnPurple : { ...S.btn, marginTop: 18 }}
                  className="fm-action-btn"
                  onClick={bulkOp === "bulk_dispense" ? confirmBulkDispense : confirmBulkTransfer}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? "Processing..."
                    : bulkOp === "bulk_dispense"
                    ? `Confirm Bulk Dispense (${validBulkCount} item${validBulkCount !== 1 ? "s" : ""})`
                    : `Confirm Bulk Transfer (${validBulkCount} item${validBulkCount !== 1 ? "s" : ""})`}
                </button>
              )}
            </div>
          )}

          {/* Result summary */}
          {bulkResult && (
            <div style={S.resultCard}>
              <div style={S.resultTitle}>
                {bulkOp === "bulk_dispense" ? "Bulk Dispense Complete" : "Bulk Transfer Complete"}
              </div>
              <div style={S.resultRow}>
                <span style={S.resultStat}>
                  Total processed: <strong>{bulkResult.total}</strong>
                </span>
                <span style={{ ...S.resultStat, color: "#15803d" }}>
                  Successful: <strong>{bulkResult.ok}</strong>
                </span>
                {bulkResult.failed > 0 && (
                  <span style={{ ...S.resultStat, color: "#dc2626" }}>
                    Failed: <strong>{bulkResult.failed}</strong>
                  </span>
                )}
              </div>
            </div>
          )}

          {message.text && (
            <p style={message.ok ? S.msgOk : S.msgErr}>{message.text}</p>
          )}
        </>
      )}
    </div>
  );
}
