import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import WorkspacePharmacySelector from "./components/WorkspacePharmacySelector";
import {
  resolveWorkspacePharmacies,
  resolveWorkspaceSelection,
  writeWorkspacePharmacyId,
} from "./lib/workspacePharmacy";
import { formatAed, formatQty } from "./utils/inventoryAnalytics";
import { MetricCard, StatusPill } from "./ui";

function parseCsvLine(line) {
  return String(line || "")
    .split(",")
    .map((cell) => cell.trim());
}

function buildDrugName(drug, fallbackCode = "") {
  return (
    [drug?.brand_name, drug?.strength, drug?.dosage_form]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    String(drug?.generic_name || "").trim() ||
    fallbackCode
  );
}

function extractPackSizeFromPackageSize(packageSize) {
  const text = String(packageSize || "").trim();
  if (!text) return 1;

  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 1;

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;

  return Math.floor(parsed);
}

function buildStockStatus(quantity) {
  const qty = Number(quantity || 0);
  if (qty <= 0) return "OUT";
  if (qty <= 10) return "LOW";
  return "OK";
}

function getStockStatusStyle(quantity) {
  const status = buildStockStatus(quantity);

  if (status === "OUT") return statusBadgeOut;
  if (status === "LOW") return statusBadgeLow;
  return statusBadgeOk;
}

