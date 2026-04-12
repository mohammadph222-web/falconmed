import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "./lib/supabaseClient";
import { extractUnits } from "./utils/packagingEngine";
import { getDrugByCode, searchDrugs } from "./utils/drugLookup";

const DRUG_DROPDOWN_LIMIT = 20;
const IMPORT_PREVIEW_LIMIT = 15;
const IMPORT_REQUIRED_COLUMNS = ["drug_code", "quantity"];
const IMPORT_EXPECTED_COLUMNS = [
  "drug_code",
  "quantity",
  "quantity_mode",
  "batch_no",
  "expiry_date",
];

function normalizeText(value) {
  return String(value || "").trim();
}

function buildDisplayName(row) {
  const display = normalizeText(row?.display_name);
  if (display) return display;

  const composed = [
    normalizeText(row?.brand_name),
    normalizeText(row?.strength),
    normalizeText(row?.dosage_form),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (composed) return composed;

  return normalizeText(row?.brand_name || row?.generic_name);
}

function isValidDateText(value) {
  if (!value) return true;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

export default function InventoryManagementPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [drugOptions, setDrugOptions] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");

  const [drug, setDrug] = useState("");
  const [drugCode, setDrugCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [expiry, setExpiry] = useState("");
  const [batch, setBatch] = useState("");

  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [drugCodeLookup, setDrugCodeLookup] = useState(null);
  const [drugCodeResults, setDrugCodeResults] = useState([]);
  const [showDrugCodeDropdown, setShowDrugCodeDropdown] = useState(false);
  const [drugCodeMessage, setDrugCodeMessage] = useState("");
  const [debouncedDrugCode, setDebouncedDrugCode] = useState("");

  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importSummary, setImportSummary] = useState({
    total: 0,
    valid: 0,
    invalid: 0,
    expectedColumns: IMPORT_EXPECTED_COLUMNS,
    missingColumns: [],
  });
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);
  const importFileInputRef = useRef(null);

  const normalizedDrugQuery = useMemo(() => drug.trim().toLowerCase(), [drug]);
  const normalizedDrugCodeQuery = useMemo(() => drugCode.trim(), [drugCode]);

  const selectedPharmacyName = useMemo(() => {
    const selected = pharmacies.find((p) => String(p.id) === String(selectedPharmacyId));
    return selected?.name || "-";
  }, [pharmacies, selectedPharmacyId]);

  const filteredInventory = useMemo(() => {
    if (!selectedPharmacyId) return inventory;
    return inventory.filter(
      (item) => String(item?.pharmacy_id || "") === String(selectedPharmacyId)
    );
  }, [inventory, selectedPharmacyId]);

  const drugOptionsIndexed = useMemo(
    () =>
      drugOptions.map((name) => ({
        name,
        searchKey: String(name || "").toLowerCase(),
      })),
    [drugOptions]
  );

  useEffect(() => {
    void loadPharmacies();
    void loadInventory();
    void loadDrugs();
  }, []);

  async function loadPharmacies() {
    const { data, error: pharmaciesError } = await supabase.from("pharmacies").select("*");
    if (!pharmaciesError) {
      setPharmacies(data || []);
      if (!selectedPharmacyId && data?.length) {
        setSelectedPharmacyId(data[0].id);
      }
    }
  }

  async function loadInventory() {
    const { data, error: inventoryError } = await supabase
      .from("pharmacy_inventory")
      .select("*")
      .order("drug_name", { ascending: true });

    if (!inventoryError) setInventory(data || []);
    setLoading(false);
  }

  async function loadDrugs() {
    let all = [];
    let page = 0;

    while (true) {
      const { data, error: drugsError } = await supabase
        .from("drug_master")
        .select("drug_name")
        .range(page, page + 999);

      if (drugsError || !data?.length) break;

      all = [...all, ...data];
      page += 1000;

      if (data.length < 1000) break;
    }

    const names = [...new Set(all.map((d) => d.drug_name).filter(Boolean))];
    setDrugOptions(names.sort());
  }

  const filteredDrugs = useMemo(() => {
    if (!normalizedDrugQuery) return drugOptions.slice(0, DRUG_DROPDOWN_LIMIT);

    return drugOptionsIndexed
      .filter((d) => d.searchKey.includes(normalizedDrugQuery))
      .slice(0, DRUG_DROPDOWN_LIMIT)
      .map((d) => d.name);
  }, [normalizedDrugQuery, drugOptions, drugOptionsIndexed]);

  const renderedRows = useMemo(
    () =>
      filteredInventory.map((i, index) => (
        <tr key={i.id} style={index % 2 === 0 ? tableRow : tableRowAlt}>
          <td style={tdDrug}>{i.drug_name}</td>
          <td style={td}>{i.quantity}</td>
          <td style={td}>{i.batch_no || "-"}</td>
          <td style={td}>{i.expiry_date || "-"}</td>
        </tr>
      )),
    [filteredInventory]
  );

  const handleDrugInputChange = useCallback((event) => {
    setDrug(event.target.value);
    setShowDrugDropdown(true);
  }, []);

  const handleDropdownSelect = useCallback((value) => {
    setDrug(value);
    setShowDrugDropdown(false);
  }, []);

  const applyDrugLookup = useCallback((row) => {
    if (!row) {
      setDrugCodeLookup(null);
      setDrugCodeMessage("Drug code not found");
      return;
    }

    const displayName = buildDisplayName(row);

    setDrugCodeLookup(row);
    setDrugCodeMessage("");
    setDrugCode(row.drug_code || "");
    if (displayName) setDrug(displayName);
    if (row.barcode) setBarcode(row.barcode);
    if (
      row.pharmacy_price !== undefined &&
      row.pharmacy_price !== null &&
      row.pharmacy_price !== ""
    ) {
      setCost(String(row.pharmacy_price));
    }
  }, []);

  const handleDrugCodeChange = useCallback((event) => {
    setDrugCode(event.target.value);
    setShowDrugCodeDropdown(true);
    setDrugCodeMessage("");
  }, []);

  const selectDrugCodeResult = useCallback(
    (row) => {
      applyDrugLookup(row);
      setDrugCodeResults([]);
      setShowDrugCodeDropdown(false);
    },
    [applyDrugLookup]
  );

  const handleDrugCodeBlur = useCallback(() => {
    window.setTimeout(async () => {
      const code = normalizedDrugCodeQuery;
      if (!code) {
        setShowDrugCodeDropdown(false);
        setDrugCodeMessage("");
        return;
      }

      try {
        const row = await getDrugByCode(code);
        if (row) {
          applyDrugLookup(row);
        } else {
          setDrugCodeLookup(null);
          setDrugCodeMessage("Drug code not found");
        }
      } catch {
        setDrugCodeMessage("Drug code not found");
      }

      setShowDrugCodeDropdown(false);
    }, 120);
  }, [applyDrugLookup, normalizedDrugCodeQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedDrugCode(normalizedDrugCodeQuery);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [normalizedDrugCodeQuery]);

  useEffect(() => {
    let canceled = false;

    if (!debouncedDrugCode || debouncedDrugCode.length < 2) {
      setDrugCodeResults([]);
      return;
    }

    const run = async () => {
      try {
        const rows = await searchDrugs(debouncedDrugCode);
        if (!canceled) setDrugCodeResults(rows || []);
      } catch {
        if (!canceled) setDrugCodeResults([]);
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [debouncedDrugCode]);

  const clearImportPreview = useCallback(() => {
    setImportPreviewRows([]);
    setImportSummary({
      total: 0,
      valid: 0,
      invalid: 0,
      expectedColumns: IMPORT_EXPECTED_COLUMNS,
      missingColumns: [],
    });
    setImportError("");
    setImportSuccess("");
    setImportFileName("");
    if (importFileInputRef.current) {
      importFileInputRef.current.value = "";
    }
  }, []);

  const handleImportFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError("");
    setImportSuccess("");
    setImportFileName(file.name || "");
    setIsParsingImport(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const headers = Object.keys(results.data?.[0] || {}).map((h) => normalizeText(h));
          const missingColumns = IMPORT_REQUIRED_COLUMNS.filter(
            (required) => !headers.includes(required)
          );

          if (missingColumns.length > 0) {
            setImportPreviewRows([]);
            setImportSummary({
              total: 0,
              valid: 0,
              invalid: 0,
              expectedColumns: IMPORT_EXPECTED_COLUMNS,
              missingColumns,
            });
            setImportError(`Missing required columns: ${missingColumns.join(", ")}`);
            return;
          }

          const rawRows = (results.data || [])
            .map((row) => ({
              drug_code: normalizeText(row?.drug_code),
              quantity: normalizeText(row?.quantity),
              quantity_mode: normalizeText(row?.quantity_mode).toUpperCase(),
              batch_no: normalizeText(row?.batch_no),
              expiry_date: normalizeText(row?.expiry_date),
            }))
            .filter(
              (row) =>
                row.drug_code ||
                row.quantity ||
                row.quantity_mode ||
                row.batch_no ||
                row.expiry_date
            );

          const uniqueDrugCodes = [
            ...new Set(rawRows.map((row) => row.drug_code).filter(Boolean)),
          ];
          const lookupMap = new Map();

          await Promise.all(
            uniqueDrugCodes.map(async (code) => {
              try {
                const lookup = await getDrugByCode(code);
                lookupMap.set(code, lookup || null);
              } catch {
                lookupMap.set(code, null);
              }
            })
          );

          const processedRows = rawRows.map((row, index) => {
            const quantityNumber = Number(row.quantity);
            const validMode = row.quantity_mode === "PACK" || row.quantity_mode === "UNIT";
            const quantityMode = validMode ? row.quantity_mode : "UNIT";
            const expiryValid = isValidDateText(row.expiry_date);

            let status = "Valid";
            let reason = "";

            if (!row.drug_code) {
              status = "Invalid";
              reason = "Missing drug_code";
            } else if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
              status = "Invalid";
              reason = "Invalid quantity";
            } else if (!expiryValid) {
              status = "Invalid";
              reason = "Invalid expiry_date";
            }

            const lookup = lookupMap.get(row.drug_code) || null;
            const resolvedDrugName =
              buildDisplayName(lookup) ||
              normalizeText(lookup?.brand_name || lookup?.generic_name) ||
              row.drug_code;

            return {
              id: index + 1,
              drug_code: row.drug_code,
              resolved_drug_name: resolvedDrugName,
              quantity: Number.isFinite(quantityNumber) ? quantityNumber : row.quantity,
              quantity_mode: quantityMode,
              batch_no: row.batch_no,
              expiry_date: row.expiry_date,
              status,
              reason,
              isValid: status === "Valid",
              lookup,
            };
          });

          const valid = processedRows.filter((row) => row.isValid).length;
          const invalid = processedRows.length - valid;

          setImportPreviewRows(processedRows);
          setImportSummary({
            total: processedRows.length,
            valid,
            invalid,
            expectedColumns: IMPORT_EXPECTED_COLUMNS,
            missingColumns: [],
          });

          if (processedRows.length === 0) {
            setImportError("No importable rows found in the uploaded file.");
          } else {
            setImportError("");
          }
        } finally {
          setIsParsingImport(false);
        }
      },
      error: () => {
        setIsParsingImport(false);
        setImportError("Unable to parse CSV file.");
      },
    });
  }, []);

  const handleConfirmImport = useCallback(async () => {
    setImportError("");
    setImportSuccess("");
    setError("");

    if (!selectedPharmacyId) {
      setImportError("Select an active pharmacy before importing.");
      return;
    }

    const validRows = importPreviewRows.filter((row) => row.isValid);
    if (validRows.length === 0) {
      setImportError("No valid rows available for import.");
      return;
    }

    setIsConfirmingImport(true);

    try {
      const payload = validRows.map((row) => ({
        pharmacy_id: selectedPharmacyId,
        drug_name: row.resolved_drug_name || row.drug_code,
        quantity: Number(row.quantity),
        batch_no: row.batch_no || null,
        expiry_date: row.expiry_date || null,
        barcode: normalizeText(row.lookup?.barcode) || null,
        unit_cost:
          row.lookup?.pharmacy_price !== undefined && row.lookup?.pharmacy_price !== null
            ? Number(row.lookup.pharmacy_price) || 0
            : 0,
      }));

      const { error: insertError } = await supabase.from("pharmacy_inventory").insert(payload);

      if (insertError) {
        throw new Error(insertError.message || "Bulk import failed.");
      }

      await loadInventory();
      clearImportPreview();
      setImportSuccess(`Bulk import completed. Inserted ${payload.length} rows.`);
      setSuccess(`Bulk import completed. Inserted ${payload.length} rows.`);
    } catch (importInsertError) {
      setImportError(importInsertError?.message || "Bulk import failed.");
    } finally {
      setIsConfirmingImport(false);
    }
  }, [clearImportPreview, importPreviewRows, selectedPharmacyId]);

  async function addInventory(event) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (!drug) {
      setError("Drug required");
      return;
    }

    const unitsPerPack = extractUnits(drugCodeLookup?.package_size || "1");
    const safeUnitsPerPack =
      Number.isFinite(unitsPerPack) && unitsPerPack > 0 ? unitsPerPack : 1;
    const quantity = parseFloat(qty) * safeUnitsPerPack;

    if (!quantity || quantity <= 0) {
      setError("Quantity invalid");
      return;
    }

    const payload = {
      pharmacy_id: selectedPharmacyId,
      drug_name: drug,
      quantity,
      batch_no: batch || null,
      expiry_date: expiry || null,
      barcode: barcode || null,
      unit_cost: cost ? parseFloat(cost) : 0,
    };

    const { error: insertError } = await supabase.from("pharmacy_inventory").insert([payload]);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess("Inventory added");

    setDrug("");
    setDrugCode("");
    setQty("");
    setBatch("");
    setCost("");
    setBarcode("");
    setExpiry("");
    setDrugCodeLookup(null);
    setDrugCodeMessage("");

    await loadInventory();
  }

  const previewRows = useMemo(
    () => importPreviewRows.slice(0, IMPORT_PREVIEW_LIMIT),
    [importPreviewRows]
  );

  const hasValidImportRows = importSummary.valid > 0;

  return (
    <div style={pageShell}>
      <div style={pageWrap}>
        <div style={headerCard}>
          <div style={heroGrid}>
            <div>
              <div style={eyebrow}>Operations Workspace</div>
              <h2 style={title}>Inventory Management</h2>
              <p style={subtitle}>
                Manage pharmacy inventory with a clear, resilient, and executive-grade workflow.
              </p>
            </div>

            <div style={pharmacyStatusCard}>
              <div style={pharmacyStatusLabel}>Active Pharmacy</div>
              <div style={pharmacyStatusName}>{selectedPharmacyName}</div>
              <div style={pharmacyStatusMeta}>
                {loading
                  ? "Inventory syncing..."
                  : `${filteredInventory.length} inventory rows loaded`}
              </div>
            </div>
          </div>
        </div>

        {error ? <div style={alertError}>{error}</div> : null}
        {success ? <div style={alertSuccess}>{success}</div> : null}

        <div style={primaryImportCard}>
          <div style={bulkHeaderRow}>
            <div>
              <div style={sectionEyebrow}>Bulk Workflow</div>
              <div style={sectionTitleNoMargin}>Bulk Inventory Import</div>
            </div>
            <div style={tableMetaBadge}>Active Pharmacy: {selectedPharmacyName}</div>
          </div>

          <div style={importStepsRow}>
            <span style={importStepPill}>A. Upload CSV</span>
            <span style={importStepPill}>B. Parse</span>
            <span style={importStepPill}>C. Validate</span>
            <span style={importStepPill}>D. Preview</span>
            <span style={importStepPill}>E. Confirm</span>
          </div>

          <div style={importActionsRow}>
            <div style={fileInputWrap}>
              <div style={fileInputLabel}>CSV Source</div>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportFileChange}
                disabled={isParsingImport || isConfirmingImport}
                style={fileInputStyle}
              />
            </div>

            <button
              type="button"
              style={ghostButton}
              onClick={clearImportPreview}
              disabled={isParsingImport || isConfirmingImport}
            >
              Clear Preview
            </button>

            {hasValidImportRows ? (
              <button
                type="button"
                style={confirmImportButton}
                onClick={() => {
                  void handleConfirmImport();
                }}
                disabled={isParsingImport || isConfirmingImport}
              >
                {isConfirmingImport
                  ? "Importing..."
                  : `Confirm Import (${importSummary.valid})`}
              </button>
            ) : null}
          </div>

          {isParsingImport ? (
            <div style={tableMeta}>Parsing CSV and validating rows...</div>
          ) : null}
          {importFileName ? <div style={tableMeta}>File: {importFileName}</div> : null}
          {importError ? <div style={alertError}>{importError}</div> : null}
          {importSuccess ? <div style={alertSuccess}>{importSuccess}</div> : null}

          <div style={importSummaryGrid}>
            <div style={summaryStatCard}>
              <div style={summaryStatLabel}>Total Rows</div>
              <div style={summaryStatValue}>{importSummary.total}</div>
            </div>
            <div style={summaryStatCard}>
              <div style={summaryStatLabel}>Valid Rows</div>
              <div style={summaryStatValue}>{importSummary.valid}</div>
            </div>
            <div style={summaryStatCard}>
              <div style={summaryStatLabel}>Invalid Rows</div>
              <div style={summaryStatValue}>{importSummary.invalid}</div>
            </div>
            <div style={summaryStatCard}>
              <div style={summaryStatLabel}>Active Pharmacy</div>
              <div style={summaryStatValueSmall}>{selectedPharmacyName}</div>
            </div>
          </div>

          {importSummary.missingColumns.length > 0 ? (
            <div style={alertError}>
              Missing required columns: {importSummary.missingColumns.join(", ")}. Expected:{" "}
              {importSummary.expectedColumns.join(", ")}.
            </div>
          ) : null}

          {previewRows.length > 0 ? (
            <div style={tableWrapPrimary}>
              <table style={table}>
                <thead style={theadPrimary}>
                  <tr>
                    <th style={th}>drug_code</th>
                    <th style={th}>resolved drug_name</th>
                    <th style={th}>quantity</th>
                    <th style={th}>quantity_mode</th>
                    <th style={th}>batch_no</th>
                    <th style={th}>expiry_date</th>
                    <th style={th}>status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr
                      key={`preview-${row.id}`}
                      style={
                        row.isValid
                          ? index % 2 === 0
                            ? tableRow
                            : tableRowAlt
                          : invalidRow
                      }
                    >
                      <td style={td}>{row.drug_code || "-"}</td>
                      <td style={tdDrug}>{row.resolved_drug_name || "-"}</td>
                      <td style={td}>{row.quantity}</td>
                      <td style={td}>{row.quantity_mode}</td>
                      <td style={td}>{row.batch_no || "-"}</td>
                      <td style={td}>{row.expiry_date || "-"}</td>
                      <td style={td}>
                        <span style={row.isValid ? statusBadgeValid : statusBadgeInvalid}>
                          {row.status}
                        </span>
                        {row.reason ? (
                          <span style={statusReasonText}>{` (${row.reason})`}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div style={contentCardSecondary}>
          <div style={sectionEyebrow}>Manual Entry</div>
          <div style={sectionTitle}>Add Inventory</div>

          <form onSubmit={addInventory} style={formGrid}>
            <div style={{ position: "relative" }}>
              <input
                placeholder="Drug Code"
                value={drugCode}
                onChange={handleDrugCodeChange}
                onFocus={() => setShowDrugCodeDropdown(true)}
                onBlur={handleDrugCodeBlur}
                style={inputStyle}
              />

              {showDrugCodeDropdown && drugCode && drugCodeResults.length > 0 ? (
                <div style={dropdown}>
                  {drugCodeResults.map((row) => (
                    <div
                      key={`${row.drug_code || "no-code"}-${row.brand_name || "no-name"}`}
                      style={dropdownItem}
                      onMouseDown={() => selectDrugCodeResult(row)}
                    >
                      {row.drug_code || "-"} •{" "}
                      {row.brand_name || row.generic_name || "Unnamed drug"}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <select
              value={selectedPharmacyId}
              onChange={(event) => setSelectedPharmacyId(event.target.value)}
              style={inputStyle}
            >
              <option value="">Select Pharmacy</option>
              {pharmacies.map((pharmacy) => (
                <option key={pharmacy.id} value={pharmacy.id}>
                  {pharmacy.name}
                </option>
              ))}
            </select>

            <div style={{ position: "relative" }}>
              <input
                placeholder="Search drug"
                value={drug}
                onChange={handleDrugInputChange}
                onFocus={() => setShowDrugDropdown(true)}
                style={inputStyle}
              />

              {showDrugDropdown && drug ? (
                <div style={dropdown}>
                  {filteredDrugs.map((option) => (
                    <div
                      key={option}
                      style={dropdownItem}
                      onMouseDown={() => {
                        handleDropdownSelect(option);
                      }}
                    >
                      {option}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <input
              placeholder="Quantity (UNIT)"
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              style={inputStyle}
            />

            <input
              placeholder="Batch"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              style={inputStyle}
            />

            <input
              placeholder="Expiry"
              type="date"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
              style={inputStyle}
            />

            <input
              placeholder="Cost"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              style={inputStyle}
            />

            <button type="submit" style={primaryButton}>
              Add Inventory
            </button>
          </form>

          {drugCodeMessage ? <div style={alertError}>{drugCodeMessage}</div> : null}

          {drugCodeLookup ? (
            <div style={lookupCard}>
              <div style={lookupTitle}>
                {drugCodeLookup.brand_name || drugCodeLookup.generic_name || "Unnamed drug"}
              </div>
              <div style={lookupGrid}>
                <div>
                  <strong>Code:</strong> {drugCodeLookup.drug_code || "-"}
                </div>
                <div>
                  <strong>Generic:</strong> {drugCodeLookup.generic_name || "-"}
                </div>
                <div>
                  <strong>Strength:</strong> {drugCodeLookup.strength || "-"}
                </div>
                <div>
                  <strong>Dosage:</strong> {drugCodeLookup.dosage_form || "-"}
                </div>
                <div>
                  <strong>Pack:</strong> {drugCodeLookup.package_size || "-"}
                </div>
                <div>
                  <strong>Pharmacy Price:</strong> {drugCodeLookup.pharmacy_price ?? "-"}
                </div>
                <div>
                  <strong>Public Price:</strong> {drugCodeLookup.public_price ?? "-"}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div style={contentCard}>
          <div style={tableHeaderRow}>
            <div style={sectionTitleNoMargin}>Inventory Records</div>
            <div style={tableMetaBadge}>
              {loading ? "Loading..." : `${filteredInventory.length} rows`}
            </div>
          </div>

          <div style={tableWrap}>
            <table style={table}>
              <thead style={thead}>
                <tr>
                  <th style={th}>Drug</th>
                  <th style={th}>Quantity</th>
                  <th style={th}>Batch</th>
                  <th style={th}>Expiry</th>
                </tr>
              </thead>
              <tbody>{renderedRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const dropdown = {
  position: "absolute",
  background: "#fff",
  border: "1px solid #dde6f1",
  borderRadius: 10,
  width: "100%",
  maxHeight: 220,
  overflowY: "auto",
  zIndex: 20,
  boxShadow: "0 10px 20px rgba(15, 23, 42, 0.08)",
};

const dropdownItem = {
  padding: "10px 12px",
  cursor: "pointer",
  borderBottom: "1px solid #edf2f7",
  fontSize: 13,
  color: "#0f172a",
};

const pageShell = {
  background: "#f5f7fb",
  padding: "8px 2px 20px",
};

const pageWrap = {
  display: "grid",
  gap: 18,
  maxWidth: 1180,
  margin: "0 auto",
};

const headerCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)",
  border: "1px solid #dbe6f4",
  borderRadius: 18,
  padding: "22px 24px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.06)",
};

const heroGrid = {
  display: "grid",
  gridTemplateColumns: "1.5fr minmax(220px, 0.8fr)",
  gap: 16,
  alignItems: "start",
};

const eyebrow = {
  fontSize: 10.5,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 750,
  color: "#48617f",
  marginBottom: 8,
};

const title = {
  margin: 0,
  fontSize: 34,
  lineHeight: 1.15,
  letterSpacing: "-0.02em",
  color: "#0a1424",
};

const subtitle = {
  margin: "10px 0 0",
  fontSize: 14.5,
  lineHeight: 1.6,
  color: "#4b5f79",
  maxWidth: 620,
};

const pharmacyStatusCard = {
  border: "1px solid #dbe7f6",
  borderRadius: 14,
  background: "linear-gradient(180deg, #fafdff 0%, #f3f8ff 100%)",
  padding: "12px 14px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
};

const pharmacyStatusLabel = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  color: "#5a6f89",
  fontWeight: 700,
};

const pharmacyStatusName = {
  marginTop: 6,
  fontSize: 16,
  color: "#0f2138",
  fontWeight: 750,
  lineHeight: 1.3,
};

const pharmacyStatusMeta = {
  marginTop: 6,
  fontSize: 12,
  color: "#5b6f86",
};

const alert = {
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid transparent",
  color: "#0f172a",
  background: "#f8fafc",
};

const alertError = {
  ...alert,
  color: "#991b1b",
  background: "#fef2f2",
  border: "1px solid #fecaca",
};

const alertSuccess = {
  ...alert,
  color: "#065f46",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
};

const contentCard = {
  background: "#ffffff",
  border: "1px solid #e0e9f5",
  borderRadius: 16,
  padding: "18px 18px 16px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.045)",
};

const contentCardSecondary = {
  ...contentCard,
  border: "1px solid #e6edf7",
  background: "#ffffff",
};

const primaryImportCard = {
  ...contentCard,
  border: "1px solid #d8e5f5",
  background: "linear-gradient(180deg, #ffffff 0%, #fafdff 100%)",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.065)",
  position: "relative",
};

const sectionEyebrow = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#5f7188",
  marginBottom: 6,
};

const sectionTitle = {
  fontSize: 18,
  fontWeight: 760,
  color: "#0f172a",
  marginBottom: 14,
  letterSpacing: "-0.01em",
};

const sectionTitleNoMargin = {
  fontSize: 18,
  fontWeight: 760,
  color: "#0f172a",
  letterSpacing: "-0.01em",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 13,
  marginBottom: 6,
};

const inputStyle = {
  width: "100%",
  minHeight: 42,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d4e0ef",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 13,
  boxSizing: "border-box",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.035)",
};

const primaryButton = {
  border: "none",
  borderRadius: 11,
  padding: "11px 15px",
  minHeight: 42,
  background: "linear-gradient(135deg, #1f52c8 0%, #2563eb 100%)",
  color: "#ffffff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 10px 16px rgba(37, 99, 235, 0.22)",
};

const confirmImportButton = {
  ...primaryButton,
  background: "linear-gradient(135deg, #1f4fbc 0%, #1d4ed8 100%)",
  boxShadow: "0 12px 20px rgba(29, 78, 216, 0.28)",
};

const ghostButton = {
  border: "1px solid #c8d6e9",
  borderRadius: 11,
  padding: "11px 14px",
  minHeight: 42,
  background: "#ffffff",
  color: "#1f3148",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const bulkHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  marginBottom: 12,
};

const importStepsRow = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 12,
};

const importStepPill = {
  fontSize: 11,
  fontWeight: 700,
  color: "#3f5877",
  border: "1px solid #d4e0f0",
  borderRadius: 999,
  padding: "6px 11px",
  background: "#f5f9ff",
};

const importActionsRow = {
  display: "flex",
  alignItems: "end",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 13,
};

const fileInputWrap = {
  display: "grid",
  gap: 6,
};

const fileInputLabel = {
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#5a6f89",
};

const fileInputStyle = {
  ...inputStyle,
  minHeight: 40,
  padding: "7px 10px",
  maxWidth: 370,
};

const importSummaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
  marginBottom: 12,
  marginTop: 12,
};

const summaryStatCard = {
  border: "1px solid #d7e4f5",
  borderRadius: 13,
  background: "linear-gradient(180deg, #fafdff 0%, #f3f8ff 100%)",
  padding: "11px 13px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.85)",
};

const summaryStatLabel = {
  fontSize: 11,
  fontWeight: 750,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#4f6580",
  marginBottom: 6,
};

const summaryStatValue = {
  fontSize: 24,
  fontWeight: 800,
  color: "#0f172a",
  lineHeight: 1,
};

const summaryStatValueSmall = {
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a",
  lineHeight: 1.35,
};

const tableHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  marginBottom: 12,
};

const tableMeta = {
  fontSize: 12,
  fontWeight: 600,
  color: "#5f6b7d",
};

const tableMetaBadge = {
  fontSize: 12,
  fontWeight: 700,
  color: "#3f5e84",
  border: "1px solid #d2dfef",
  borderRadius: 999,
  background: "#f6f9ff",
  padding: "6px 10px",
};

const tableWrap = {
  border: "1px solid #e1e9f4",
  borderRadius: 14,
  overflowX: "auto",
  background: "#fff",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
};

const tableWrapPrimary = {
  ...tableWrap,
  border: "1px solid #dbe6f4",
  borderRadius: 14,
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: 760,
};

const thead = {
  background: "#f8fbff",
};

const theadPrimary = {
  background: "#f3f8ff",
};

const th = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#526983",
  padding: "12px 12px",
  borderBottom: "1px solid #dbe5f2",
  whiteSpace: "nowrap",
};

const td = {
  fontSize: 13,
  color: "#0f172a",
  padding: "12px 12px",
  borderBottom: "1px solid #edf2f7",
  lineHeight: 1.48,
};

const tdDrug = {
  ...td,
  minWidth: 260,
  whiteSpace: "normal",
  wordBreak: "break-word",
};

const tableRow = {
  background: "#ffffff",
};

const tableRowAlt = {
  background: "#fbfdff",
};

const invalidRow = {
  background: "#fff7f7",
};

const statusBadge = {
  display: "inline-block",
  borderRadius: 999,
  padding: "3px 9px",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const statusBadgeValid = {
  ...statusBadge,
  color: "#0f5132",
  background: "#dff7eb",
  border: "1px solid #9be2bd",
};

const statusBadgeInvalid = {
  ...statusBadge,
  color: "#8a1c1c",
  background: "#ffe9e9",
  border: "1px solid #f8b4b4",
};

const statusReasonText = {
  fontSize: 11,
  color: "#6b7280",
};

const lookupCard = {
  marginTop: 12,
  border: "1px solid #d7e4f5",
  borderRadius: 13,
  padding: "12px 13px",
  background: "linear-gradient(180deg, #fafdff 0%, #f4f9ff 100%)",
  fontSize: 13,
  color: "#1d3048",
  boxShadow: "0 4px 10px rgba(15, 23, 42, 0.035)",
};

const lookupTitle = {
  fontWeight: 700,
  fontSize: 14,
  marginBottom: 8,
  color: "#0f172a",
};

const lookupGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 7,
};