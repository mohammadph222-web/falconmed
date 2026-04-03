import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "./lib/authContext";
import DrugMasterPicker from "./components/DrugMasterPicker";
import InventoryRowPicker from "./components/InventoryRowPicker";
import {
  fetchRecentStockMovements,
  fetchStockMovementOptions,
  getStockMovementTypes,
  postStockMovement,
} from "./lib/stockMovementService";
import { emitInventoryUpdated } from "./utils/inventoryEvents";

const STOCK_MOVEMENT_V1_DRAFT_KEY = "falconmed_stock_movement_v1_draft";

const initialForm = {
  movementType: "Receive",
  sourcePharmacyId: "",
  destinationPharmacyId: "",
  drugName: "",
  quantity: "",
  batchNo: "",
  expiryDate: "",
  barcode: "",
  unitCost: "",
  referenceNo: "",
  notes: "",
};

function readDraft() {
  try {
    const raw = window.sessionStorage.getItem(STOCK_MOVEMENT_V1_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeDraft(value) {
  try {
    window.sessionStorage.setItem(STOCK_MOVEMENT_V1_DRAFT_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures in demo environments.
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(STOCK_MOVEMENT_V1_DRAFT_KEY);
  } catch {
    // Ignore storage failures in demo environments.
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatExpiry(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function getFeedbackStyle(type) {
  if (type === "error") {
    return {
      color: "#991b1b",
      background: "#fef2f2",
      border: "1px solid #fecaca",
      boxShadow: "inset 4px 0 0 #dc2626",
    };
  }

  if (type === "success") {
    return {
      color: "#1d4ed8",
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      boxShadow: "inset 4px 0 0 #2563eb",
    };
  }

  return {
    color: "#9a3412",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    boxShadow: "inset 4px 0 0 #ea580c",
  };
}

export default function StockMovementPage() {
  const { user } = useAuthContext();

  const [form, setForm] = useState(initialForm);
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [selectedSourceRow, setSelectedSourceRow] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", text: "" });

  const movementTypes = useMemo(() => getStockMovementTypes(), []);

  const pharmacyMap = useMemo(() => {
    const map = new Map();
    for (const pharmacy of pharmacies) {
      if (!pharmacy?.id || map.has(pharmacy.id)) continue;
      map.set(pharmacy.id, pharmacy);
    }
    return map;
  }, [pharmacies]);

  const isReceive = form.movementType === "Receive";
  const isInventoryFirst =
    form.movementType === "Dispense" ||
    form.movementType === "Adjustment Remove";

  useEffect(() => {
    const draft = readDraft();
    if (draft?.form && typeof draft.form === "object") {
      setForm((prev) => ({ ...prev, ...draft.form }));
    }
  }, []);

  useEffect(() => {
    writeDraft({ form });
  }, [form]);

  const loadPage = async () => {
    setLoading(true);
    setFeedback({ type: "", text: "" });

    try {
      const [options, recent] = await Promise.all([
        fetchStockMovementOptions(),
        fetchRecentStockMovements(100),
      ]);

      setPharmacies(options.pharmacies || []);
      setRows(recent || []);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error.message || "Failed to load stock movement data.",
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadPage();
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => {
      const next = { ...prev, [name]: value };

      if (name === "movementType") {
        next.sourcePharmacyId = "";
        next.destinationPharmacyId = "";
        next.drugName = "";
        next.batchNo = "";
        next.expiryDate = "";
        next.barcode = "";
        next.unitCost = "";
      }

      if (name === "sourcePharmacyId") {
        next.drugName = "";
        next.batchNo = "";
        next.expiryDate = "";
        next.barcode = "";
        next.unitCost = "";
      }

      return next;
    });

    if (name === "movementType" || name === "sourcePharmacyId") {
      setSelectedSourceRow(null);
      setSelectedDrug(null);
    }
  };

  const chooseMasterDrug = (drug) => {
    setSelectedDrug(drug);
    setForm((prev) => ({
      ...prev,
      drugName: drug?.drug_name || drug?.brand_name || "",
      barcode: drug?.barcode || "",
      unitCost: drug?.unit_price_pharmacy || drug?.pharmacy_price || drug?.unit_cost || "",
    }));
  };

  const chooseSourceRow = (row) => {
    setSelectedSourceRow(row);
    setForm((prev) => ({
      ...prev,
      drugName: row?.drug_name || "",
      batchNo: row?.batch_no || "",
      expiryDate: row?.expiry_date || "",
      barcode: row?.barcode || "",
      unitCost: row?.unit_cost || "",
    }));
  };

  const resetForm = () => {
    setForm(initialForm);
    setSelectedDrug(null);
    setSelectedSourceRow(null);
    clearDraft();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback({ type: "", text: "" });

    try {
      const fromPharmacy = pharmacyMap.get(form.sourcePharmacyId) || null;
      const toPharmacy = pharmacyMap.get(form.destinationPharmacyId) || null;

      if (isInventoryFirst && !selectedSourceRow?.id) {
        throw new Error("Select a source inventory row before posting this movement.");
      }

      const result = await postStockMovement({
        movementType: form.movementType,
        drugName: form.drugName,
        quantity: form.quantity,
        fromPharmacyId: form.sourcePharmacyId,
        toPharmacyId: form.destinationPharmacyId,
        fromPharmacyName: fromPharmacy?.name || "",
        toPharmacyName: toPharmacy?.name || "",
        batchNo: form.batchNo,
        expiryDate: form.expiryDate,
        barcode: form.barcode,
        unitCost: form.unitCost,
        referenceNo: form.referenceNo,
        notes: form.notes,
        sourceInventoryRowId: selectedSourceRow?.id || "",
        sourceInventoryRow: selectedSourceRow,
        createdBy: user?.email || "falconmed.v1@system",
      });

      const recent = await fetchRecentStockMovements(100);
      setRows(recent || []);
      setFeedback({
        type: "success",
        text: `Movement recorded successfully (${result.records.length} ledger entr${result.records.length === 1 ? "y" : "ies"}).`,
      });
      emitInventoryUpdated(result.emittedPharmacyId || "");
      resetForm();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error.message || "Failed to record movement.",
      });
    }

    setSubmitting(false);
  };

  return (
    <div style={pageWrap}>
      <div style={heroCard}>
        <div style={heroEyebrow}>Operations V1</div>
        <h2 style={heroTitle}>Stock Movement System V1</h2>
        <p style={heroSubtitle}>
          Ledger-first stock movement flow with strict quantity controls and real inventory balance sync.
        </p>
      </div>

      {feedback.text ? (
        <div style={{ ...feedbackBox, ...getFeedbackStyle(feedback.type) }}>{feedback.text}</div>
      ) : null}

      <div style={panel}>
        <h3 style={panelTitle}>Record Movement</h3>
        <form onSubmit={handleSubmit}>
          <div style={formGrid}>
            <div style={fieldGroup}>
              <label style={fieldLabel}>Movement Type</label>
              <select name="movementType" value={form.movementType} onChange={handleChange} style={inputStyle}>
                {movementTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {isInventoryFirst ? (
              <div style={fieldGroup}>
                <label style={fieldLabel}>Source Pharmacy</label>
                <select name="sourcePharmacyId" value={form.sourcePharmacyId} onChange={handleChange} style={inputStyle} required>
                  <option value="">Select source pharmacy</option>
                  {pharmacies
                    .filter((item) => !(form.destinationPharmacyId && item.id === form.destinationPharmacyId))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : (
              <div style={fieldGroup}>
                <label style={fieldLabel}>Pharmacy</label>
                <select name="destinationPharmacyId" value={form.destinationPharmacyId} onChange={handleChange} style={inputStyle} required>
                  <option value="">Select pharmacy</option>
                  {pharmacies.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isReceive ? (
              <>
                <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                  <DrugMasterPicker value={selectedDrug} onSelect={chooseMasterDrug} required />
                </div>

                <div style={fieldGroup}>
                  <label style={fieldLabel}>Drug Name</label>
                  <input
                    name="drugName"
                    value={form.drugName}
                    onChange={handleChange}
                    style={inputStyle}
                    required
                    placeholder="Auto-filled from Drug Master Search"
                  />
                </div>

                <div style={fieldGroup}>
                  <label style={fieldLabel}>Batch No</label>
                  <input name="batchNo" value={form.batchNo} onChange={handleChange} style={inputStyle} />
                </div>

                <div style={fieldGroup}>
                  <label style={fieldLabel}>Expiry Date</label>
                  <input type="date" name="expiryDate" value={form.expiryDate} onChange={handleChange} style={inputStyle} />
                </div>

                <div style={fieldGroup}>
                  <label style={fieldLabel}>Barcode</label>
                  <input name="barcode" value={form.barcode} onChange={handleChange} style={inputStyle} />
                </div>

                <div style={fieldGroup}>
                  <label style={fieldLabel}>Unit Cost</label>
                  <input type="number" step="0.01" min="0" name="unitCost" value={form.unitCost} onChange={handleChange} style={inputStyle} />
                </div>
              </>
            ) : null}

            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
                name="quantity"
                value={form.quantity}
                onChange={handleChange}
                style={inputStyle}
                required
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Reference No</label>
              <input name="referenceNo" value={form.referenceNo} onChange={handleChange} style={inputStyle} />
            </div>

            <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
              <label style={fieldLabel}>Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} style={textareaStyle} rows={3} />
            </div>
          </div>

          {isInventoryFirst ? (
            <div style={inventoryPickerWrap}>
              <InventoryRowPicker
                pharmacyId={form.sourcePharmacyId}
                selectedRow={selectedSourceRow}
                onSelect={chooseSourceRow}
              />
            </div>
          ) : null}

          {selectedSourceRow ? (
            <div style={balanceBanner}>
              Selected source row: <strong>{selectedSourceRow.drug_name || "-"}</strong> | Available: <strong>{selectedSourceRow.quantity ?? 0}</strong> | Batch: <strong>{selectedSourceRow.batch_no || "-"}</strong> | Expiry: <strong>{formatExpiry(selectedSourceRow.expiry_date)}</strong> | Barcode: <strong>{selectedSourceRow.barcode || "-"}</strong>
            </div>
          ) : null}

          <div style={actionRow}>
            <button type="submit" disabled={submitting || loading} style={primaryButton}>
              {submitting ? "Recording..." : "Record Movement"}
            </button>
            <button type="button" onClick={resetForm} style={ghostButton}>
              Reset
            </button>
          </div>
        </form>
      </div>

      <div style={panel}>
        <div style={tableHeaderRow}>
          <h3 style={panelTitle}>Recent Ledger Entries</h3>
          {loading ? <span style={tableMeta}>Loading...</span> : <span style={tableMeta}>{rows.length} rows</span>}
        </div>

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
                <th style={th}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td style={emptyCell} colSpan={7}>
                    No stock movement records found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id || `${row.movement_type}-${row.created_at}-${row.reference_no || "na"}`}>
                    <td style={td}>{formatDate(row.created_at)}</td>
                    <td style={td}>{row.movement_type || "-"}</td>
                    <td style={td}>{row.drug_name || "-"}</td>
                    <td style={td}>{row.quantity ?? "-"}</td>
                    <td style={td}>{row.from_pharmacy || "-"}</td>
                    <td style={td}>{row.to_pharmacy || "-"}</td>
                    <td style={td}>{row.reference_no || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const pageWrap = {
  display: "grid",
  gap: "16px",
};

const heroCard = {
  background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 46%, #0ea5e9 100%)",
  borderRadius: "14px",
  padding: "18px 20px",
  color: "#f8fafc",
  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.2)",
};

const heroEyebrow = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  opacity: 0.85,
  marginBottom: "6px",
};

const heroTitle = {
  margin: 0,
  fontSize: "24px",
  letterSpacing: "0.01em",
};

const heroSubtitle = {
  marginTop: "8px",
  marginBottom: 0,
  fontSize: "13px",
  opacity: 0.92,
};

const feedbackBox = {
  borderRadius: "10px",
  padding: "12px 14px",
  fontSize: "13px",
  fontWeight: 600,
};

const panel = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "16px",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
};

const panelTitle = {
  marginTop: 0,
  marginBottom: "12px",
  fontSize: "17px",
  color: "#0f172a",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const fieldGroup = {
  display: "grid",
  gap: "6px",
};

const fieldLabel = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#334155",
};

const inputStyle = {
  width: "100%",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  padding: "9px 10px",
  fontSize: "13px",
  boxSizing: "border-box",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "84px",
  resize: "vertical",
};

const balanceBanner = {
  marginTop: "12px",
  borderRadius: "8px",
  background: "#e0f2fe",
  border: "1px solid #bae6fd",
  color: "#075985",
  padding: "9px 10px",
  fontSize: "13px",
};

const inventoryPickerWrap = {
  marginTop: "14px",
  display: "grid",
  gap: "8px",
};

const inventoryTableWrap = {
  overflowX: "auto",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
};

const selectedInventoryRowStyle = {
  background: "#eff6ff",
};

const rowSelectButton = {
  border: "1px solid #93c5fd",
  borderRadius: "6px",
  background: "#ffffff",
  color: "#1d4ed8",
  fontSize: "12px",
  fontWeight: 600,
  padding: "6px 8px",
  cursor: "pointer",
};

const actionRow = {
  marginTop: "14px",
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const primaryButton = {
  border: "none",
  borderRadius: "9px",
  padding: "10px 14px",
  background: "#1d4ed8",
  color: "#ffffff",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostButton = {
  border: "1px solid #cbd5e1",
  borderRadius: "9px",
  padding: "10px 14px",
  background: "#ffffff",
  color: "#1e293b",
  fontWeight: 600,
  cursor: "pointer",
};

const tableHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "10px",
};

const tableMeta = {
  fontSize: "12px",
  color: "#64748b",
};

const tableWrap = {
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  borderBottom: "1px solid #cbd5e1",
  padding: "9px 8px",
  textAlign: "left",
  fontSize: "12px",
  color: "#334155",
  whiteSpace: "nowrap",
};

const td = {
  borderBottom: "1px solid #e2e8f0",
  padding: "10px 8px",
  fontSize: "12px",
  color: "#0f172a",
  whiteSpace: "nowrap",
};

const emptyCell = {
  ...td,
  textAlign: "center",
  color: "#64748b",
};