export default function InventoryOverviewPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [previewRows, setPreviewRows] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState({ type: "", text: "" });

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

    const filtered = (inventoryRows || []).filter(
      (row) => String(row?.pharmacy_id || "").trim() === selected
    );

    setRows(filtered);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleImportCSV = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!supabase) {
      setImportFeedback({
        type: "error",
        text: "Supabase is not configured.",
      });
      event.target.value = "";
      return;
    }

    if (!selectedPharmacyId) {
      setImportFeedback({
        type: "error",
        text: "Please select an active pharmacy first.",
      });
      event.target.value = "";
      return;
    }

    setParsing(true);
    setPreviewRows([]);
    setPreviewOpen(false);
    setImportFeedback({ type: "", text: "" });

    try {
      const text = await file.text();
      const rawLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

      if (rawLines.length <= 1) {
        throw new Error("CSV file is empty or missing data rows.");
      }

      const header = parseCsvLine(rawLines[0]).map((col) => col.toLowerCase());
      const expected = ["drug_code", "quantity", "quantity_mode", "batch_no", "expiry_date"];
      const headerOk = expected.every((key, index) => header[index] === key);

      if (!headerOk) {
        throw new Error(
          "CSV header must be exactly: drug_code,quantity,quantity_mode,batch_no,expiry_date"
        );
      }

      const dataLines = rawLines.slice(1);
      const nextPreviewRows = [];

      for (let i = 0; i < dataLines.length; i += 1) {
        const cells = parseCsvLine(dataLines[i]);

        const previewRow = {
          rowNo: i + 2,
          pharmacy_id: selectedPharmacyId,
          drug_code: "",
          drug_name: "",
          quantity: 0,
          quantity_mode: "unit",
          calculated_quantity: 0,
          batch_no: "",
          expiry_date: "",
          unit_cost: 0,
          package_size: "",
          status: "error",
          message: "",
        };

        if (cells.length < 5) {
          previewRow.message = "Missing required columns";
          nextPreviewRows.push(previewRow);
          continue;
        }

        const [drug_code, quantity, quantity_mode, batch_no, expiry_date] = cells;

        previewRow.drug_code = String(drug_code || "").trim();
        previewRow.quantity = Number(quantity || 0);
        previewRow.quantity_mode = String(quantity_mode || "unit").trim().toLowerCase();
        previewRow.batch_no = String(batch_no || "").trim();
        previewRow.expiry_date = String(expiry_date || "").trim();

        if (!previewRow.drug_code) {
          previewRow.message = "Missing drug code";
          nextPreviewRows.push(previewRow);
          continue;
        }

        if (!Number.isFinite(previewRow.quantity) || previewRow.quantity <= 0) {
          previewRow.message = "Invalid quantity";
          nextPreviewRows.push(previewRow);
          continue;
        }

        if (!["unit", "pack"].includes(previewRow.quantity_mode)) {
          previewRow.message = "quantity_mode must be unit or pack";
          nextPreviewRows.push(previewRow);
          continue;
        }

        const exactCode = previewRow.drug_code;
        const { data: exactDrug, error: exactError } = await supabase
          .from("drug_master")
          .select(
            "drug_code,brand_name,generic_name,strength,dosage_form,pharmacy_price,package_size"
          )
          .eq("drug_code", exactCode)
          .maybeSingle();

        if (exactError) {
          throw new Error(exactError.message || "Failed to validate drug code.");
        }

        let drug = exactDrug;

        if (!drug) {
          const { data: fuzzyDrug, error: fuzzyError } = await supabase
            .from("drug_master")
            .select(
              "drug_code,brand_name,generic_name,strength,dosage_form,pharmacy_price,package_size"
            )
            .ilike("drug_code", exactCode)
            .maybeSingle();

          if (fuzzyError) {
            throw new Error(fuzzyError.message || "Failed to validate drug code.");
          }

          drug = fuzzyDrug;
        }

        if (!drug) {
          previewRow.message = "Drug code not found";
          nextPreviewRows.push(previewRow);
          continue;
        }

        const packSize = extractPackSizeFromPackageSize(drug.package_size);
        const calculatedQuantity =
          previewRow.quantity_mode === "pack"
            ? Number(previewRow.quantity) * packSize
            : Number(previewRow.quantity);

        previewRow.drug_name = buildDrugName(drug, previewRow.drug_code);
        previewRow.unit_cost = Number(drug.pharmacy_price || 0);
        previewRow.package_size = String(drug.package_size || "");
        previewRow.calculated_quantity = calculatedQuantity;
        previewRow.status = "ok";
        previewRow.message =
          previewRow.quantity_mode === "pack"
            ? `Ready • ${previewRow.quantity} pack = ${calculatedQuantity} units`
            : "Ready";

        nextPreviewRows.push(previewRow);
      }

      setPreviewRows(nextPreviewRows);
      setPreviewOpen(true);

      const valid = nextPreviewRows.filter((row) => row.status === "ok").length;
      const invalid = nextPreviewRows.length - valid;

      setImportFeedback({
        type: invalid > 0 ? "warning" : "success",
        text: `Preview ready. ${valid} valid row${valid === 1 ? "" : "s"}${
          invalid ? `, ${invalid} invalid` : ""
        }.`,
      });
    } catch (error) {
      setImportFeedback({
        type: "error",
        text: error?.message || "Failed to read CSV file.",
      });
    }

    setParsing(false);
    event.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!supabase) {
      setImportFeedback({
        type: "error",
        text: "Supabase is not configured.",
      });
      return;
    }

    const validRows = previewRows.filter((row) => row.status === "ok");

    if (validRows.length === 0) {
      setImportFeedback({
        type: "error",
        text: "No valid rows to import.",
      });
      return;
    }

    setImporting(true);
    setImportFeedback({ type: "", text: "" });

    try {
      const inserts = validRows.map((row) => ({
        pharmacy_id: selectedPharmacyId,
        drug_name: row.drug_name,
        quantity: Number(row.calculated_quantity || 0),
        batch_no: row.batch_no || "",
        expiry_date: row.expiry_date || null,
        unit_cost: Number(row.unit_cost || 0),
      }));

      const { error } = await supabase.from("pharmacy_inventory").insert(inserts);

      if (error) {
        throw new Error(error.message || "Failed to import inventory rows.");
      }

      setImportFeedback({
        type: "success",
        text: `Inventory imported successfully. Added ${inserts.length} row${
          inserts.length === 1 ? "" : "s"
        }.`,
      });

      setPreviewRows([]);
      setPreviewOpen(false);
      await loadData(selectedPharmacyId);
    } catch (error) {
      setImportFeedback({
        type: "error",
        text: error?.message || "Import failed.",
      });
    }

    setImporting(false);
  };

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

      const text = [row?.drug_name, row?.batch_no, row?.barcode, row?.expiry_date]
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

  const previewSummary = useMemo(() => {
    const valid = previewRows.filter((row) => row.status === "ok").length;
    const invalid = previewRows.filter((row) => row.status !== "ok").length;
    return { valid, invalid };
  }, [previewRows]);

  const selectedPharmacyName = useMemo(() => {
    const match = pharmacies.find((item) => String(item?.id || "") === String(selectedPharmacyId));
    return match?.name || "No active pharmacy";
  }, [pharmacies, selectedPharmacyId]);

  const onSelectPharmacy = (pharmacyId) => {
    writeWorkspacePharmacyId(pharmacyId);
    void loadData(pharmacyId);
  };

  return (
    <div style={pageShell}>
      <div style={pageWrap}>
        <div style={heroCard}>
          <div style={heroContent}>
            <div style={eyebrow}>Operations Workspace</div>
            <h1 style={heroTitle}>Inventory Overview</h1>
            <p style={heroSub}>Operational inventory view for one pharmacy workspace.</p>
          </div>

          <div style={heroRight}>
            <div style={heroMetaCard}>
              <div style={heroMetaLabel}>Active Pharmacy</div>
              <div style={heroMetaValue}>{selectedPharmacyName}</div>
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
        </div>

        <div style={importCard}>
          <div style={cardAccentBar} />

          <div style={importHeader}>
            <div>
              <div style={sectionEyebrow}>Bulk Workflow</div>
              <div style={importTitle}>Bulk Inventory Import</div>
              <div style={importSub}>
                Upload CSV with:
                <strong> drug_code, quantity, quantity_mode, batch_no, expiry_date</strong>
              </div>
            </div>

            <div style={importHeaderActions}>
              <div style={importHintPill}>
                {parsing ? "Preparing preview..." : previewOpen ? "Preview ready" : "Ready for upload"}
              </div>

              <label style={importButton}>
                {parsing ? "Preparing Preview..." : "Import CSV"}
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleImportCSV}
                  style={{ display: "none" }}
                  disabled={parsing || importing}
                />
              </label>
            </div>
          </div>

          {importFeedback.text ? (
            <div
              style={
                importFeedback.type === "error"
                  ? importErrorBox
                  : importFeedback.type === "warning"
                  ? importWarningBox
                  : importSuccessBox
              }
            >
              {importFeedback.text}
            </div>
          ) : null}
        </div>

        {previewOpen ? (
          <div style={previewCard}>
            <div style={previewHeader}>
              <div>
                <div style={sectionEyebrow}>Validation</div>
                <div style={previewTitle}>Import Preview</div>
                <div style={previewSub}>Review rows before saving to inventory.</div>
              </div>

              <div style={previewActions}>
                <div style={previewPill}>Valid: {previewSummary.valid}</div>
                <div style={previewPillMuted}>Invalid: {previewSummary.invalid}</div>
                <button
                  type="button"
                  style={confirmButton}
                  className="fm-action-btn"
                  onClick={handleConfirmImport}
                  disabled={importing || previewSummary.valid === 0}
                >
                  {importing ? "Importing..." : "Confirm Import"}
                </button>
              </div>
            </div>

            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Row</th>
                    <th style={th}>Drug Code</th>
                    <th style={th}>Drug Name</th>
                    <th style={th}>Qty</th>
                    <th style={th}>Mode</th>
                    <th style={th}>Calculated Qty</th>
                    <th style={th}>Batch</th>
                    <th style={th}>Expiry</th>
                    <th style={th}>Unit Cost</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td style={emptyCell} colSpan={10}>
                        No preview rows.
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((row, index) => (
                      <tr
                        key={`${row.rowNo}-${row.drug_code}-${row.batch_no}`}
                        style={
                          row.status === "ok"
                            ? index % 2 === 0
                              ? previewRowOk
                              : previewRowOkAlt
                            : previewRowError
                        }
                      >
                        <td style={td}>{row.rowNo}</td>
                        <td style={td}>{row.drug_code || "-"}</td>
                        <td style={tdStrong}>{row.drug_name || "-"}</td>
                        <td style={td}>{formatQty(row.quantity || 0)}</td>
                        <td style={td}>{row.quantity_mode || "-"}</td>
                        <td style={td}>{formatQty(row.calculated_quantity || 0)}</td>
                        <td style={td}>{row.batch_no || "-"}</td>
                        <td style={td}>{row.expiry_date || "-"}</td>
                        <td style={td}>{formatAed(row.unit_cost || 0)}</td>
                        <td style={td}>
                          <StatusPill
                            variant={row.status === "ok" ? "success" : "danger"}
                            style={row.status === "ok" ? previewStatusBadgeOk : previewStatusBadgeError}
                          >
                            {row.message}
                          </StatusPill>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div style={toolbarCard}>
          <div style={toolbarHeader}>
            <div>
              <div style={sectionEyebrow}>Filters</div>
              <div style={toolbarTitle}>Inventory View Controls</div>
            </div>
            <div style={toolbarMeta}>{formatQty(viewRows.length)} visible rows</div>
          </div>

          <div style={filterBar}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={searchInput}
              placeholder="Search by drug, batch, barcode, expiry"
            />
            <select
              value={expiryFilter}
              onChange={(event) => setExpiryFilter(event.target.value)}
              style={selectInput}
            >
              <option value="all">All expiry states</option>
              <option value="with-expiry">With expiry date</option>
              <option value="without-expiry">Without expiry date</option>
            </select>
          </div>
        </div>

        <div style={summaryGrid}>
          <MetricCard
            className="ui-hover-lift"
            accent="info"
            icon="LINES"
            label="Filtered Lines"
            value={formatQty(summary.lines)}
          />

          <MetricCard
            className="ui-hover-lift"
            accent="primary"
            icon="QTY"
            label="Total Qty"
            value={formatQty(summary.totalQty)}
          />

          <MetricCard
            className="ui-hover-lift"
            accent="warning"
            icon="AED"
            label="Total Stock Value"
            value={formatAed(summary.totalValue)}
          />
        </div>

        <div style={recordsCard}>
          <div style={recordsHeader}>
            <div>
              <div style={sectionEyebrow}>Records</div>
              <div style={recordsTitle}>Inventory Records</div>
            </div>
            <div style={recordsBadge}>{loading ? "Loading..." : `${viewRows.length} rows`}</div>
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
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={emptyCell} colSpan={7}>
                      Loading inventory...
                    </td>
                  </tr>
                ) : viewRows.length === 0 ? (
                  <tr>
                    <td style={emptyCell} colSpan={7}>
                      No inventory rows found.
                    </td>
                  </tr>
                ) : (
                  viewRows.map((row, index) => {
                    const stockStatus = buildStockStatus(row.quantity);

                    return (
                      <tr
                        key={row.id}
                        className="fm-table-row"
                        style={index % 2 === 0 ? recordsRow : recordsRowAlt}
                      >
                        <td style={tdStrong}>{row.drug_name || "-"}</td>
                        <td style={td}>{formatQty(row.quantity || 0)}</td>
                        <td style={td}>{row.batch_no || "-"}</td>
                        <td style={td}>{row.expiry_date || "-"}</td>
                        <td style={td}>{row.barcode || "-"}</td>
                        <td style={td}>{formatAed(row.unit_cost || 0)}</td>
                        <td style={td}>
                          <StatusPill
                            variant={
                              stockStatus === "OK"
                                ? "success"
                                : stockStatus === "LOW"
                                ? "warning"
                                : "danger"
                            }
                            style={getStockStatusStyle(row.quantity)}
                          >
                            {stockStatus}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const pageShell = {
  background: "#f4f7fb",
  minHeight: "100%",
  padding: "10px 2px 24px",
};

const pageWrap = {
  display: "grid",
  gap: "16px",
  maxWidth: "1280px",
  margin: "0 auto",
};

const heroCard = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "stretch",
  gap: "16px",
  flexWrap: "wrap",
  background: "linear-gradient(120deg, #0f223f 0%, #1e40af 56%, #2563eb 100%)",
  color: "#f8fafc",
  borderRadius: "18px",
  padding: "22px",
  border: "1px solid #1e3a8a",
  boxShadow: "0 18px 34px rgba(30, 64, 175, 0.20)",
};

const heroContent = {
  flex: "1 1 420px",
  minWidth: "280px",
};

const heroRight = {
  display: "grid",
  gap: "12px",
  minWidth: "280px",
  flex: "0 1 360px",
};

const heroMetaCard = {
  background: "rgba(255,255,255,0.10)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "14px",
  padding: "12px 14px",
  backdropFilter: "blur(6px)",
};

const heroMetaLabel = {
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(255,255,255,0.78)",
  marginBottom: "6px",
};

const heroMetaValue = {
  fontSize: "15px",
  fontWeight: 800,
  color: "#ffffff",
  lineHeight: 1.35,
};

const selectorWrap = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "14px",
  padding: "12px",
};

const eyebrow = {
  fontSize: "11px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "rgba(255,255,255,0.72)",
  marginBottom: "8px",
};

const heroTitle = {
  margin: 0,
  fontSize: "29px",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  lineHeight: 1.1,
};

const heroSub = {
  marginTop: "10px",
  marginBottom: 0,
  opacity: 0.92,
  fontSize: "14px",
  lineHeight: 1.6,
  maxWidth: "620px",
};

const sectionEyebrow = {
  fontSize: "10px",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontWeight: 800,
  marginBottom: "6px",
};

const importCard = {
  position: "relative",
  overflow: "hidden",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  border: "1px solid #dbe7f5",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)",
};

const cardAccentBar = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: "4px",
  background: "linear-gradient(90deg, #1e40af 0%, #2563eb 100%)",
};

const importHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  flexWrap: "wrap",
};

const importHeaderActions = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flexWrap: "wrap",
};

const importHintPill = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "#eff6ff",
  color: "#1d4ed8",
  border: "1px solid #bfdbfe",
  fontSize: "12px",
  fontWeight: 700,
};

