import React, { useEffect, useMemo, useRef, useState } from "react";
import InsightCard from "./components/InsightCard";
import SkeletonCard from "./components/SkeletonCard";
import StatCard from "./components/StatCard";
import { supabase } from "./lib/supabaseClient";
import { useAnimatedCounter } from "./hooks/useAnimatedCounter";
import {
  getDrugDisplayName,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMaster";
import {
  buildDrugCodeMap,
  findDrugByCode,
  findDrugByDrugCode,
  findDrugByIdentifier,
  getMasterAutofill,
  parseCsvText,
} from "./utils/drugMasterLookup";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";
import { emitInventoryUpdated } from "./utils/inventoryEvents";

const INVENTORY_DRAFT_STORAGE_KEY = "falconmed_inventory_draft";
const INVENTORY_BULK_PREVIEW_STORAGE_KEY = "falconmed_bulk_upload_preview";
const INVENTORY_BULK_SUMMARY_STORAGE_KEY = "falconmed_inventory_upload_summary";

function readStorageJson(key) {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorageJson(key, value) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or serialization failures.
  }
}

function clearStorageKey(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage remove failures.
  }
}

function clearInventoryDraftStorage() {
  clearStorageKey(INVENTORY_DRAFT_STORAGE_KEY);
}

function clearInventoryBulkPreviewStorage() {
  clearStorageKey(INVENTORY_BULK_PREVIEW_STORAGE_KEY);
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getDrugLookupLabel(drug) {
  const barcode = String(drug?.barcode || "").trim();
  if (barcode) {
    return barcode;
  }

  const drugCode = String(drug?.drug_code || "").trim();
  if (drugCode) {
    return drugCode;
  }

  return getDrugDisplayName(drug);
}

function isQueryMatchedToDrug(query, drug) {
  const normalizedQuery = normalizeLookupValue(query);
  if (!normalizedQuery || !drug) {
    return false;
  }

  const candidates = [
    drug?.barcode,
    drug?.drug_code,
    drug?.drug_name,
    drug?.brand_name,
    drug?.generic_name,
    getDrugDisplayName(drug),
  ];

  return candidates.some(
    (value) => normalizeLookupValue(value) === normalizedQuery
  );
}

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function calculateLineValue(quantity, unitCost) {
  return roundMoney(Number(quantity || 0) * Number(unitCost || 0));
}

function resolveSalesPrice(item) {
  return Number(item?.sales_price ?? item?.price_to_public ?? 0);
}

function resolveCostPrice(item) {
  return Number(item?.cost_price ?? item?.unit_cost ?? 0);
}

function resolveCostValue(item) {
  const rawCostValue = Number(item?.cost_value ?? item?.line_value);
  if (Number.isFinite(rawCostValue)) {
    return roundMoney(rawCostValue);
  }
  return calculateLineValue(item?.quantity, resolveCostPrice(item));
}

function parseSafePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveSalesValue(item) {
  const rawSalesValue = Number(item?.sales_value);
  if (Number.isFinite(rawSalesValue)) {
    return roundMoney(rawSalesValue);
  }
  return calculateLineValue(item?.quantity, resolveSalesPrice(item));
}

function resolveMarginValue(item) {
  const rawMarginValue = Number(item?.margin_value);
  if (Number.isFinite(rawMarginValue)) {
    return roundMoney(rawMarginValue);
  }
  return roundMoney(resolveSalesValue(item) - resolveCostValue(item));
}

function buildUniquePharmacies(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const id = String(row?.id || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      name: String(row?.name || "").trim(),
      location: String(row?.location || "").trim(),
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

export default function InventoryManagementPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [allDrugs, setAllDrugs] = useState([]);
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [selectedDrugMaster, setSelectedDrugMaster] = useState(null);

  const [drugCode, setDrugCode] = useState("");
  const [drug, setDrug] = useState("");
  const [brandName, setBrandName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [cost, setCost] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [expiry, setExpiry] = useState("");
  const [batch, setBatch] = useState("");
  const [masterLookupStatus, setMasterLookupStatus] = useState("");
  const [masterLookupTone, setMasterLookupTone] = useState("neutral");

  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [bulkUploadSummary, setBulkUploadSummary] = useState(null);
  const [bulkUploadProcessing, setBulkUploadProcessing] = useState(false);
  const [restoredDraftMessage, setRestoredDraftMessage] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);

  // Import preview + batch tracking
  const [importPreview, setImportPreview] = useState(null);
  // { pharmacyId, pharmacyName, validPayloads, skippedRows, totalQty, estimatedValue, previewRows }
  const [lastImportBatch, setLastImportBatch] = useState(null);
  // { batchId, pharmacyId, pharmacyName, rowCount }
  const [undoProcessing, setUndoProcessing] = useState(false);
  const [lastUploadSignature, setLastUploadSignature] = useState(null);
  // duplicate-detection: "pharmacyId::filename::filesize"

  const drugInputRef = useRef(null);
  const quantityInputRef = useRef(null);
  const bulkFileInputRef = useRef(null);

  const hasUnsavedInventoryFormChanges = useMemo(() => {
    if (editingId) return true;
    return Boolean(
      String(drugCode || "").trim() ||
      String(qty || "").trim() ||
      String(batch || "").trim() ||
      String(expiry || "").trim()
    );
  }, [batch, drugCode, editingId, expiry, qty]);

  const hasUnsavedBulkChanges = useMemo(() => {
    return Boolean(importPreview);
  }, [importPreview]);

  const hasUnsavedChanges = hasUnsavedInventoryFormChanges || hasUnsavedBulkChanges;

  useEffect(() => {
    const draft = readStorageJson(INVENTORY_DRAFT_STORAGE_KEY);
    const preview = readStorageJson(INVENTORY_BULK_PREVIEW_STORAGE_KEY);
    const summary = readStorageJson(INVENTORY_BULK_SUMMARY_STORAGE_KEY);

    let restored = false;

    if (draft?.selectedPharmacyId) {
      setSelectedPharmacyId(String(draft.selectedPharmacyId));
      restored = true;
    }

    if (draft?.form && typeof draft.form === "object") {
      setDrugCode(String(draft.form.drugCode || ""));
      setDrug(String(draft.form.drug || ""));
      setBrandName(String(draft.form.brandName || ""));
      setGenericName(String(draft.form.genericName || ""));
      setBarcode(String(draft.form.barcode || ""));
      setQty(String(draft.form.qty || ""));
      setStockUnit(String(draft.form.stockUnit || ""));
      setCost(String(draft.form.cost || ""));
      setSalesPrice(String(draft.form.salesPrice || ""));
      setExpiry(String(draft.form.expiry || ""));
      setBatch(String(draft.form.batch || ""));
      setMasterLookupStatus(String(draft.form.masterLookupStatus || ""));
      setMasterLookupTone(String(draft.form.masterLookupTone || "neutral"));
      setEditingId(draft.form.editingId || null);
      restored = restored || Boolean(
        String(draft.form.drugCode || "") ||
        String(draft.form.qty || "") ||
        String(draft.form.batch || "") ||
        String(draft.form.expiry || "")
      );
    }

    if (preview) {
      setImportPreview(preview);
      restored = true;
    }

    if (summary) {
      if (summary.bulkUploadSummary) setBulkUploadSummary(summary.bulkUploadSummary);
      if (summary.lastImportBatch) setLastImportBatch(summary.lastImportBatch);
      if (summary.lastUploadSignature) {
        setLastUploadSignature(String(summary.lastUploadSignature));
      }
    }

    if (restored) {
      setRestoredDraftMessage("Restored unsaved draft");
    }

    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated) return;

    const draftPayload = {
      selectedPharmacyId,
      form: {
        drugCode,
        drug,
        brandName,
        genericName,
        barcode,
        qty,
        stockUnit,
        cost,
        salesPrice,
        expiry,
        batch,
        masterLookupStatus,
        masterLookupTone,
        editingId,
      },
    };

    writeStorageJson(INVENTORY_DRAFT_STORAGE_KEY, draftPayload);
  }, [
    draftHydrated,
    selectedPharmacyId,
    drugCode,
    drug,
    brandName,
    genericName,
    barcode,
    qty,
    stockUnit,
    cost,
    salesPrice,
    expiry,
    batch,
    masterLookupStatus,
    masterLookupTone,
    editingId,
  ]);

  useEffect(() => {
    if (!draftHydrated) return;

    if (importPreview) {
      writeStorageJson(INVENTORY_BULK_PREVIEW_STORAGE_KEY, importPreview);
      return;
    }
    clearStorageKey(INVENTORY_BULK_PREVIEW_STORAGE_KEY);
  }, [draftHydrated, importPreview]);

  useEffect(() => {
    if (!draftHydrated) return;

    writeStorageJson(INVENTORY_BULK_SUMMARY_STORAGE_KEY, {
      bulkUploadSummary,
      lastImportBatch,
      lastUploadSignature,
    });
  }, [bulkUploadSummary, draftHydrated, lastImportBatch, lastUploadSignature]);

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

  useEffect(() => {
    fetchPharmacies();
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster().then((rows) => {
      if (isMounted) {
        setAllDrugs(rows || []);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedPharmacyId) {
      fetchInventory(selectedPharmacyId);
    } else {
      setInventory([]);
      setLoading(false);
    }
  }, [selectedPharmacyId]);

  useEffect(() => {
    fetchRecentTransactions();
  }, [inventory]);

  async function fetchPharmacies() {
    setLoading(true);
    setError("");

    const { data, error } = await loadPharmaciesWithFallback();

    if (error) {
      console.error(error);
      setError("Live pharmacies unavailable. Demo pharmacies restored.");
    }

    const uniquePharmacies = buildUniquePharmacies(data || []);
    setPharmacies(uniquePharmacies);

    if (uniquePharmacies.length > 0) {
      const hasCurrentSelection = uniquePharmacies.some(
        (row) => String(row?.id) === String(selectedPharmacyId || "")
      );

      if (!hasCurrentSelection) {
        const persisted = readStorageJson(INVENTORY_DRAFT_STORAGE_KEY);
        const persistedPharmacyId = String(persisted?.selectedPharmacyId || "");
        const hasPersistedPharmacy = uniquePharmacies.some((row) => String(row?.id) === persistedPharmacyId);

        if (hasPersistedPharmacy) {
          setSelectedPharmacyId(persistedPharmacyId);
        } else {
          setSelectedPharmacyId(String(uniquePharmacies[0].id));
        }
      }
    } else {
      setLoading(false);
    }
  }

  async function fetchInventory(pharmacyId) {
    setLoading(true);
    setError("");

    if (!supabase) {
      setInventory([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("pharmacy_inventory")
      .select("*")
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setError("Failed to load inventory records.");
      setLoading(false);
      return;
    }

    setInventory((data || []).map(normalizeInventoryRow));
    setLoading(false);
  }

  async function fetchRecentTransactions() {
    if (!supabase) {
      setRecentTransactions([]);
      return;
    }

    const { data, error } = await supabase
      .from("stock_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Failed to load recent transactions:", error);
      setRecentTransactions([]);
      return;
    }

    setRecentTransactions(data || []);
  }

  const drugCodeMap = useMemo(() => buildDrugCodeMap(allDrugs), [allDrugs]);

  const clearSelectedDrug = () => {
    setSelectedDrugMaster(null);
    setDrug("");
    setBrandName("");
    setGenericName("");
    setBarcode("");
    setStockUnit("");
    setCost("");
    setSalesPrice("");
  };

  const focusQuantityField = () => {
    window.requestAnimationFrame(() => {
      quantityInputRef.current?.focus();
      quantityInputRef.current?.select?.();
    });
  };

  const focusDrugField = () => {
    window.requestAnimationFrame(() => {
      drugInputRef.current?.focus();
      drugInputRef.current?.select?.();
    });
  };

  const applyDrugSelection = (matchedDrug, lookupValue = "") => {
    if (!matchedDrug) {
      clearSelectedDrug();
      return;
    }

    const autofill = getMasterAutofill(matchedDrug, lookupValue);

    setSelectedDrugMaster(matchedDrug);
    setDrug(autofill.drug_name);
    setBrandName(autofill.brand_name);
    setGenericName(autofill.generic_name);
    setBarcode(autofill.barcode);
    setStockUnit(autofill.unit);
    setCost(autofill.unit_cost);
    setSalesPrice(autofill.sales_price);
    setMasterLookupStatus("Drug found in master database");
    setMasterLookupTone("success");
    focusQuantityField();
  };

  useEffect(() => {
    const code = String(drugCode || "").trim();

    if (!code) {
      clearSelectedDrug();
      setMasterLookupStatus("");
      setMasterLookupTone("neutral");
      return;
    }

    if (selectedDrugMaster && isQueryMatchedToDrug(code, selectedDrugMaster)) {
      return;
    }

    if (allDrugs.length === 0) {
      return;
    }

    const matchedDrug = findDrugByIdentifier(code, drugCodeMap, allDrugs);
    if (matchedDrug) {
      applyDrugSelection(matchedDrug, code);
      setShowDrugDropdown(false);
      return;
    }

    clearSelectedDrug();
    if (code.length >= 2) {
      setMasterLookupStatus("Select a drug from the search results");
      setMasterLookupTone("neutral");
    } else {
      setMasterLookupStatus("");
      setMasterLookupTone("neutral");
    }
  }, [allDrugs, drugCode, drugCodeMap, selectedDrugMaster]);

  const runInventoryMutation = async ({ editingRowId, payloadAttempts = [] }) => {
    if (!supabase) {
      return { error: new Error("Database is not configured.") };
    }

    const executeMutation = async (body, attemptName) => {
      try {
        if (editingRowId) {
          const result = await supabase.from("pharmacy_inventory").update(body).eq("id", editingRowId);
          if (result.error) {
            console.error("Inventory update attempt failed:", {
              attempt: attemptName,
              payload: body,
              error: result.error,
            });
          }
          return result;
        }

        const insertBody = {
          ...body,
        };

        const result = await supabase.from("pharmacy_inventory").insert([insertBody]);
        if (result.error) {
          console.error("Inventory insert attempt failed:", {
            attempt: attemptName,
            payload: insertBody,
            error: result.error,
          });
        }
        return result;
      } catch (mutationException) {
        console.error("Inventory mutation threw exception:", {
          attempt: attemptName,
          payload: body,
          error: mutationException,
        });
        return { error: mutationException };
      }
    };

    for (const attempt of payloadAttempts) {
      const mutation = await executeMutation(attempt.payload, attempt.name);
      if (!mutation.error) {
        return mutation;
      }

      const message = String(mutation.error.message || "").toLowerCase();
      const schemaMismatch =
        message.includes("column") ||
        message.includes("schema cache") ||
        message.includes("could not find");

      if (!schemaMismatch) {
        return mutation;
      }
    }

    return { error: new Error("Inventory save failed after all schema-safe attempts.") };
  };

  const parseUnitCost = (value) => parseSafePrice(value);

  const normalizeExpiryDate = (value) => {
    const text = String(value || "").trim();
    if (!text) return null;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  };

  const buildInventoryPayload = ({ pharmacyId, matchedDrug, quantity, expiryDate, batchNo, lookupValue = "" }) => {
    const autofill = getMasterAutofill(matchedDrug, lookupValue);
    const resolvedDrugName =
      autofill.drug_name || autofill.brand_name || autofill.generic_name || String(lookupValue || "").trim();
    const resolvedUnitCost = parseUnitCost(autofill.unit_cost);
    const resolvedSalesPrice = parseUnitCost(autofill.sales_price);
    const resolvedUnit = String(autofill.unit || "").trim();

    return {
      payload: {
        pharmacy_id: pharmacyId,
        drug_name: resolvedDrugName,
        // Keep barcode as a true barcode only; do not reuse drug_code as a global key.
        barcode: autofill.barcode || null,
        quantity,
        unit_cost: resolvedUnitCost,
        sales_price: resolvedSalesPrice,
        unit: resolvedUnit || null,
        expiry_date: expiryDate,
        batch_no: batchNo,
        brand_name: autofill.brand_name || null,
        generic_name: autofill.generic_name || null,
      },
      autofill,
      resolvedDrugName,
      resolvedUnitCost,
      resolvedSalesPrice,
      resolvedUnit,
    };
  };

  function resetForm(options = {}) {
    const { keepMessages = false, focusDrug = false, clearDraft = false } = options;

    setDrugCode("");
    clearSelectedDrug();
    setQty("");
    setExpiry("");
    setBatch("");
    setEditingId(null);
    setMasterLookupStatus("");
    setMasterLookupTone("neutral");
    setBulkUploadSummary(null);

    if (!keepMessages) {
      setError("");
      setSuccess("");
    }

    if (clearDraft) {
      clearInventoryDraftStorage();
    }

    if (focusDrug) {
      focusDrugField();
    }
  }


  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!selectedPharmacyId) {
      setError("Please select a pharmacy.");
      return;
    }

    const normalizedDrugCode = String(drugCode || "").trim();
    if (!normalizedDrugCode) {
      setError("Drug is required.");
      return;
    }

    const matchedDrug =
      selectedDrugMaster || findDrugByIdentifier(normalizedDrugCode, drugCodeMap, allDrugs);
    if (!matchedDrug) {
      setError("Please select a valid drug from the master list.");
      return;
    }

    if (!qty || Number(qty) <= 0) {
      setError("Please enter a valid quantity greater than 0.");
      return;
    }

    if (!expiry) {
      setError("Expiry date is required.");
      return;
    }

    if (!batch.trim()) {
      setError("Batch number is required.");
      return;
    }

    const quantityNumber = Number(qty) || 0;
    const normalizedExpiry = normalizeExpiryDate(expiry);

    if (!normalizedExpiry) {
      setError("Expiry date is invalid. Please provide a valid date.");
      return;
    }

    const {
      payload,
      autofill,
      resolvedDrugName,
      resolvedUnitCost,
      resolvedSalesPrice,
      resolvedUnit,
    } = buildInventoryPayload({
      pharmacyId: selectedPharmacyId,
      matchedDrug,
      quantity: quantityNumber,
      expiryDate: normalizedExpiry,
      batchNo: batch.trim() || null,
      lookupValue: normalizedDrugCode,
    });

    if (!resolvedDrugName || !String(resolvedDrugName).trim()) {
      setError("Drug name is required before saving.");
      return;
    }

    let mutation;

    try {
      mutation = await runInventoryMutation({
        editingRowId: editingId,
        payloadAttempts: [{ name: "minimal_autofill_payload", payload }],
      });
    } catch (submitErr) {
      console.error("Unexpected inventory save exception:", {
        error: submitErr,
        editingId,
        selectedPharmacyId,
        drugName: resolvedDrugName,
        quantity: quantityNumber,
      });
      setError("Unexpected error while saving inventory. Please try again.");
      return;
    }

    if (mutation.error) {
      const errorMessage = String(mutation.error.message || "");

      console.error("Inventory insert/update error details:", {
        error: mutation.error,
        code: mutation.error.code,
        details: mutation.error.details,
        hint: mutation.error.hint,
        editingId,
        selectedPharmacyId,
        quantity: quantityNumber,
        drugName: resolvedDrugName,
      });

      setError(errorMessage || "Unknown database error");
      return;
    }

    const selectedPharmacy =
      pharmacies.find((p) => String(p.id) === String(selectedPharmacyId)) || null;

    const pharmacyName = selectedPharmacy?.name || "Unknown Pharmacy";
    const actionVerb = editingId ? "Updated" : "Added";
    const movementType = editingId ? "UPDATE" : "ADD";
    const batchValue = batch.trim() || "-";
    const expiryValue = expiry || "-";
    const nowIso = new Date().toISOString();
    const referenceValue = `Inventory ${movementType} - ${resolvedDrugName}`;
    const costValue = calculateLineValue(quantityNumber, resolvedUnitCost);

    const txSummary =
      `${movementType} inventory transaction | ` +
      `Drug: ${resolvedDrugName} | ` +
      `Qty: ${quantityNumber} ${resolvedUnit || "units"} | ` +
      `Barcode: ${autofill.barcode || "-"} | ` +
      `Pharmacy: ${pharmacyName} | ` +
      `Batch: ${batchValue} | ` +
      `Expiry: ${expiryValue} | ` +
      `Cost price: ${formatCurrency(resolvedUnitCost)} | ` +
      `Sales price: ${formatCurrency(resolvedSalesPrice)} | ` +
      `Cost value: ${formatCurrency(costValue)}`;

    try {
      const { error: activityError } = await supabase.from("activity_log").insert([
        {
          action: actionVerb,
          module: "Inventory",
          description: txSummary,
          created_at: nowIso,
        },
      ]);

      if (activityError) {
        console.error("activity_log insert failed:", activityError);
      }
    } catch (activityInsertErr) {
      console.error("activity_log insert failed:", activityInsertErr);
    }

    try {
      const baseMovement = {
        drug_name: resolvedDrugName,
        barcode: autofill.barcode || null,
        quantity: quantityNumber,
        movement_type: movementType,
        notes: txSummary,
        from_pharmacy: movementType === "ADD" ? "External Source" : pharmacyName,
        to_pharmacy: pharmacyName,
        created_by: "falconmed.demo@preview",
        created_at: nowIso,
      };

      const fullMovement = {
        ...baseMovement,
        from_location: movementType === "ADD" ? "External Source" : pharmacyName,
        to_location: pharmacyName,
        reference: referenceValue,
        batch_no: batch.trim() || null,
      };

      let moveInsert = await supabase.from("stock_movements").insert([fullMovement]);

      if (moveInsert.error) {
        const msg = String(moveInsert.error.message || "").toLowerCase();
        const missingColumn = msg.includes("column") || msg.includes("schema cache");

        if (missingColumn) {
          const withReferenceNo = {
            ...baseMovement,
            from_location: movementType === "ADD" ? "External Source" : pharmacyName,
            to_location: pharmacyName,
            reference_no: referenceValue,
            batch_no: batch.trim() || null,
          };

          moveInsert = await supabase.from("stock_movements").insert([withReferenceNo]);

          if (moveInsert.error) {
            const fallbackMovement = {
              ...baseMovement,
              batch_no: batch.trim() || null,
            };

            moveInsert = await supabase.from("stock_movements").insert([fallbackMovement]);
          }
        }
      }

      if (moveInsert.error) {
        console.error("stock_movements insert failed:", moveInsert.error);
      }
    } catch (stockInsertErr) {
      console.error("stock_movements insert failed:", stockInsertErr);
    }

    resetForm({ keepMessages: true, focusDrug: true });
    setSuccess(
      editingId
        ? "Inventory record updated successfully."
        : "Inventory saved successfully."
    );
    clearInventoryDraftStorage();
    fetchInventory(selectedPharmacyId);
    emitInventoryUpdated(selectedPharmacyId);
  }

  function handleEdit(item) {
    const lookupValue = item.barcode || item.drug_code || item.drug_name || item.drug || "";
    const matchedDrug = findDrugByIdentifier(lookupValue, drugCodeMap, allDrugs);

    setEditingId(item.id);
    setDrugCode(String(lookupValue || ""));

    if (matchedDrug) {
      applyDrugSelection(matchedDrug, lookupValue);
    } else {
      clearSelectedDrug();
      setDrug(item.drug_name || item.drug || "");
      setBrandName(item.brand_name || "");
      setGenericName(item.generic_name || "");
      setBarcode(item.barcode || "");
      setStockUnit(item.stock_unit || item.unit || "");
      setCost(item.unit_cost ?? "");
      setSalesPrice(item.sales_price ?? item.price_to_public ?? "");
    }

    setQty(item.quantity ?? "");
    setExpiry(item.expiry_date || "");
    setBatch(item.batch_no || item.batch || "");
    setShowDrugDropdown(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    focusQuantityField();
  }

  async function handleDelete(id) {
    const confirmed = window.confirm("Are you sure you want to delete this record?");
    if (!confirmed) return;

    if (!supabase) {
      setError("Database is not configured.");
      return;
    }

    let item = null;

    try {
      const { data, error: fetchError } = await supabase
        .from("pharmacy_inventory")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError) {
        console.error("Failed to fetch inventory row before delete:", fetchError);
      } else {
        item = data;
      }
    } catch (err) {
      console.error("Failed to fetch inventory row before delete:", err);
    }

    const rowPharmacyId =
      item?.pharmacy_id != null
        ? String(item.pharmacy_id)
        : String(selectedPharmacyId || "");

    const selectedPharmacy =
      pharmacies.find((p) => String(p.id) === rowPharmacyId) || null;

    const pharmacyName = selectedPharmacy?.name || "Unknown Pharmacy";

    if (item) {
      const nowIso = new Date().toISOString();
      const itemDrugName = item.drug_name || item.drug || "Unknown";
      const itemBarcode = item.barcode || null;
      const itemQty = Number(item.quantity || 0);
      const itemBatch = item.batch_no || item.batch || null;

      try {
        const deleteMovement = {
          movement_type: "DELETE",
          drug_name: itemDrugName,
          barcode: itemBarcode,
          quantity: itemQty,
          notes: `DELETE inventory transaction | Drug: ${itemDrugName} | Qty: ${itemQty} | Pharmacy: ${pharmacyName}`,
          from_pharmacy: pharmacyName,
          to_pharmacy: "Removed",
          created_by: "falconmed.demo@preview",
          created_at: nowIso,
          batch_no: itemBatch,
        };

        let moveInsert = await supabase.from("stock_movements").insert([deleteMovement]);

        if (moveInsert.error) {
          const msg = String(moveInsert.error.message || "").toLowerCase();
          const missingColumn = msg.includes("column") || msg.includes("schema cache");

          if (missingColumn) {
            const deleteMovementExtended = {
              ...deleteMovement,
              from_location: pharmacyName,
              to_location: "Removed",
              reference_no: `Inventory DELETE - ${itemDrugName}`,
            };

            moveInsert = await supabase
              .from("stock_movements")
              .insert([deleteMovementExtended]);

            if (moveInsert.error) {
              console.error("stock_movements delete log insert failed:", moveInsert.error);
            }
          } else {
            console.error("stock_movements delete log insert failed:", moveInsert.error);
          }
        }
      } catch (err) {
        console.error("stock_movements delete log insert failed:", err);
      }

      try {
        const { error: activityError } = await supabase.from("activity_log").insert([
          {
            action: "Deleted",
            module: "Inventory",
            description: `Deleted inventory item: ${itemDrugName} | Qty: ${itemQty} | Pharmacy: ${pharmacyName}`,
            created_at: nowIso,
          },
        ]);

        if (activityError) {
          console.error("activity_log delete insert failed:", activityError);
        }
      } catch (err) {
        console.error("activity_log delete insert failed:", err);
      }
    }

    const { error } = await supabase
      .from("pharmacy_inventory")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      setError("Failed to delete record.");
      return;
    }

    setSuccess("Record deleted successfully.");
    fetchInventory(selectedPharmacyId);
    emitInventoryUpdated(selectedPharmacyId);
  }

  const totalItems = useMemo(() => {
    return inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [inventory]);

  const totalValue = useMemo(() => {
    return inventory.reduce((sum, item) => sum + resolveCostValue(item), 0);
  }, [inventory]);

  const totalSalesValue = useMemo(() => {
    return inventory.reduce((sum, item) => sum + resolveSalesValue(item), 0);
  }, [inventory]);

  const potentialMargin = useMemo(() => {
    return roundMoney(inventory.reduce((sum, item) => sum + resolveMarginValue(item), 0));
  }, [inventory]);

  const filteredDrugs = useMemo(
    () => searchDrugMaster(allDrugs, drugCode, 20),
    [allDrugs, drugCode]
  );

  const animTotalItems = useAnimatedCounter(totalItems);
  const animTotalValue = useAnimatedCounter(totalValue);
  const animTotalSalesValue = useAnimatedCounter(totalSalesValue);
  const animPotentialMargin = useAnimatedCounter(potentialMargin);
  const animRecords = useAnimatedCounter(inventory.length);

  const inventoryInsight = useMemo(() => {
    if (loading || inventory.length === 0) return null;

    const lowStockRows = inventory.filter(
      (item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 10
    );
    if (lowStockRows.length === 0) return null;

    const topLow = [...lowStockRows].sort(
      (a, b) => Number(a.quantity || 0) - Number(b.quantity || 0)
    )[0];

    return {
      icon: "▾",
      tone: "warning",
      title: "Smart Insight: Low Stock Warning",
      message: `${lowStockRows.length} SKU${lowStockRows.length === 1 ? "" : "s"} are at or below 10 units. Lowest stock: ${topLow?.drug_name || "Unknown"} (${Number(
        topLow?.quantity || 0
      )} units).`,
    };
  }, [inventory, loading]);

  const inventoryIntelligence = useMemo(() => {
    if (loading || inventory.length === 0) {
      return {
        lowStockCount: 0,
        nearExpiryCount: 0,
        valueAtRisk: 0,
        highestRiskItem: null,
      };
    }

    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 180);

    const lowStockItems = inventory.filter(
      (item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= 10
    );

    const nearExpiryItems = inventory.filter((item) => {
      if (!item.expiry_date) return false;
      try {
        const expiryDate = new Date(item.expiry_date);
        return expiryDate <= futureDate && expiryDate >= today;
      } catch {
        return false;
      }
    });

    const valueAtRisk = nearExpiryItems.reduce(
      (sum, item) => sum + resolveCostValue(item),
      0
    );

    let highestRiskItem = null;
    if (nearExpiryItems.length > 0) {
      let maxRiskValue = 0;
      nearExpiryItems.forEach((item) => {
        const riskValue = resolveCostValue(item);
        if (riskValue > maxRiskValue) {
          maxRiskValue = riskValue;
          highestRiskItem = {
            drugName: item.drug_name || "Unknown",
            riskValue: riskValue,
            expiryDate: item.expiry_date,
          };
        }
      });
    }

    return {
      lowStockCount: lowStockItems.length,
      nearExpiryCount: nearExpiryItems.length,
      valueAtRisk,
      highestRiskItem,
    };
  }, [inventory, loading]);

  const expiryRiskItems = useMemo(() => {
    if (loading || inventory.length === 0) return [];

    const today = new Date();
    const riskLevelOrder = { Critical: 0, "High Risk": 1, "Medium Risk": 2 };

    const results = [];
    inventory.forEach((item) => {
      if (!item.expiry_date) return;
      let expiryDate;
      try {
        expiryDate = new Date(item.expiry_date);
        if (isNaN(expiryDate.getTime())) return;
      } catch {
        return;
      }
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      let riskLevel = null;
      if (daysUntilExpiry <= 30) riskLevel = "Critical";
      else if (daysUntilExpiry <= 90) riskLevel = "High Risk";
      else if (daysUntilExpiry <= 180) riskLevel = "Medium Risk";
      if (!riskLevel) return;
      results.push({
        ...item,
        daysUntilExpiry,
        riskLevel,
        riskValue: calculateLineValue(item.quantity, item.unit_cost),
      });
    });

    results.sort((a, b) => {
      const levelDiff = riskLevelOrder[a.riskLevel] - riskLevelOrder[b.riskLevel];
      if (levelDiff !== 0) return levelDiff;
      return b.riskValue - a.riskValue;
    });

    return results;
  }, [inventory, loading]);

  const inventoryHealthScore = useMemo(() => {
    if (loading || inventory.length === 0) {
      return { score: 100, status: "Excellent", lowStockCount: 0, nearExpiryCount: 0, criticalExpiryCount: 0, valueAtRisk: 0 };
    }

    const today = new Date();
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in180 = new Date(); in180.setDate(in180.getDate() + 180);

    let lowStockCount = 0;
    let nearExpiryCount = 0;
    let criticalExpiryCount = 0;
    let valueAtRisk = 0;

    inventory.forEach((item) => {
      const qty = Number(item.quantity || 0);
      if (qty > 0 && qty <= 10) lowStockCount += 1;
      if (item.expiry_date) {
        try {
          const expDate = new Date(item.expiry_date);
          if (!isNaN(expDate.getTime())) {
            if (expDate >= today && expDate <= in30) {
              criticalExpiryCount += 1;
              valueAtRisk += resolveCostValue(item);
            } else if (expDate > in30 && expDate <= in180) {
              nearExpiryCount += 1;
              valueAtRisk += resolveCostValue(item);
            }
          }
        } catch {
          // skip invalid dates
        }
      }
    });

    let score = 100;
    score -= lowStockCount * 2;
    score -= nearExpiryCount * 3;
    score -= criticalExpiryCount * 5;
    if (valueAtRisk >= 20000) score -= 15;
    else if (valueAtRisk >= 5000) score -= 10;
    else if (valueAtRisk > 0) score -= 5;
    score = Math.max(0, Math.min(100, score));

    let status = "Critical";
    if (score >= 90) status = "Excellent";
    else if (score >= 75) status = "Good";
    else if (score >= 50) status = "Needs Attention";

    return { score, status, lowStockCount, nearExpiryCount, criticalExpiryCount, valueAtRisk };
  }, [inventory, loading]);

  const handleDrugSelect = (selectedDrug) => {
    setDrugCode(getDrugLookupLabel(selectedDrug));
    applyDrugSelection(selectedDrug, getDrugLookupLabel(selectedDrug));
    setShowDrugDropdown(false);
  };

  const pageStyle = {
    padding: "36px",
    background: "radial-gradient(circle at 0% 0%, #f8fbff 0%, #eef3f9 45%, #e8eef6 100%)",
    minHeight: "100vh",
    fontFamily: "'Segoe UI', 'Inter', Arial, sans-serif",
  };

  const headerCard = {
    background: "linear-gradient(135deg, #ffffff 0%, #f7fbff 100%)",
    borderRadius: "24px",
    padding: "30px 36px",
    boxShadow: "0 18px 45px rgba(15,23,42,0.10)",
    marginBottom: "26px",
    border: "1px solid #dbe7f5",
    borderLeft: "6px solid #1d4ed8",
  };

  const headerTitle = {
    margin: 0,
    fontSize: "34px",
    fontWeight: 800,
    color: "#0b1530",
    letterSpacing: "-0.03em",
    lineHeight: 1.2,
  };

  const headerSub = {
    marginTop: "8px",
    marginBottom: 0,
    fontSize: "14px",
    color: "#5a6a86",
    lineHeight: 1.7,
  };

  const cardStyle = {
    background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
    borderRadius: "20px",
    padding: "26px 30px",
    boxShadow: "0 14px 32px rgba(15,23,42,0.08)",
    marginBottom: "24px",
    border: "1px solid #dfe8f3",
  };

  const sectionTitle = {
    fontSize: "16px",
    fontWeight: 800,
    marginBottom: "20px",
    marginTop: 0,
    color: "#0b1530",
    letterSpacing: "-0.015em",
    paddingBottom: "13px",
    borderBottom: "1px solid #e7eef7",
  };

  const labelStyle = {
    display: "block",
    fontWeight: 700,
    marginBottom: "7px",
    color: "#334155",
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1.5px solid #d6e1ee",
    outline: "none",
    fontSize: "14px",
    boxSizing: "border-box",
    background: "#ffffff",
    color: "#0b1530",
    fontFamily: "'Segoe UI', 'Inter', Arial, sans-serif",
    boxShadow: "inset 0 1px 2px rgba(15,23,42,0.04)",
  };

  const readonlyInputStyle = {
    background: "#f8fafc",
    color: "#334155",
    cursor: "not-allowed",
  };

  const fieldHint = {
    marginTop: "6px",
    fontSize: "11px",
    color: "#64748b",
  };

  const lookupStatus = {
    marginTop: "8px",
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
    padding: "3px 8px",
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#334155",
  };

  const lookupSuccess = {
    background: "#ecfdf3",
    color: "#166534",
    border: "1px solid #bbf7d0",
  };

  const lookupError = {
    background: "#fff1f2",
    color: "#991b1b",
    border: "1px solid #fecdd3",
  };

  const importSummaryCard = {
    marginTop: "12px",
    border: "1px solid #dbe7f5",
    borderRadius: "12px",
    padding: "12px",
    background: "#f8fbff",
  };

  const importSummaryRow = {
    fontSize: "13px",
    color: "#334155",
    lineHeight: 1.6,
  };

  const selectedDrugCard = {
    marginTop: "16px",
    border: "1px solid #dbe7f5",
    borderRadius: "16px",
    padding: "16px",
    background: "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)",
  };

  const selectedDrugGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    marginTop: "14px",
  };

  const selectedDrugLabel = {
    fontSize: "10px",
    fontWeight: 700,
    color: "#64748b",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "6px",
  };

  const selectedDrugValue = {
    fontSize: "14px",
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.4,
  };

  const buttonStyle = {
    padding: "11px 24px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%)",
    color: "#fff",
    fontWeight: 700,
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(29,78,216,0.28)",
    letterSpacing: "0.015em",
  };

  const secondaryButtonStyle = {
    padding: "11px 24px",
    borderRadius: "12px",
    border: "1.5px solid #d6e1ee",
    background: "#f8fbff",
    color: "#334155",
    fontWeight: 600,
    fontSize: "14px",
    cursor: "pointer",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "12px",
  };

  const kpiGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "16px",
  };

  const kpiCard = {
    background: "linear-gradient(180deg, #ffffff 0%, #f9fcff 100%)",
    borderRadius: "16px",
    padding: "18px 20px",
    boxShadow: "0 8px 18px rgba(15,23,42,0.07)",
    border: "1px solid #e0e8f4",
    textAlign: "center",
  };

  const kpiLabel = {
    fontSize: "10px",
    fontWeight: 700,
    color: "#7c8ba1",
    letterSpacing: "0.09em",
    textTransform: "uppercase",
    marginBottom: "10px",
  };

  const kpiValue = {
    fontSize: "28px",
    fontWeight: 800,
    color: "#0b1530",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
  };

  const kpiHint = {
    fontSize: "11px",
    color: "#8796ad",
    marginTop: "7px",
    lineHeight: 1.4,
  };

  const dropdownStyle = {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1.5px solid #dce7f4",
    borderRadius: "12px",
    boxShadow: "0 14px 34px rgba(15,23,42,0.12)",
    zIndex: 30,
    maxHeight: "240px",
    overflowY: "auto",
  };

  const dropdownItemStyle = {
    padding: "11px 14px",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
  };

  const thStyle = {
    padding: "12px 14px",
    fontWeight: 700,
    fontSize: "11px",
    color: "#5a6a86",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: "#f4f8fd",
    textAlign: "left",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    borderBottom: "1px solid #dfe8f3",
  };

  const tdStyle = {
    padding: "13px 14px",
    fontSize: "14px",
    color: "#0b1530",
    verticalAlign: "middle",
    borderBottom: "1px solid #edf2f8",
  };

  const editBtnStyle = {
    padding: "7px 14px",
    borderRadius: "10px",
    border: "none",
    background: "#e0ebff",
    color: "#1d4ed8",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    letterSpacing: "0.03em",
  };

  const deleteBtnStyle = {
    padding: "7px 14px",
    borderRadius: "10px",
    border: "none",
    background: "#ffe5e5",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    letterSpacing: "0.03em",
  };

  const guideText = {
    fontSize: "13px",
    color: "#5a6a86",
    lineHeight: 1.6,
    marginBottom: "10px",
  };

  const smallNote = {
    marginTop: "8px",
    fontSize: "12px",
    color: "#64748b",
  };

  const templateSample = [
    "drug_code,quantity,batch_no,expiry_date",
    "H03-4489-00178-02,25,BATCH001,2027-12-31",
    "N05-5258-05575-01,337,BATCH002,2027-12-31",
  ].join("\n");

  const handleDownloadCsvTemplate = () => {
    const blob = new Blob([templateSample], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "falconmed_inventory_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleBulkUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const targetPharmacyId = String(selectedPharmacyId || "").trim();

    setError("");
    setSuccess("");
    setBulkUploadSummary(null);
    setImportPreview(null);

    if (!targetPharmacyId) {
      setError("Please select a pharmacy before uploading CSV.");
      event.target.value = "";
      return;
    }

    // Duplicate-upload guard: same pharmacy + same filename + same size in same session
    const uploadSignature = `${targetPharmacyId}::${file.name}::${file.size}`;
    if (lastUploadSignature === uploadSignature) {
      const proceed = window.confirm(
        "This file was already uploaded for this pharmacy in the current session.\nAre you sure you want to upload it again?"
      );
      if (!proceed) {
        event.target.value = "";
        return;
      }
    }

    if (!supabase) {
      setError("Database is not configured.");
      event.target.value = "";
      return;
    }

    setBulkUploadProcessing(true);

    try {
      const text = await file.text();
      const { rows, headers } = parseCsvText(text);
      const requiredHeaders = ["drug_code", "quantity", "batch_no", "expiry_date"];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

      if (missingHeaders.length > 0) {
        setError(`CSV is missing required columns: ${missingHeaders.join(", ")}`);
        return;
      }

      if (rows.length === 0) {
        setError("CSV file does not contain any data rows.");
        return;
      }

      const validPayloads = [];
      const skippedRows = [];

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const drugCodeValue = String(row.drug_code || "").trim();
        const quantityNumber = Number(row.quantity || 0);
        const batchValue = String(row.batch_no || "").trim();
        const normalizedExpiry = normalizeExpiryDate(row.expiry_date);

        if (!drugCodeValue) {
          skippedRows.push(`Row ${rowNumber}: drug_code is required.`);
          return;
        }

        if (!Number.isFinite(quantityNumber) || quantityNumber <= 0) {
          skippedRows.push(`Row ${rowNumber}: quantity must be greater than 0.`);
          return;
        }

        if (!batchValue) {
          skippedRows.push(`Row ${rowNumber}: batch_no is required.`);
          return;
        }

        if (!normalizedExpiry) {
          skippedRows.push(`Row ${rowNumber}: expiry_date is invalid.`);
          return;
        }

        const matchedDrug = findDrugByDrugCode(drugCodeValue, allDrugs);
        if (!matchedDrug) {
          skippedRows.push(`Row ${rowNumber}: drug_code "${drugCodeValue}" not found in drug master.`);
          return;
        }

        validPayloads.push(
          buildInventoryPayload({
            pharmacyId: targetPharmacyId,
            matchedDrug,
            quantity: quantityNumber,
            expiryDate: normalizedExpiry,
            batchNo: batchValue,
            lookupValue: drugCodeValue,
          }).payload
        );
      });

      if (validPayloads.length === 0) {
        setError(skippedRows[0] || "No valid rows found in CSV upload.");
        setBulkUploadSummary({
          inserted: 0,
          skipped: skippedRows.length,
          issues: skippedRows,
        });
        return;
      }

      const selectedPharmacy = pharmacies.find((p) => String(p.id) === targetPharmacyId);
      const pharmacyName = selectedPharmacy?.name || "Unknown Pharmacy";
      const totalQty = validPayloads.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
      const estimatedValue = validPayloads.reduce(
        (sum, p) => sum + Number(p.quantity || 0) * Number(p.unit_cost || 0),
        0
      );

      console.info("[Bulk Import Preview] Target pharmacy selected", {
        selectedPharmacyId: targetPharmacyId,
        pharmacyName,
        validRows: validPayloads.length,
      });

      setImportPreview({
        pharmacyId: targetPharmacyId,
        pharmacyName,
        validPayloads,
        skippedRows,
        totalQty,
        estimatedValue,
        previewRows: validPayloads.slice(0, 10),
        fileName: file.name,
        uploadSignature,
      });
    } catch (uploadException) {
      console.error("Bulk upload processing failed:", uploadException);
      setError("Failed to process CSV file.");
    } finally {
      setBulkUploadProcessing(false);
      event.target.value = "";
    }
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importPreview.validPayloads.length === 0) return;

    setBulkUploadProcessing(true);
    setError("");
    setSuccess("");

    try {
      const previewPharmacyId = String(importPreview.pharmacyId || "").trim();
      if (!previewPharmacyId) {
        setError("Import preview is missing pharmacy ID. Please upload the CSV again.");
        return;
      }

      const batchId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `import-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const payloadsWithBatch = importPreview.validPayloads.map((p) => ({
        ...p,
        pharmacy_id: previewPharmacyId,
        import_batch_id: batchId,
      }));

      const distinctPayloadPharmacyIds = Array.from(
        new Set(payloadsWithBatch.map((row) => String(row?.pharmacy_id || "").trim()).filter(Boolean))
      );

      if (
        distinctPayloadPharmacyIds.length !== 1 ||
        distinctPayloadPharmacyIds[0] !== previewPharmacyId
      ) {
        setError("Import validation failed: inconsistent pharmacy_id in payload.");
        console.error("Bulk import payload pharmacy mismatch", {
          expectedPharmacyId: previewPharmacyId,
          distinctPayloadPharmacyIds,
          selectedPharmacyId,
          batchId,
        });
        return;
      }

      console.info("[Bulk Import Confirm] Writing pharmacy_inventory rows", {
        expectedPharmacyId: previewPharmacyId,
        selectedPharmacyId,
        payloadSize: payloadsWithBatch.length,
        distinctPayloadPharmacyIds,
      });

      const { error: uploadError } = await supabase
        .from("pharmacy_inventory")
        .insert(payloadsWithBatch);

      if (uploadError) {
        console.error("Bulk inventory insert failed:", {
          error: uploadError,
          batchId,
          payloadSize: payloadsWithBatch.length,
          samplePayload: payloadsWithBatch[0],
        });
        setError(String(uploadError.message || "Import failed."));
        return;
      }

      const { skippedRows, validPayloads, pharmacyName, pharmacyId } = importPreview;

      setLastImportBatch({
        batchId,
        pharmacyId,
        pharmacyName,
        rowCount: validPayloads.length,
      });
      setLastUploadSignature(importPreview.uploadSignature);
      setBulkUploadSummary({
        inserted: validPayloads.length,
        skipped: skippedRows.length,
        issues: skippedRows,
      });
      setSuccess(
        skippedRows.length > 0
          ? `Import complete: ${validPayloads.length} rows inserted, ${skippedRows.length} skipped.`
          : `Import complete: ${validPayloads.length} rows inserted successfully.`
      );
      setImportPreview(null);
      clearInventoryBulkPreviewStorage();
      clearInventoryDraftStorage();

      try {
        const nowIso = new Date().toISOString();
        const totalImportedQty = validPayloads.reduce(
          (sum, row) => sum + Number(row.quantity || 0),
          0
        );
        const totalImportedValue = validPayloads.reduce(
          (sum, row) => sum + Number(row.quantity || 0) * Number(row.unit_cost || 0),
          0
        );

        await supabase.from("activity_log").insert([
          {
            action: "Imported",
            module: "Inventory",
            description:
              `Bulk inventory import | Pharmacy: ${pharmacyName} | ` +
              `Rows: ${validPayloads.length} | Qty: ${totalImportedQty} | ` +
              `Value: ${formatCurrency(totalImportedValue)} | Batch: ${batchId}`,
            created_at: nowIso,
          },
        ]);

        await supabase.from("stock_movements").insert([
          {
            movement_type: "IMPORT",
            drug_name: "Bulk Inventory Import",
            quantity: totalImportedQty,
            notes: `Imported ${validPayloads.length} inventory row(s) via CSV preview flow`,
            from_pharmacy: "CSV Upload",
            to_pharmacy: pharmacyName,
            reference_no: `Inventory IMPORT - ${batchId}`,
            created_by: "falconmed.demo@preview",
            created_at: nowIso,
          },
        ]);
      } catch (logErr) {
        console.error("Bulk import log insert failed:", logErr);
      }

      if (bulkFileInputRef.current) bulkFileInputRef.current.value = "";
      fetchInventory(previewPharmacyId);
      focusDrugField();
      emitInventoryUpdated(previewPharmacyId);
    } catch (ex) {
      console.error("Import confirm exception:", ex);
      setError("Unexpected error during import. No rows were inserted.");
    } finally {
      setBulkUploadProcessing(false);
    }
  };

  const handleCancelImport = () => {
    setImportPreview(null);
    clearInventoryBulkPreviewStorage();
    if (bulkFileInputRef.current) bulkFileInputRef.current.value = "";
  };

  const handleUndoLastImport = async () => {
    if (!lastImportBatch) return;

    const selectedId = String(selectedPharmacyId || "").trim();
    const batchPharmacyId = String(lastImportBatch.pharmacyId || "").trim();

    if (!selectedId || selectedId !== batchPharmacyId) {
      setError("Undo is only allowed for the selected pharmacy's last import batch.");
      return;
    }

    const { batchId, pharmacyName, rowCount } = lastImportBatch;
    const confirmed = window.confirm(
      `Undo last import?\nThis will permanently remove ${rowCount} row(s) imported for ${pharmacyName}.\n\nBatch ID: ${batchId}`
    );
    if (!confirmed) return;

    setUndoProcessing(true);
    setError("");
    setSuccess("");

    try {
      const { error: deleteError } = await supabase
        .from("pharmacy_inventory")
        .delete()
        .eq("import_batch_id", batchId)
        .eq("pharmacy_id", batchPharmacyId);

      if (deleteError) {
        console.error("Undo import delete failed:", deleteError);
        setError(String(deleteError.message || "Undo failed."));
        return;
      }

      setSuccess(`Undo complete: ${rowCount} row(s) removed from ${pharmacyName}.`);
      setLastImportBatch(null);
      setBulkUploadSummary(null);

      try {
        const nowIso = new Date().toISOString();
        await supabase.from("activity_log").insert([
          {
            action: "Undo Import",
            module: "Inventory",
            description: `Undo bulk inventory import | Pharmacy: ${pharmacyName} | Rows: ${rowCount} | Batch: ${batchId}`,
            created_at: nowIso,
          },
        ]);

        await supabase.from("stock_movements").insert([
          {
            movement_type: "UNDO_IMPORT",
            drug_name: "Bulk Import Rollback",
            quantity: rowCount,
            notes: `Rolled back batch ${batchId}`,
            from_pharmacy: pharmacyName,
            to_pharmacy: "Rollback",
            reference_no: `Inventory UNDO - ${batchId}`,
            created_by: "falconmed.demo@preview",
            created_at: nowIso,
          },
        ]);
      } catch (undoLogErr) {
        console.error("Undo import log insert failed:", undoLogErr);
      }

      fetchInventory(batchPharmacyId);
      emitInventoryUpdated(batchPharmacyId);
    } catch (ex) {
      console.error("Undo import exception:", ex);
      setError("Unexpected error during undo.");
    } finally {
      setUndoProcessing(false);
    }
  };

  const bannerError = {
    background: "#fff1f2",
    color: "#991b1b",
    padding: "13px 16px",
    borderRadius: "14px",
    marginBottom: "16px",
    fontWeight: 600,
    fontSize: "14px",
    borderLeft: "4px solid #ef4444",
    border: "1px solid #fecdd3",
  };

  const bannerSuccess = {
    background: "#ecfdf3",
    color: "#166534",
    padding: "13px 16px",
    borderRadius: "14px",
    marginBottom: "16px",
    fontWeight: 600,
    fontSize: "14px",
    borderLeft: "4px solid #22c55e",
    border: "1px solid #bbf7d0",
  };

  return (
    <div style={pageStyle}>
      <div style={headerCard}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "5px 12px",
            borderRadius: "999px",
            background: "#e8f1ff",
            border: "1px solid #cddfff",
            color: "#1e3a8a",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            marginBottom: "10px",
          }}
        >
          Executive Inventory Console
        </div>
        <h1 style={headerTitle}>Inventory Management</h1>
        <p style={headerSub}>
          Track, add, and manage drug stock levels across all pharmacy sites.
        </p>
      </div>

      {error && <div style={bannerError}>{error}</div>}
      {restoredDraftMessage && <div style={bannerSuccess}>{restoredDraftMessage}</div>}
      {success && <div style={bannerSuccess}>{success}</div>}

      <div style={cardStyle}>
        <div style={sectionTitle}>Pharmacy &amp; Summary</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(230px, 1fr) minmax(460px, 2fr)",
            gap: "28px",
            alignItems: "start",
          }}
        >
          <div>
            <label style={labelStyle}>Select Pharmacy</label>
            {loading && pharmacies.length === 0 ? (
              <SkeletonCard
                style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
                blocks={[{ width: "100%", height: 42, gap: 0, radius: 10 }]}
              />
            ) : (
              <select
                value={selectedPharmacyId}
                onChange={(e) => setSelectedPharmacyId(e.target.value)}
                style={inputStyle}
              >
                <option value="">Choose pharmacy</option>
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div style={kpiGrid}>
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <SkeletonCard
                  key={`inventory-kpi-skeleton-${index}`}
                  style={{ ...kpiCard, borderTop: "4px solid #e2e8f0", minHeight: 112 }}
                  blocks={[
                    { width: "46%", height: 10, gap: 12 },
                    { width: index === 1 ? "70%" : "52%", height: 28, gap: 12 },
                    { width: "76%", height: 10, gap: 0 },
                  ]}
                />
              ))
            ) : (
              <>
                <StatCard
                  className="ui-hover-lift"
                  style={kpiCard}
                  accentColor="#3b82f6"
                  accentBorderWidth={4}
                  label="Total Quantity"
                  value={animTotalItems.toLocaleString()}
                  hint="Units across all SKUs"
                  labelStyle={kpiLabel}
                  valueStyle={kpiValue}
                  hintStyle={kpiHint}
                />
                <StatCard
                  className="ui-hover-lift"
                  style={kpiCard}
                  accentColor="#10b981"
                  accentBorderWidth={4}
                  label="Total Cost Value"
                  value={formatCurrency(animTotalValue)}
                  hint="Stock valuation at cost"
                  labelStyle={kpiLabel}
                  valueStyle={{ ...kpiValue, fontSize: "20px" }}
                  hintStyle={kpiHint}
                />
                <StatCard
                  className="ui-hover-lift"
                  style={kpiCard}
                  accentColor="#0ea5e9"
                  accentBorderWidth={4}
                  label="Total Sales Value"
                  value={formatCurrency(animTotalSalesValue)}
                  hint="Projected retail valuation"
                  labelStyle={kpiLabel}
                  valueStyle={{ ...kpiValue, fontSize: "20px" }}
                  hintStyle={kpiHint}
                />
                <StatCard
                  className="ui-hover-lift"
                  style={kpiCard}
                  accentColor="#8b5cf6"
                  accentBorderWidth={4}
                  label="Potential Margin"
                  value={formatCurrency(animPotentialMargin)}
                  hint={`Records: ${animRecords}`}
                  labelStyle={kpiLabel}
                  valueStyle={kpiValue}
                  hintStyle={kpiHint}
                />
              </>
            )}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>
          {editingId ? "Edit Inventory Record" : "Add Inventory Entry"}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Drug</label>
              <div style={{ position: "relative" }}>
                <input
                  ref={drugInputRef}
                  value={drugCode}
                  onChange={(e) => {
                    setDrugCode(e.target.value);
                    setShowDrugDropdown(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && selectedDrugMaster) {
                      event.preventDefault();
                      focusQuantityField();
                    }
                  }}
                  onFocus={() => setShowDrugDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDrugDropdown(false), 160)}
                  placeholder="Scan barcode or type code / drug name"
                  style={inputStyle}
                />
                <div style={fieldHint}>Barcode scans auto-select the drug and move focus to quantity.</div>
                {masterLookupStatus ? (
                  <div
                    style={{
                      ...lookupStatus,
                      ...(masterLookupTone === "success" ? lookupSuccess : masterLookupTone === "error" ? lookupError : null),
                    }}
                  >
                    {masterLookupStatus}
                  </div>
                ) : null}

                {showDrugDropdown && filteredDrugs.length > 0 ? (
                  <div style={dropdownStyle}>
                    {filteredDrugs.map((result) => (
                      <div
                        key={result.drug_code || result.display_name}
                        style={dropdownItemStyle}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleDrugSelect(result);
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: "14px" }}>
                          {getDrugDisplayName(result)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                          {[result.barcode, result.drug_code, result.generic_name]
                            .filter(Boolean)
                            .join(" • ") || "Generic name unavailable"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <label style={labelStyle}>Drug Name</label>
              <input
                value={drug}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Drug Code</label>
              <input
                value={selectedDrugMaster?.drug_code || ""}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Brand Name</label>
              <input
                value={brandName}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Generic Name</label>
              <input
                value={genericName}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Barcode</label>
              <input
                value={barcode}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Unit</label>
              <input
                value={stockUnit}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Unit Cost (AED)</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Sales Price (AED)</label>
              <input
                type="number"
                step="0.01"
                value={salesPrice}
                readOnly
                placeholder="Auto-filled from drug master"
                style={{ ...inputStyle, ...readonlyInputStyle }}
              />
            </div>

            <div>
              <label style={labelStyle}>Quantity</label>
              <input
                ref={quantityInputRef}
                type="number"
                step="0.01"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 100"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Expiry Date</label>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Batch No.</label>
              <input
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                placeholder="e.g. BT-2026-01"
                style={inputStyle}
              />
            </div>
          </div>

          {selectedDrugMaster ? (
            <div style={selectedDrugCard}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Auto-filled from drug master
              </div>
              <div style={{ marginTop: "8px", fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                {drug || getDrugDisplayName(selectedDrugMaster)}
              </div>
              <div style={selectedDrugGrid}>
                <div>
                  <div style={selectedDrugLabel}>Barcode</div>
                  <div style={selectedDrugValue}>{barcode || selectedDrugMaster?.drug_code || "-"}</div>
                </div>
                <div>
                  <div style={selectedDrugLabel}>Brand</div>
                  <div style={selectedDrugValue}>{brandName || "-"}</div>
                </div>
                <div>
                  <div style={selectedDrugLabel}>Generic</div>
                  <div style={selectedDrugValue}>{genericName || "-"}</div>
                </div>
                <div>
                  <div style={selectedDrugLabel}>Unit</div>
                  <div style={selectedDrugValue}>{stockUnit || "-"}</div>
                </div>
                <div>
                  <div style={selectedDrugLabel}>Unit Cost</div>
                  <div style={selectedDrugValue}>{cost ? formatCurrency(cost) : "AED 0.00"}</div>
                </div>
                <div>
                  <div style={selectedDrugLabel}>Sales Price</div>
                  <div style={selectedDrugValue}>{salesPrice ? formatCurrency(salesPrice) : "AED 0.00"}</div>
                </div>
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle}>
              {editingId ? "Update Record" : "Save Entry"}
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => resetForm({ focusDrug: true, clearDraft: true })}
            >
              Clear
            </button>
          </div>
        </form>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Bulk Upload</div>

        {/* ── Step 1: upload controls (hidden while preview is showing) ── */}
        {!importPreview && (
          <>
            <div style={guideText}>
              Upload a CSV with only drug code, quantity, batch number, and expiry date.
              FalconMed validates every row against drug master and shows a preview before
              inserting anything.
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={handleDownloadCsvTemplate}>
                Download CSV Template
              </button>
              <label
                style={{
                  ...secondaryButtonStyle,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: bulkUploadProcessing ? 0.6 : 1,
                  cursor: bulkUploadProcessing ? "not-allowed" : "pointer",
                }}
              >
                {bulkUploadProcessing ? "Reading file…" : "Upload Inventory CSV"}
                <input
                  ref={bulkFileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleBulkUpload}
                  style={{ display: "none" }}
                  disabled={bulkUploadProcessing}
                />
              </label>
              {lastImportBatch && (
                <button
                  type="button"
                  disabled={undoProcessing}
                  onClick={handleUndoLastImport}
                  style={{
                    ...secondaryButtonStyle,
                    borderColor: "#fca5a5",
                    color: "#b91c1c",
                    background: "#fff5f5",
                    opacity: undoProcessing ? 0.6 : 1,
                    cursor: undoProcessing ? "not-allowed" : "pointer",
                  }}
                >
                  {undoProcessing ? "Undoing…" : `Undo Last Import (${lastImportBatch.rowCount} rows)`}
                </button>
              )}
            </div>
            <div style={smallNote}>
              Required columns: drug_code, quantity, batch_no, expiry_date.
            </div>

            {/* Post-import summary (shown after confirm or undo) */}
            {bulkUploadSummary && !importPreview && (
              <div style={{ ...importSummaryCard, marginTop: "16px" }}>
                <div style={{ ...importSummaryRow, fontWeight: 700 }}>
                  ✓ Import complete
                </div>
                <div style={importSummaryRow}>Inserted: {bulkUploadSummary.inserted} rows</div>
                {bulkUploadSummary.skipped > 0 && (
                  <div style={{ ...importSummaryRow, color: "#92400e" }}>
                    Skipped: {bulkUploadSummary.skipped} rows
                  </div>
                )}
                {bulkUploadSummary.issues?.slice(0, 5).map((issue) => (
                  <div key={issue} style={{ ...importSummaryRow, color: "#b91c1c", fontSize: "12px" }}>
                    {issue}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Step 2: preview card (shown after parsing, before confirming) ── */}
        {importPreview && (
          <div>
            {/* Summary bar */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "12px",
                marginBottom: "18px",
              }}
            >
              {[
                { label: "Pharmacy", value: importPreview.pharmacyName },
                { label: "Total Rows", value: importPreview.validPayloads.length + importPreview.skippedRows.length },
                { label: "Valid Rows", value: importPreview.validPayloads.length },
                { label: "Skipped", value: importPreview.skippedRows.length },
                { label: "Total Qty", value: importPreview.totalQty.toLocaleString() },
                { label: "Est. Cost Value", value: formatCurrency(importPreview.estimatedValue) },
              ].map(({ label, value }) => (
                <div key={label} style={{ ...kpiCard, textAlign: "left", padding: "14px 16px" }}>
                  <div style={kpiLabel}>{label}</div>
                  <div style={{ ...kpiValue, fontSize: "18px" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Validation errors */}
            {importPreview.skippedRows.length > 0 && (
              <div
                style={{
                  marginBottom: "14px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "12px",
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "12px", color: "#92400e", marginBottom: "6px" }}>
                  {importPreview.skippedRows.length} row(s) will be skipped
                </div>
                {importPreview.skippedRows.slice(0, 5).map((issue) => (
                  <div key={issue} style={{ fontSize: "12px", color: "#b45309", lineHeight: 1.7 }}>{issue}</div>
                ))}
                {importPreview.skippedRows.length > 5 && (
                  <div style={{ fontSize: "12px", color: "#b45309" }}>
                    … and {importPreview.skippedRows.length - 5} more.
                  </div>
                )}
              </div>
            )}

            {/* First-10 rows preview table */}
            <div style={{ overflowX: "auto", marginBottom: "18px" }}>
              <div style={{ fontWeight: 700, fontSize: "12px", color: "#334155", marginBottom: "8px" }}>
                Preview (first {importPreview.previewRows.length} of {importPreview.validPayloads.length} valid rows)
              </div>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: "13px" }}>
                <thead>
                  <tr>
                    {["Drug Name", "Brand", "Barcode", "Qty", "Unit", "Unit Cost", "Sales Price", "Expiry", "Batch"].map((h) => (
                      <th key={h} style={{ ...thStyle, fontSize: "10px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {importPreview.previewRows.map((row, idx) => (
                    <tr key={`preview-${idx}`} style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{row.drug_name || "-"}</td>
                      <td style={tdStyle}>{row.brand_name || "-"}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{row.barcode || "-"}</td>
                      <td style={tdStyle}>{row.quantity}</td>
                      <td style={tdStyle}>{row.unit || "-"}</td>
                      <td style={tdStyle}>{formatCurrency(row.unit_cost)}</td>
                      <td style={tdStyle}>{formatCurrency(row.sales_price)}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{row.expiry_date}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{row.batch_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Confirm / Cancel */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={bulkUploadProcessing}
                onClick={handleConfirmImport}
                style={{
                  ...buttonStyle,
                  opacity: bulkUploadProcessing ? 0.6 : 1,
                  cursor: bulkUploadProcessing ? "not-allowed" : "pointer",
                }}
              >
                {bulkUploadProcessing
                  ? "Inserting…"
                  : `Confirm Import (${importPreview.validPayloads.length} rows)`}
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={bulkUploadProcessing}
                onClick={handleCancelImport}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Inventory Intelligence</div>
        <div style={kpiGrid}>
          <StatCard
            className="ui-hover-lift"
            style={kpiCard}
            accentColor="#f59e0b"
            accentBorderWidth={4}
            label="Low Stock Items"
            value={inventoryIntelligence.lowStockCount}
            hint={
              inventoryIntelligence.lowStockCount === 0
                ? "All items well stocked"
                : "Items with qty ≤ 10"
            }
            labelStyle={kpiLabel}
            valueStyle={kpiValue}
            hintStyle={kpiHint}
          />
          <StatCard
            className="ui-hover-lift"
            style={kpiCard}
            accentColor="#ef4444"
            accentBorderWidth={4}
            label="Near Expiry Items"
            value={inventoryIntelligence.nearExpiryCount}
            hint={
              inventoryIntelligence.nearExpiryCount === 0
                ? "No near-expiry items"
                : "Expiring in 180 days"
            }
            labelStyle={kpiLabel}
            valueStyle={kpiValue}
            hintStyle={kpiHint}
          />
          <StatCard
            className="ui-hover-lift"
            style={kpiCard}
            accentColor="#06b6d4"
            accentBorderWidth={4}
            label="Value at Risk"
            value={
              inventoryIntelligence.valueAtRisk > 0
                ? formatCurrency(inventoryIntelligence.valueAtRisk)
                : "AED 0.00"
            }
            hint="Near-expiry stock value"
            labelStyle={kpiLabel}
            valueStyle={{ ...kpiValue, fontSize: "18px" }}
            hintStyle={kpiHint}
          />
        </div>
        {inventoryIntelligence.highestRiskItem && (
          <div
            style={{
              marginTop: "16px",
              padding: "15px 17px",
              background: "linear-gradient(180deg, #fff5f5 0%, #fff0f0 100%)",
              borderRadius: "14px",
              border: "1px solid #fecaca",
              fontSize: "13px",
              color: "#7f1d1d",
              boxShadow: "0 8px 18px rgba(127,29,29,0.07)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "4px" }}>Highest Risk Item</div>
            <div>
              {inventoryIntelligence.highestRiskItem.drugName} •{" "}
              {formatCurrency(inventoryIntelligence.highestRiskItem.riskValue)}
            </div>
          </div>
        )}
      </div>

      {inventoryInsight && (
        <InsightCard
          icon={inventoryInsight.icon}
          tone={inventoryInsight.tone}
          title={inventoryInsight.title}
          message={inventoryInsight.message}
          style={{ marginBottom: "24px" }}
        />
      )}

      <div style={cardStyle}>
        <div style={sectionTitle}>Inventory Health Score</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "32px", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center", minWidth: "120px" }}>
            <div
              style={{
                fontSize: "56px",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color:
                  inventoryHealthScore.score >= 90
                    ? "#16a34a"
                    : inventoryHealthScore.score >= 75
                    ? "#2563eb"
                    : inventoryHealthScore.score >= 50
                    ? "#d97706"
                    : "#dc2626",
              }}
            >
              {inventoryHealthScore.score}
            </div>
            <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "4px", fontWeight: 600 }}>
              / 100
            </div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                marginTop: "10px",
                borderRadius: "999px",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                padding: "5px 12px",
                ...(inventoryHealthScore.status === "Excellent"
                  ? { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0", boxShadow: "0 0 0 3px rgba(34,197,94,0.08)" }
                  : inventoryHealthScore.status === "Good"
                  ? { background: "#dbeafe", color: "#1e40af", border: "1px solid #bfdbfe", boxShadow: "0 0 0 3px rgba(59,130,246,0.08)" }
                  : inventoryHealthScore.status === "Needs Attention"
                  ? { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", boxShadow: "0 0 0 3px rgba(245,158,11,0.08)" }
                  : { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", boxShadow: "0 0 0 3px rgba(239,68,68,0.08)" }),
              }}
            >
              {inventoryHealthScore.status}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "12px",
              flex: 1,
              minWidth: "260px",
            }}
          >
            <div style={{ ...kpiCard, borderTop: "4px solid #f59e0b", textAlign: "left" }}>
              <div style={kpiLabel}>Low Stock</div>
              <div style={{ ...kpiValue, fontSize: "22px" }}>{inventoryHealthScore.lowStockCount}</div>
              <div style={kpiHint}>items qty ≤ 10</div>
            </div>
            <div style={{ ...kpiCard, borderTop: "4px solid #f97316", textAlign: "left" }}>
              <div style={kpiLabel}>Near Expiry</div>
              <div style={{ ...kpiValue, fontSize: "22px" }}>{inventoryHealthScore.nearExpiryCount}</div>
              <div style={kpiHint}>31 – 180 days</div>
            </div>
            <div style={{ ...kpiCard, borderTop: "4px solid #ef4444", textAlign: "left" }}>
              <div style={kpiLabel}>Critical Expiry</div>
              <div style={{ ...kpiValue, fontSize: "22px" }}>{inventoryHealthScore.criticalExpiryCount}</div>
              <div style={kpiHint}>within 30 days</div>
            </div>
            <div style={{ ...kpiCard, borderTop: "4px solid #06b6d4", textAlign: "left" }}>
              <div style={kpiLabel}>Value at Risk</div>
              <div style={{ ...kpiValue, fontSize: "16px" }}>{formatCurrency(inventoryHealthScore.valueAtRisk)}</div>
              <div style={kpiHint}>near/critical expiry</div>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Expiry Risk Monitor</div>
        {expiryRiskItems.length === 0 ? (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e8edf5",
              borderRadius: "12px",
              padding: "24px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: "14px",
            }}
          >
            No items with critical or elevated expiry risk.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                background: "#fff",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Drug</th>
                  <th style={thStyle}>Barcode</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Unit</th>
                  <th style={thStyle}>Unit Cost</th>
                  <th style={thStyle}>Expiry Date</th>
                  <th style={thStyle}>Risk Value</th>
                  <th style={thStyle}>Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {expiryRiskItems.map((item, idx) => {
                  const badgeStyle =
                    item.riskLevel === "Critical"
                      ? { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", boxShadow: "0 0 0 3px rgba(239,68,68,0.09)" }
                      : item.riskLevel === "High Risk"
                      ? { background: "#ffedd5", color: "#9a3412", border: "1px solid #fed7aa", boxShadow: "0 0 0 3px rgba(249,115,22,0.08)" }
                      : { background: "#fef9c3", color: "#854d0e", border: "1px solid #fef08a", boxShadow: "0 0 0 3px rgba(250,204,21,0.10)" };
                  return (
                    <tr
                      key={item.id ?? idx}
                      style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{item.drug_name || "-"}</td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{item.barcode || "-"}</td>
                      <td style={tdStyle}>{item.quantity}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {item.unit_cost == null ? "-" : formatCurrency(item.unit_cost)}
                      </td>
                      <td style={{ ...tdStyle, color: "#64748b" }}>{item.expiry_date || "-"}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(item.riskValue)}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "999px",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            padding: "5px 10px",
                            ...badgeStyle,
                          }}
                        >
                          {item.riskLevel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <div style={sectionTitle}>Activity Stream</div>
            <div style={{ fontSize: "12px", color: "#7b8aa3", marginTop: "2px" }}>Latest 10 stock movements</div>
          </div>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#2563eb",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "999px",
              padding: "3px 10px",
            }}
          >
            Live
          </span>
        </div>

        {recentTransactions.length === 0 ? (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e8edf5",
              borderRadius: "12px",
              padding: "24px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: "14px",
            }}
          >
            No recent activity found.
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: "28px" }}>
            <div
              style={{
                position: "absolute",
                left: "9px",
                top: "14px",
                bottom: "14px",
                width: "2px",
                background: "linear-gradient(to bottom, #cbd5e1 0%, #e2e8f0 100%)",
                borderRadius: "2px",
              }}
            />
            {recentTransactions.slice(0, 10).map((tx, idx) => {
              const type = String(tx?.movement_type || "ADJUST").toUpperCase();
              const parsedDate = tx?.created_at ? new Date(tx.created_at) : null;
              const isValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());
              const timeLabel = isValidDate
                ? parsedDate.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                : "-";
              const from = tx?.from_pharmacy || tx?.from_location || null;
              const to = tx?.to_pharmacy || tx?.to_location || null;
              const accentColor =
                type === "ADD" ? "#2563eb"
                : type === "TRANSFER" ? "#7c3aed"
                : type === "DELETE" ? "#dc2626"
                : "#d97706";
              const accentBg =
                type === "ADD" ? "#eff6ff"
                : type === "TRANSFER" ? "#f5f3ff"
                : type === "DELETE" ? "#fef2f2"
                : "#fffbeb";
              return (
                <div
                  key={tx.id ?? `tx-${idx}`}
                  style={{ position: "relative", marginBottom: "10px" }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "-23px",
                      top: "13px",
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: accentColor,
                      boxShadow: `0 0 0 3px ${accentBg}, 0 0 0 5px ${accentColor}33`,
                      zIndex: 1,
                    }}
                  />
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: "12px",
                      alignItems: "center",
                      background: "#ffffff",
                      border: "1px solid #edf2f8",
                      borderLeft: `3px solid ${accentColor}`,
                      borderRadius: "10px",
                      padding: "10px 14px",
                      boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: accentColor,
                        background: accentBg,
                        border: `1px solid ${accentColor}33`,
                        borderRadius: "6px",
                        padding: "3px 8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {type}
                    </span>

                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
                        {tx.drug_name || "-"}
                      </span>
                      <span style={{ fontSize: "12px", color: "#475569" }}>
                        Qty&nbsp;<strong>{tx.quantity ?? "-"}</strong>
                      </span>
                      {(from || to) && (
                        <span style={{ fontSize: "12px", color: "#64748b" }}>
                          {from || "—"}&nbsp;→&nbsp;{to || "—"}
                        </span>
                      )}
                      {tx.batch_no && (
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>#{tx.batch_no}</span>
                      )}
                    </div>

                    <span style={{ fontSize: "11px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {timeLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Inventory Records</div>

        {loading ? (
          <div style={{ display: "grid", gap: "10px", paddingTop: "4px" }}>
            <SkeletonCard
              style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
              blocks={[
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 10, radius: 10 },
                { width: "100%", height: 42, gap: 0, radius: 10 },
              ]}
            />
          </div>
        ) : inventory.length === 0 ? (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e8edf5",
              borderRadius: "12px",
              padding: "36px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: "14px",
            }}
          >
            No inventory records found for this pharmacy.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                background: "#fff",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>Drug</th>
                  <th style={thStyle}>Barcode</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Unit</th>
                  <th style={thStyle}>Cost Price</th>
                  <th style={thStyle}>Sales Price</th>
                  <th style={thStyle}>Cost Value</th>
                  <th style={thStyle}>Sales Value</th>
                  <th style={thStyle}>Expiry</th>
                  <th style={thStyle}>Batch</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item, idx) => (
                  <tr
                    key={item.id}
                    style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{item.drug_name || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.barcode || "-"}</td>
                    <td style={tdStyle}>{item.quantity}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.stock_unit || item.unit || "-"}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(resolveCostPrice(item))}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {formatCurrency(resolveSalesPrice(item))}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {formatCurrency(resolveCostValue(item))}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {formatCurrency(resolveSalesValue(item))}
                    </td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.expiry_date || "-"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{item.batch_no || "-"}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={() => handleEdit(item)} style={editBtnStyle}>
                          Edit
                        </button>
                        <button onClick={() => handleDelete(item.id)} style={deleteBtnStyle}>
                          Delete
                        </button>
                      </div>
                    </td>
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