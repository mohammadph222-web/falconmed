import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { emitInventoryUpdated } from "./utils/inventoryEvents";

const STOCK_MOVEMENT_DRAFT_STORAGE_KEY = "falconmed_stock_movement_draft";

function readStockMovementDraft() {
  try {
    const raw = window.sessionStorage.getItem(STOCK_MOVEMENT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStockMovementDraft(value) {
  try {
    window.sessionStorage.setItem(STOCK_MOVEMENT_DRAFT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures.
  }
}

function clearStockMovementDraft() {
  try {
    window.sessionStorage.removeItem(STOCK_MOVEMENT_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

const movementTypes = [
  "Receive",
  "Issue",
  "Transfer Out",
  "Transfer In",
  "Adjustment+",
  "Adjustment-",
  "Return",
];

const initialForm = {
  movement_type: "Receive",
  drug_name: "",
  quantity: "",
  from_pharmacy: "",
  to_pharmacy: "",
  batch_no: "",
  expiry_date: "",
  reference_no: "",
  notes: "",
};

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

export default function StockMovementSystem() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState(initialForm);
  const [feedback, setFeedback] = useState({ type: "", text: "" });
  const [restoredDraftMessage, setRestoredDraftMessage] = useState("");
  const [drugOptions, setDrugOptions] = useState([]);
  const [pharmacyOptions, setPharmacyOptions] = useState([]);
  const [pharmacyIdMap, setPharmacyIdMap] = useState(new Map());

  const isTransferType =
    formData.movement_type === "Transfer Out" || formData.movement_type === "Transfer In";

  const summary = useMemo(() => {
    const total = rows.length;
    const transferOuts = rows.filter((r) => r.movement_type === "Transfer Out").length;
    const transferIns = rows.filter((r) => r.movement_type === "Transfer In").length;
    const adjustments = rows.filter(
      (r) => r.movement_type === "Adjustment+" || r.movement_type === "Adjustment-"
    ).length;

    return { total, transferOuts, transferIns, adjustments };
  }, [rows]);

  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(initialForm).some((key) => {
      const current = String(formData[key] || "").trim();
      const initial = String(initialForm[key] || "").trim();
      return current !== initial;
    });
  }, [formData]);

  useEffect(() => {
    const persisted = readStockMovementDraft();
    if (!persisted?.formData || typeof persisted.formData !== "object") return;

    setFormData((prev) => ({
      ...prev,
      ...persisted.formData,
    }));

    const restored = Object.keys(initialForm).some((key) => {
      const value = String(persisted.formData[key] || "").trim();
      return value !== String(initialForm[key] || "").trim();
    });

    if (restored) {
      setRestoredDraftMessage("Restored unsaved draft");
    }
  }, []);

  useEffect(() => {
    writeStockMovementDraft({ formData });
  }, [formData]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const beforeUnloadHandler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () => window.removeEventListener("beforeunload", beforeUnloadHandler);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!restoredDraftMessage) return undefined;
    const timer = window.setTimeout(() => setRestoredDraftMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [restoredDraftMessage]);

  const loadMovements = async () => {
    setLoading(true);
    setFeedback({ type: "", text: "" });

    if (!supabase) {
      setRows([]);
      setLoading(false);
      setFeedback({
        type: "warning",
        text: "Supabase is not configured. Stock movements cannot be loaded right now.",
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      setRows([]);
      setFeedback({
        type: "error",
        text: `Failed to load stock movements: ${err.message}`,
      });
    }

    setLoading(false);
  };

  const loadFormOptions = async () => {
    if (!supabase) {
      setDrugOptions([]);
      setPharmacyOptions([]);
      return;
    }

    try {
      let allRows = [];
      let pageFrom = 0;
      const PAGE_SIZE = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("drug_master")
          .select("drug_name")
          .range(pageFrom, pageFrom + PAGE_SIZE - 1);

        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) break;

        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        pageFrom += PAGE_SIZE;
        if (pageFrom >= 200000) break;
      }

      const distinct = [...new Set(allRows.map((r) => String(r?.drug_name ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setDrugOptions(distinct);
    } catch {
      setDrugOptions([]);
    }

    try {
      const { data, error } = await supabase
        .from("pharmacies")
        .select("id, name")
        .limit(2000);

      if (!error && Array.isArray(data)) {
        const distinct = [...new Set(data.map((r) => String(r?.name || "").trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        setPharmacyOptions(distinct);
        const idMap = new Map();
        data.forEach((r) => {
          const name = String(r?.name || "").trim();
          if (name && r?.id != null) idMap.set(name, r.id);
        });
        setPharmacyIdMap(idMap);
      } else {
        setPharmacyOptions([]);
        setPharmacyIdMap(new Map());
      }
    } catch {
      setPharmacyOptions([]);
      setPharmacyIdMap(new Map());
    }
  };

  useEffect(() => {
    void loadMovements();
    void loadFormOptions();
  }, []);

  const filteredDrugOptions = useMemo(() => {
    const query = formData.drug_name.trim().toLowerCase();
    if (!query) return drugOptions;
    return drugOptions.filter((name) => name.toLowerCase().includes(query));
  }, [drugOptions, formData.drug_name]);

  const applyInventoryUpdate = async (pharmacyName, drugName, qty, op, batchNo, expiryDate) => {
    const pharmacyId = pharmacyIdMap.get(pharmacyName);
    if (pharmacyId == null) {
      throw new Error(`Pharmacy "${pharmacyName}" was not found. Inventory sync cannot continue.`);
    }

    const { data: invRows, error: fetchError } = await supabase
      .from("pharmacy_inventory")
      .select("id, quantity, batch_no, expiry_date, unit_cost")
      .eq("pharmacy_id", pharmacyId)
      .eq("drug_name", drugName)
      .limit(1);

    if (fetchError) throw new Error(`Inventory lookup failed: ${fetchError.message}`);

    const existing = invRows?.[0] ?? null;

    if (op === "subtract") {
      if (!existing) {
        throw new Error(
          `No inventory record found for "${drugName}" at "${pharmacyName}". Cannot reduce stock that does not exist.`
        );
      }
      const currentQty = Number(existing.quantity ?? 0);
      if (currentQty - qty < 0) {
        throw new Error(
          `Insufficient stock: "${drugName}" at "${pharmacyName}" has ${currentQty} unit(s). Cannot subtract ${qty}.`
        );
      }
      const { error: updateError } = await supabase
        .from("pharmacy_inventory")
        .update({ quantity: currentQty - qty })
        .eq("id", existing.id);
      if (updateError) throw new Error(`Inventory update failed: ${updateError.message}`);
    } else {
      if (existing) {
        const currentQty = Number(existing.quantity ?? 0);
        const { error: updateError } = await supabase
          .from("pharmacy_inventory")
          .update({ quantity: currentQty + qty })
          .eq("id", existing.id);
        if (updateError) throw new Error(`Inventory update failed: ${updateError.message}`);
      } else {
        const newRow = {
          pharmacy_id: pharmacyId,
          drug_name: drugName,
          quantity: qty,
          batch_no: batchNo || null,
          expiry_date: expiryDate || null,
          unit_cost: 0,
        };
        const { error: insertError } = await supabase
          .from("pharmacy_inventory")
          .insert([newRow]);
        if (insertError) throw new Error(`Inventory insert failed: ${insertError.message}`);
      }
    }
  };

  const onChange = (event) => {
    const { name, value } = event.target;

    setFormData((prev) => {
      const next = { ...prev, [name]: value };

      if (name === "movement_type") {
        const transfer = value === "Transfer Out" || value === "Transfer In";
        if (transfer && next.from_pharmacy && next.from_pharmacy === next.to_pharmacy) {
          next.to_pharmacy = "";
        }
      }

      if (name === "from_pharmacy" && isTransferType && value && value === prev.to_pharmacy) {
        next.to_pharmacy = "";
      }

      if (name === "to_pharmacy" && isTransferType && value && value === prev.from_pharmacy) {
        next.from_pharmacy = "";
      }

      return next;
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setFeedback({ type: "", text: "" });

    const qty = Number(formData.quantity);
    if (!formData.drug_name.trim()) {
      setFeedback({ type: "error", text: "Drug name is required." });
      return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: "error", text: "Quantity must be greater than zero." });
      return;
    }

    if (isTransferType) {
      if (!formData.from_pharmacy.trim() || !formData.to_pharmacy.trim()) {
        setFeedback({
          type: "error",
          text: "Both From Pharmacy and To Pharmacy are required for transfer movements.",
        });
        return;
      }

      if (formData.from_pharmacy.trim() === formData.to_pharmacy.trim()) {
        setFeedback({
          type: "error",
          text: "From Pharmacy and To Pharmacy cannot be the same for transfer movements.",
        });
        return;
      }
    }

    if (!supabase) {
      setFeedback({
        type: "warning",
        text: "Supabase is not configured. Unable to save movement.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const drug = formData.drug_name.trim();
      const from = formData.from_pharmacy.trim() || null;
      const to = formData.to_pharmacy.trim() || null;
      const batchNo = formData.batch_no.trim() || null;
      const expiryDate = formData.expiry_date || null;
      const movType = formData.movement_type;

      // Pre-validate subtract operations before inserting the movement
      let preCheckPharmacy = null;
      if (movType === "Issue" || movType === "Transfer Out") {
        preCheckPharmacy = from;
      } else if (movType === "Adjustment-") {
        preCheckPharmacy = from || to;
      }

      if (preCheckPharmacy) {
        const pharmacyId = pharmacyIdMap.get(preCheckPharmacy);
        if (pharmacyId == null) {
          setFeedback({
            type: "error",
            text: `Pharmacy "${preCheckPharmacy}" was not found. Please select a valid pharmacy before submitting.`,
          });
          setSubmitting(false);
          return;
        }

        const { data: invRows, error: invFetchErr } = await supabase
          .from("pharmacy_inventory")
          .select("quantity")
          .eq("pharmacy_id", pharmacyId)
          .eq("drug_name", drug)
          .limit(1);

        if (invFetchErr) {
          setFeedback({
            type: "error",
            text: `Unable to validate inventory before movement: ${invFetchErr.message}`,
          });
          setSubmitting(false);
          return;
        }

        const currentQty = Number(invRows?.[0]?.quantity ?? 0);
        if (!invRows?.[0]) {
          setFeedback({
            type: "error",
            text: `No inventory record found for "${drug}" at "${preCheckPharmacy}". Movement not recorded.`,
          });
          setSubmitting(false);
          return;
        }
        if (currentQty - qty < 0) {
          setFeedback({
            type: "error",
            text: `Insufficient stock: "${drug}" at "${preCheckPharmacy}" has ${currentQty} unit(s). Cannot subtract ${qty}. Movement not recorded.`,
          });
          setSubmitting(false);
          return;
        }
      }

      const payload = {
        movement_type: movType,
        drug_name: drug,
        quantity: qty,
        from_pharmacy: from,
        to_pharmacy: to,
        batch_no: batchNo,
        expiry_date: expiryDate,
        reference_no: formData.reference_no.trim() || null,
        notes: formData.notes.trim() || null,
        created_at: new Date().toISOString(),
        created_by: "falconmed.demo@preview",
      };

      let movementInsert = await supabase
        .from("stock_movements")
        .insert([payload])
        .select("*")
        .single();

      if (movementInsert.error) {
        const msg = String(movementInsert.error.message || "").toLowerCase();
        const createdByMissing = msg.includes("created_by") && msg.includes("column");

        if (createdByMissing) {
          const { created_by, ...fallbackPayload } = payload;
          movementInsert = await supabase
            .from("stock_movements")
            .insert([fallbackPayload])
            .select("*")
            .single();
        }
      }

      const { data, error } = movementInsert;
      if (error) throw error;

      // Update pharmacy_inventory after successful movement insert
      try {
        switch (movType) {
          case "Issue":
            if (from) await applyInventoryUpdate(from, drug, qty, "subtract", batchNo, expiryDate);
            break;
          case "Receive":
            if (to) await applyInventoryUpdate(to, drug, qty, "add", batchNo, expiryDate);
            break;
          case "Transfer Out":
            if (from) await applyInventoryUpdate(from, drug, qty, "subtract", batchNo, expiryDate);
            break;
          case "Transfer In":
            if (to) await applyInventoryUpdate(to, drug, qty, "add", batchNo, expiryDate);
            break;
          case "Adjustment+": {
            const p = to || from;
            if (p) await applyInventoryUpdate(p, drug, qty, "add", batchNo, expiryDate);
            break;
          }
          case "Adjustment-": {
            const p = from || to;
            if (p) await applyInventoryUpdate(p, drug, qty, "subtract", batchNo, expiryDate);
            break;
          }
          case "Return": {
            const p = to || from;
            if (p) await applyInventoryUpdate(p, drug, qty, "add", batchNo, expiryDate);
            break;
          }
          default:
            break;
        }
      } catch (invErr) {
        setRows((prev) => [data, ...prev]);
        setFormData(initialForm);
        setFeedback({
          type: "error",
          text: `Movement logged, but inventory update failed: ${invErr.message}`,
        });
        setSubmitting(false);
        return;
      }

      setRows((prev) => [data, ...prev]);
      setFormData(initialForm);
      clearStockMovementDraft();
      setFeedback({ type: "success", text: "Stock movement added and inventory updated successfully." });
      emitInventoryUpdated(formData.to_pharmacy || formData.from_pharmacy || "");
    } catch (err) {
      setFeedback({
        type: "error",
        text: `Failed to add movement: ${err.message}`,
      });
    }

    setSubmitting(false);
  };

  const feedbackStyle =
    feedback.type === "error"
      ? {
          background: "#fef2f2",
          color: "#b91c1c",
          border: "1px solid #fecaca",
        }
      : feedback.type === "success"
        ? {
            background: "#eff6ff",
            color: "#1d4ed8",
            border: "1px solid #bfdbfe",
          }
        : feedback.type === "warning"
          ? {
              background: "#fff7ed",
              color: "#9a3412",
              border: "1px solid #fed7aa",
            }
          : {};

  return (
    <div style={pageWrap}>
      <div style={headerCard}>
        <div style={eyebrow}>Operations</div>
        <h2 style={title}>Stock Movement System</h2>
        <p style={subtitle}>Record, track, and review pharmacy stock movement activity.</p>
      </div>

      <div style={kpiGrid}>
        <div style={{ ...kpiCard, borderTop: "4px solid #3b82f6" }}>
          <div style={kpiLabel}>TOTAL MOVEMENTS</div>
          <div style={kpiValue}>{summary.total}</div>
        </div>
        <div style={{ ...kpiCard, borderTop: "4px solid #ef4444" }}>
          <div style={kpiLabel}>TRANSFER OUTS</div>
          <div style={kpiValue}>{summary.transferOuts}</div>
        </div>
        <div style={{ ...kpiCard, borderTop: "4px solid #10b981" }}>
          <div style={kpiLabel}>TRANSFER INS</div>
          <div style={kpiValue}>{summary.transferIns}</div>
        </div>
        <div style={{ ...kpiCard, borderTop: "4px solid #f59e0b" }}>
          <div style={kpiLabel}>ADJUSTMENTS</div>
          <div style={kpiValue}>{summary.adjustments}</div>
        </div>
      </div>

      {feedback.text ? <div style={{ ...feedbackBox, ...feedbackStyle }}>{feedback.text}</div> : null}
      {restoredDraftMessage ? (
        <div
          style={{
            ...feedbackBox,
            background: "#ecfdf3",
            color: "#166534",
            border: "1px solid #bbf7d0",
          }}
        >
          {restoredDraftMessage}
        </div>
      ) : null}

      <div style={contentCard}>
        <h3 style={sectionTitle}>Add Movement</h3>
        <form onSubmit={onSubmit}>
          <div style={formGrid}>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Movement Type</label>
              <select
                name="movement_type"
                value={formData.movement_type}
                onChange={onChange}
                style={inputStyle}
              >
                {movementTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Drug Name</label>
              <input
                name="drug_name"
                value={formData.drug_name}
                onChange={onChange}
                style={inputStyle}
                required
                list="stock-movement-drug-options"
                placeholder={drugOptions.length === 0 ? "No drug options available" : "Search and select drug"}
                autoComplete="off"
              />
              <datalist id="stock-movement-drug-options">
                {filteredDrugOptions.slice(0, 3000).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity</label>
              <input
                type="number"
                min="1"
                name="quantity"
                value={formData.quantity}
                onChange={onChange}
                style={inputStyle}
                required
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>From Pharmacy</label>
              <select
                name="from_pharmacy"
                value={formData.from_pharmacy}
                onChange={onChange}
                style={inputStyle}
              >
                <option value="">Select from pharmacy{isTransferType ? "" : " (optional)"}</option>
                {pharmacyOptions
                  .filter((name) => !(isTransferType && formData.to_pharmacy && name === formData.to_pharmacy))
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>To Pharmacy</label>
              <select
                name="to_pharmacy"
                value={formData.to_pharmacy}
                onChange={onChange}
                style={inputStyle}
              >
                <option value="">Select to pharmacy{isTransferType ? "" : " (optional)"}</option>
                {pharmacyOptions
                  .filter((name) => !(isTransferType && formData.from_pharmacy && name === formData.from_pharmacy))
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Batch No</label>
              <input
                name="batch_no"
                value={formData.batch_no}
                onChange={onChange}
                style={inputStyle}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Expiry Date</label>
              <input
                type="date"
                name="expiry_date"
                value={formData.expiry_date}
                onChange={onChange}
                style={inputStyle}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Reference No</label>
              <input
                name="reference_no"
                value={formData.reference_no}
                onChange={onChange}
                style={inputStyle}
              />
            </div>

            <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
              <label style={fieldLabel}>Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={onChange}
                style={textAreaStyle}
                rows={3}
              />
            </div>
          </div>

          <div style={{ marginTop: "16px" }}>
            <button type="submit" style={primaryBtn} disabled={submitting}>
              {submitting ? "Adding..." : "Add Movement"}
            </button>
          </div>
        </form>
      </div>

      <div style={tableCard}>
        <div style={tableHeaderRow}>
          <h3 style={tableTitle}>Movement Log</h3>
        </div>

        {loading ? (
          <div style={emptyState}>Loading stock movements...</div>
        ) : rows.length === 0 ? (
          <div style={emptyState}>No movements recorded yet.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Drug</th>
                  <th style={th}>Qty</th>
                  <th style={th}>From</th>
                  <th style={th}>To</th>
                  <th style={th}>Batch</th>
                  <th style={th}>Reference</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{formatDate(row.created_at)}</td>
                    <td style={td}>{row.movement_type || "-"}</td>
                    <td style={tdDrug}>{row.drug_name || "-"}</td>
                    <td style={td}>{Number(row.quantity || 0)}</td>
                    <td style={td}>{row.from_pharmacy || "-"}</td>
                    <td style={td}>{row.to_pharmacy || "-"}</td>
                    <td style={td}>{row.batch_no || "-"}</td>
                    <td style={td}>{row.reference_no || "-"}</td>
                    <td style={tdNotes}>{row.notes || "-"}</td>
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

const pageWrap = {
  display: "grid",
  gap: "16px",
};

const headerCard = {
  background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
  borderRadius: "18px",
  padding: "26px 28px",
  border: "1px solid #dbe7f5",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

const eyebrow = {
  display: "inline-flex",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#e0ecff",
  color: "#1d4ed8",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "12px",
};

const title = {
  margin: 0,
  color: "#0f172a",
};

const subtitle = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#475569",
  lineHeight: 1.6,
};

const kpiGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "14px",
};

const kpiCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e8edf5",
  padding: "16px",
  boxShadow: "0 2px 12px rgba(15,23,42,0.05)",
};

const kpiLabel = {
  fontSize: "11px",
  color: "#64748b",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 700,
};

const kpiValue = {
  marginTop: "8px",
  fontSize: "28px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const feedbackBox = {
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "14px",
};

const contentCard = {
  background: "white",
  borderRadius: "18px",
  border: "1px solid #e8edf5",
  boxShadow: "0 2px 14px rgba(15,23,42,0.06)",
  padding: "24px",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "18px",
  fontSize: "16px",
  fontWeight: 800,
  color: "#0f172a",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "12px",
};

const fieldGroup = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const fieldLabel = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#374151",
};

const inputStyle = {
  padding: "9px 12px",
  border: "1.5px solid #e2e8f0",
  borderRadius: "10px",
  fontSize: "14px",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  color: "#0f172a",
  background: "white",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const textAreaStyle = {
  ...inputStyle,
  resize: "vertical",
  minHeight: "90px",
};

const primaryBtn = {
  background: "#1e40af",
  color: "white",
  border: "none",
  borderRadius: "12px",
  padding: "11px 24px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 2px 10px rgba(30,64,175,0.25)",
};

const tableCard = {
  background: "white",
  borderRadius: "18px",
  border: "1px solid #e8edf5",
  boxShadow: "0 2px 14px rgba(15,23,42,0.06)",
  overflow: "hidden",
};

const tableHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 22px 14px",
  borderBottom: "1px solid #f1f5f9",
};

const tableTitle = {
  margin: 0,
  fontSize: "16px",
  fontWeight: 800,
  color: "#0f172a",
};

const tableWrap = {
  width: "100%",
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "980px",
};

const th = {
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
  background: "#f8fafc",
  borderBottom: "2px solid #e2e8f0",
  padding: "10px 12px",
};

const td = {
  color: "#334155",
  padding: "11px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "13px",
  verticalAlign: "middle",
};

const tdDrug = {
  ...td,
  color: "#0f172a",
  fontWeight: 600,
};

const tdNotes = {
  ...td,
  maxWidth: "260px",
  lineHeight: 1.5,
};

const emptyState = {
  padding: "38px 20px",
  textAlign: "center",
  color: "#64748b",
};