const importTitle = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const importSub = {
  marginTop: "6px",
  fontSize: "13px",
  color: "#64748b",
  lineHeight: 1.6,
};

const importButton = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "44px",
  padding: "0 18px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, #1e4fcf 0%, #255ccf 100%)",
  color: "#ffffff",
  fontWeight: 800,
  fontSize: "13px",
  cursor: "pointer",
  boxShadow: "0 10px 18px rgba(37, 92, 207, 0.20)",
};

const importSuccessBox = {
  marginTop: "14px",
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "13px",
  fontWeight: 700,
  color: "#065f46",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  boxShadow: "inset 4px 0 0 #10b981",
};

const importWarningBox = {
  marginTop: "14px",
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "13px",
  fontWeight: 700,
  color: "#9a3412",
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  boxShadow: "inset 4px 0 0 #ea580c",
};

const importErrorBox = {
  marginTop: "14px",
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "13px",
  fontWeight: 700,
  color: "#991b1b",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  boxShadow: "inset 4px 0 0 #dc2626",
};

const previewCard = {
  background: "#ffffff",
  border: "1px solid #dbe7f5",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)",
};

const previewHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "14px",
};

const previewTitle = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const previewSub = {
  marginTop: "6px",
  fontSize: "13px",
  color: "#64748b",
};

const previewActions = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
};

const previewPill = {
  padding: "8px 11px",
  borderRadius: "999px",
  background: "#ecfdf5",
  color: "#065f46",
  border: "1px solid #a7f3d0",
  fontSize: "12px",
  fontWeight: 800,
};

const previewPillMuted = {
  padding: "8px 11px",
  borderRadius: "999px",
  background: "#fef2f2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  fontSize: "12px",
  fontWeight: 800,
};

const confirmButton = {
  minHeight: "42px",
  padding: "0 18px",
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
  color: "#ffffff",
  fontWeight: 800,
  fontSize: "13px",
  cursor: "pointer",
  boxShadow: "0 10px 18px rgba(21, 128, 61, 0.22)",
};

const previewRowOk = {
  background: "#f8fffb",
};

const previewRowOkAlt = {
  background: "#f2fcf6",
};

const previewRowError = {
  background: "#fff5f5",
};

const previewStatusBadgeOk = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "28px",
  padding: "4px 10px",
  borderRadius: "999px",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#065f46",
  fontSize: "12px",
  fontWeight: 700,
};

const previewStatusBadgeError = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "28px",
  padding: "4px 10px",
  borderRadius: "999px",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  fontSize: "12px",
  fontWeight: 700,
};

const toolbarCard = {
  background: "#ffffff",
  border: "1px solid #dbe7f5",
  borderRadius: "16px",
  padding: "16px",
  boxShadow: "0 10px 22px rgba(15, 23, 42, 0.04)",
};

const toolbarHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  marginBottom: "12px",
};

const toolbarTitle = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const toolbarMeta = {
  fontSize: "12px",
  fontWeight: 700,
  color: "#475569",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "999px",
  padding: "7px 10px",
};

const filterBar = {
  display: "grid",
  gridTemplateColumns: "1fr 240px",
  gap: "12px",
};

const searchInput = {
  border: "1px solid #d4dfef",
  borderRadius: "12px",
  padding: "12px 13px",
  fontSize: "13px",
  background: "#ffffff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.03)",
  color: "#0f172a",
  outline: "none",
};

const selectInput = {
  border: "1px solid #d4dfef",
  borderRadius: "12px",
  padding: "12px 13px",
  fontSize: "13px",
  background: "#ffffff",
  boxShadow: "0 2px 6px rgba(15, 23, 42, 0.03)",
  color: "#0f172a",
  outline: "none",
};

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "12px",
};

const summaryCard = {
  position: "relative",
  overflow: "hidden",
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  border: "1px solid #dbe7f5",
  borderRadius: "14px",
  padding: "16px",
  boxShadow: "0 12px 22px rgba(15, 23, 42, 0.05)",
};

const summaryTopBorder = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: "4px",
  background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
};

const summaryLabel = {
  fontSize: "11px",
  color: "#64748b",
  textTransform: "uppercase",
  fontWeight: 800,
  letterSpacing: "0.08em",
  marginTop: "4px",
};

const summaryValue = {
  marginTop: "10px",
  fontSize: "24px",
  fontWeight: 800,
  color: "#0f172a",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.02em",
};

const recordsCard = {
  background: "#ffffff",
  border: "1px solid #dbe7f5",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)",
};

const recordsHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  marginBottom: "14px",
};

const recordsTitle = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const recordsBadge = {
  fontSize: "12px",
  fontWeight: 800,
  color: "#1e3a8a",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "999px",
  padding: "8px 11px",
};

const tableWrap = {
  overflowX: "auto",
  background: "#fff",
  border: "1px solid #dbe7f5",
  borderRadius: "14px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.05)",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "900px",
};

const th = {
  textAlign: "left",
  borderBottom: "1px solid #dbe7f5",
  padding: "12px 10px",
  fontSize: "11px",
  color: "#334155",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 800,
  background: "#f8fbff",
  whiteSpace: "nowrap",
};

const td = {
  borderBottom: "1px solid #edf2fa",
  padding: "12px 10px",
  fontSize: "12px",
  color: "#0f172a",
  verticalAlign: "middle",
};

const tdStrong = {
  ...td,
  fontWeight: 700,
};

const emptyCell = {
  ...td,
  textAlign: "center",
  color: "#64748b",
  padding: "18px 12px",
};

const recordsRow = {
  background: "#ffffff",
};

const recordsRowAlt = {
  background: "#fbfdff",
};

const statusBadgeBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "52px",
  minHeight: "28px",
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.02em",
  border: "1px solid transparent",
};

const statusBadgeOk = {
  ...statusBadgeBase,
  color: "#065f46",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
};

const statusBadgeLow = {
  ...statusBadgeBase,
  color: "#9a3412",
  background: "#fff7ed",
  border: "1px solid #fed7aa",
};

const statusBadgeOut = {
  ...statusBadgeBase,
  color: "#991b1b",
  background: "#fef2f2",
  border: "1px solid #fecaca",
};