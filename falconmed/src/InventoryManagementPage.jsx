import React, { useEffect, useMemo, useState } from "react";
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
  getMasterAutofill,
  parseCsvText,
} from "./utils/drugMasterLookup";
import { loadPharmaciesWithFallback, normalizeInventoryRow } from "./utils/pharmacyData";

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

export default function InventoryManagementPage() {
  const [pharmacies, setPharmacies] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");
  const [allDrugs, setAllDrugs] = useState([]);
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);

  const [drugCode, setDrugCode] = useState("");
  const [drug, setDrug] = useState("");
  const [brandName, setBrandName] = useState("");
  const [genericName, setGenericName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [expiry, setExpiry] = useState("");
  const [batch, setBatch] = useState("");
  const [masterLookupStatus, setMasterLookupStatus] = useState("");
  const [masterLookupTone, setMasterLookupTone] = useState("neutral");
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recentTransactions, setRecentTransactions] = useState([]);

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

    setPharmacies(data || []);

    if (data && data.length > 0) {
      setSelectedPharmacyId(String(data[0].id));
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

  const pharmacyNameMap = useMemo(() => {
    const map = new Map();
    pharmacies.forEach((pharmacy) => {
      const normalized = String(pharmacy?.name || "").trim().toLowerCase();
      if (!normalized) return;
      map.set(normalized, String(pharmacy.id));
    });
    return map;
  }, [pharmacies]);

  useEffect(() => {
    const code = String(drugCode || "").trim();

    if (!code) {
      setDrug("");
      setBrandName("");
      setGenericName("");
      setBarcode("");
      setCost("");
      setMasterLookupStatus("");
      setMasterLookupTone("neutral");
      return;
    }

    const matchedDrug = findDrugByCode(code, drugCodeMap);
    if (!matchedDrug) {
      setDrug("");
      setBrandName("");
      setGenericName("");
      setBarcode("");
      setCost("");
      setMasterLookupStatus("Drug code not found");
      setMasterLookupTone("error");
      return;
    }

    const autofill = getMasterAutofill(matchedDrug, code);
    setDrug(autofill.drug_name);
    setBrandName(autofill.brand_name);
    setGenericName(autofill.generic_name);
    setBarcode(autofill.barcode);
    setCost(autofill.unit_cost);
    setMasterLookupStatus("Drug found in master database");
    setMasterLookupTone("success");
  }, [drugCode, drugCodeMap]);

  const runInventoryMutation = async ({ editingRowId, payload, legacyPayload }) => {
    if (!supabase) {
      return { error: new Error("Database is not configured.") };
    }

    const executeMutation = async (body) => {
      if (editingRowId) {
        return supabase.from("pharmacy_inventory").update(body).eq("id", editingRowId);
      }

      const insertBody = {
        ...body,
        created_at: new Date().toISOString(),
      };

      return supabase.from("pharmacy_inventory").insert([insertBody]);
    };

    let mutation = await executeMutation(payload);

    if (mutation.error) {
      const message = String(mutation.error.message || "").toLowerCase();
      const shouldFallback =
        message.includes("column") ||
        message.includes("schema cache") ||
        message.includes("drug_code") ||
        message.includes("brand_name") ||
        message.includes("generic_name");

      if (shouldFallback) {
        mutation = await executeMutation(legacyPayload);
      }
    }

    return mutation;
  };

  const parseUnitCost = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const getCsvValue = (row, keys) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  };

  const insertImportedInventoryRow = async ({
    pharmacyId,
    drugCode,
    drugName,
    brandName,
    genericName,
    barcodeValue,
    quantityValue,
    unitCostValue,
    expiryDateValue,
    batchNoValue,
  }) => {
    if (!supabase) {
      return { error: new Error("Database is not configured."), usedVariant: null };
    }

    const baseCommon = {
      pharmacy_id: pharmacyId,
      drug_code: drugCode,
      drug_name: drugName,
      brand_name: brandName || null,
      generic_name: genericName || null,
      barcode: barcodeValue || null,
      unit_cost: unitCostValue,
      expiry_date: expiryDateValue,
      created_at: new Date().toISOString(),
    };

    const variants = [
      {
        name: "quantity+batch_no",
        payload: {
          ...baseCommon,
          quantity: quantityValue,
          batch_no: batchNoValue,
        },
      },
      {
        name: "current_stock_qty+batch_no",
        payload: {
          ...baseCommon,
          current_stock_qty: quantityValue,
          batch_no: batchNoValue,
        },
      },
      {
        name: "quantity+batch",
        payload: {
          ...baseCommon,
          quantity: quantityValue,
          batch: batchNoValue,
        },
      },
      {
        name: "current_stock_qty+batch",
        payload: {
          ...baseCommon,
          current_stock_qty: quantityValue,
          batch: batchNoValue,
        },
      },
    ];

    let lastError = null;

    for (const variant of variants) {
      const mutation = await supabase.from("pharmacy_inventory").insert([variant.payload]);
      if (!mutation.error) {
        return { error: null, usedVariant: variant.name };
      }

      lastError = mutation.error;
      const message = String(mutation.error.message || "").toLowerCase();
      const isSchemaMismatch =
        message.includes("column") ||
        message.includes("schema cache") ||
        message.includes("could not find");

      if (!isSchemaMismatch) {
        return { error: mutation.error, usedVariant: variant.name };
      }
    }

    return { error: lastError, usedVariant: null };
  };

  function resetForm() {
    setDrugCode("");
    setDrug("");
    setBrandName("");
    setGenericName("");
    setBarcode("");
    setQty("");
    setCost("");
    setExpiry("");
    setBatch("");
    setEditingId(null);
    setMasterLookupStatus("");
    setMasterLookupTone("neutral");
    setError("");
    setSuccess("");
  }

  async function handleBulkImport() {
    if (!importFile) {
      setError("Please choose a CSV file to import.");
      return;
    }

    setError("");
    setSuccess("");
    setImportSummary(null);
    setImportBusy(true);

    try {
      const csvText = await importFile.text();
      const { rows, headers } = parseCsvText(csvText);

      const requiredHeaders = ["drug_code", "current_stock_qty", "batch_no", "expiry_date"];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

      if (missingHeaders.length > 0) {
        setError(`Missing required CSV column(s): ${missingHeaders.join(", ")}`);
        setImportBusy(false);
        return;
      }

      if (rows.length === 0) {
        setError("CSV file has no data rows.");
        setImportBusy(false);
        return;
      }

      let importedRows = 0;
      let skippedRows = 0;
      const missingDrugCodes = new Set();
      const insertErrors = [];

      const selectedPharmacy = String(selectedPharmacyId || "").trim();
      if (!selectedPharmacy) {
        setError("Please select a pharmacy before CSV import.");
        setImportBusy(false);
        return;
      }

      for (const row of rows) {
        const code = getCsvValue(row, ["drug_code", "code"]);
        const quantityRaw = getCsvValue(row, ["current_stock_qty", "quantity", "qty"]);
        const batchNo = getCsvValue(row, ["batch_no", "batch"]);
        const expiryDate = getCsvValue(row, ["expiry_date", "expiry"]);
        const overrideCostRaw = getCsvValue(row, ["unit_cost", "cost"]);

        const quantity = Number(quantityRaw);
        if (!code || !batchNo || !expiryDate || !Number.isFinite(quantity) || quantity < 0) {
          skippedRows += 1;
          continue;
        }

        const matchedDrug = findDrugByCode(code, drugCodeMap);
        if (!matchedDrug) {
          missingDrugCodes.add(code);
          skippedRows += 1;
          continue;
        }

        const autofill = getMasterAutofill(matchedDrug, code);

        const overrideCost = parseUnitCost(overrideCostRaw);
        const autoCost = parseUnitCost(autofill.unit_cost);
        const finalUnitCost = overrideCost ?? autoCost ?? 0;

        const resolvedDrugName =
          autofill.drug_name || autofill.brand_name || autofill.generic_name || code;

        const insertResult = await insertImportedInventoryRow({
          pharmacyId: selectedPharmacy,
          drugCode: autofill.drug_code,
          drugName: resolvedDrugName,
          brandName: autofill.brand_name,
          genericName: autofill.generic_name,
          barcodeValue: autofill.barcode,
          quantityValue: quantity,
          unitCostValue: finalUnitCost,
          expiryDateValue: expiryDate,
          batchNoValue: batchNo,
        });

        if (insertResult.error) {
          console.error("CSV import row insert failed", {
            code,
            row,
            error: insertResult.error,
            variantTried: insertResult.usedVariant,
          });
          insertErrors.push(`${code}: ${insertResult.error.message || "Insert failed"}`);
          skippedRows += 1;
          continue;
        }

        importedRows += 1;
      }

      const missingCodesList = Array.from(missingDrugCodes);
      setImportSummary({
        importedRows,
        skippedRows,
        missingDrugCodes: missingCodesList,
      });

      if (importedRows > 0) {
        setSuccess(`Import complete. ${importedRows} row(s) imported, ${skippedRows} row(s) skipped.`);
        await fetchInventory(selectedPharmacyId);
      } else {
        setError("No rows were imported. Please check drug_code and required fields.");
      }

      if (insertErrors.length > 0) {
        console.error("CSV import insert errors:", insertErrors);
      }
    } catch (importError) {
      console.error("CSV import failed:", importError);
      setError("Failed to import CSV file.");
    }

    setImportBusy(false);
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
      setError("Drug code is required.");
      return;
    }

    const matchedDrug = findDrugByCode(normalizedDrugCode, drugCodeMap);
    if (!matchedDrug) {
      setError("Invalid drug code. Please select a valid code from master data.");
      return;
    }

    if (!qty || Number(qty) < 0) {
      setError("Please enter valid quantity.");
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

    const autofill = getMasterAutofill(matchedDrug, normalizedDrugCode);
    const resolvedDrugName =
      autofill.drug_name || autofill.brand_name || autofill.generic_name || normalizedDrugCode;
    const resolvedUnitCost = parseUnitCost(autofill.unit_cost) ?? 0;

    const payload = {
      pharmacy_id: selectedPharmacyId,
      drug_code: autofill.drug_code,
      drug_name: resolvedDrugName,
      brand_name: autofill.brand_name || null,
      generic_name: autofill.generic_name || null,
      barcode: autofill.barcode || null,
      quantity: Number(qty) || 0,
      unit_cost: resolvedUnitCost,
      expiry_date: expiry || null,
      batch_no: batch.trim() || null,
    };

    const legacyPayload = {
      pharmacy_id: selectedPharmacyId,
      drug_name: resolvedDrugName,
      barcode: autofill.barcode || null,
      quantity: Number(qty) || 0,
      unit_cost: resolvedUnitCost,
      expiry_date: expiry || null,
      batch_no: batch.trim() || null,
    };

    const mutation = await runInventoryMutation({
      editingRowId: editingId,
      payload,
      legacyPayload,
    });

    if (mutation.error) {
      console.error("Inventory insert/update error:", mutation.error);
      setError(
        (editingId ? "Failed to update record: " : "Failed to add record: ") +
          (mutation.error.message || "Unknown error")
      );
      return;
    }

    const selectedPharmacy =
      pharmacies.find((p) => String(p.id) === String(selectedPharmacyId)) || null;

    const pharmacyName = selectedPharmacy?.name || `Pharmacy ${selectedPharmacyId}`;
    const actionVerb = editingId ? "Updated" : "Added";
    const movementType = editingId ? "UPDATE" : "ADD";
    const quantityNumber = Number(qty) || 0;
    const batchValue = batch.trim() || "-";
    const expiryValue = expiry || "-";
    const nowIso = new Date().toISOString();
    const referenceValue = `Inventory ${movementType} - ${resolvedDrugName}`;

    const txSummary =
      `${movementType} inventory transaction | ` +
      `Drug: ${resolvedDrugName} | ` +
      `Qty: ${quantityNumber} | ` +
      `Barcode: ${autofill.barcode || "-"} | ` +
      `Pharmacy: ${pharmacyName} | ` +
      `Batch: ${batchValue} | ` +
      `Expiry: ${expiryValue} | ` +
      `Unit cost: ${resolvedUnitCost}`;

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

    setSuccess(
      editingId
        ? "Inventory record updated successfully."
        : "Drug added successfully."
    );

    resetForm();
    fetchInventory(selectedPharmacyId);
  }

  function handleEdit(item) {
    setEditingId(item.id);
    setDrugCode(item.drug_code || "");
    setDrug(item.drug_name || item.drug || "");
    setBrandName(item.brand_name || "");
    setGenericName(item.generic_name || "");
    setBarcode(item.barcode || "");
    setQty(item.quantity ?? "");
    setCost(item.unit_cost ?? "");
    setExpiry(item.expiry_date || "");
    setBatch(item.batch_no || item.batch || "");
    setShowDrugDropdown(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

    const pharmacyName = selectedPharmacy?.name || `Pharmacy ${rowPharmacyId || "-"}`;

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
  }

  const totalItems = useMemo(() => {
    return inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [inventory]);

  const totalValue = useMemo(() => {
    return inventory.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
      0
    );
  }, [inventory]);

  const filteredDrugs = useMemo(
    () => searchDrugMaster(allDrugs, drugCode, 20),
    [allDrugs, drugCode]
  );

  const animTotalItems = useAnimatedCounter(totalItems);
  const animTotalValue = useAnimatedCounter(totalValue);
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
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0),
      0
    );

    let highestRiskItem = null;
    if (nearExpiryItems.length > 0) {
      let maxRiskValue = 0;
      nearExpiryItems.forEach((item) => {
        const riskValue = Number(item.quantity || 0) * Number(item.unit_cost || 0);
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
        riskValue: Number(item.quantity || 0) * Number(item.unit_cost || 0),
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
      const unitCost = Number(item.unit_cost || 0);
      if (qty > 0 && qty <= 10) lowStockCount += 1;
      if (item.expiry_date) {
        try {
          const expDate = new Date(item.expiry_date);
          if (!isNaN(expDate.getTime())) {
            if (expDate >= today && expDate <= in30) {
              criticalExpiryCount += 1;
              valueAtRisk += qty * unitCost;
            } else if (expDate > in30 && expDate <= in180) {
              nearExpiryCount += 1;
              valueAtRisk += qty * unitCost;
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
    setDrugCode(selectedDrug?.drug_code || "");
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
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
    "drug_code,current_stock_qty,batch_no,expiry_date",
    "H03-4489-00178-02,25,BATCH001,2027-12-31",
    "N05-5258-05575-01,337,BATCH001,2027-12-31",
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
              Array.from({ length: 3 }).map((_, index) => (
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
                  label="Total Value"
                  value={formatCurrency(animTotalValue)}
                  hint="Stock valuation at cost"
                  labelStyle={kpiLabel}
                  valueStyle={{ ...kpiValue, fontSize: "20px" }}
                  hintStyle={kpiHint}
                />
                <StatCard
                  className="ui-hover-lift"
                  style={kpiCard}
                  accentColor="#8b5cf6"
                  accentBorderWidth={4}
                  label="Records"
                  value={animRecords}
                  hint="Inventory line items"
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
              <label style={labelStyle}>Search Drug (code or name)</label>
              <div style={{ position: "relative" }}>
                <input
                  value={drugCode}
                  onChange={(e) => {
                    setDrugCode(e.target.value);
                    setShowDrugDropdown(true);
                  }}
                  onFocus={() => setShowDrugDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDrugDropdown(false), 160)}
                  placeholder="Search by code, brand, or generic"
                  style={inputStyle}
                />
                <div style={fieldHint}>Enter drug code to auto-fill drug details</div>
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
                          {result.drug_code || "No code"} - {getDrugDisplayName(result)}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                          {result.generic_name || "Generic name unavailable"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
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
              <label style={labelStyle}>Quantity Added</label>
              <input
                type="number"
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

          <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
            <button type="submit" style={buttonStyle}>
              {editingId ? "Update Record" : "Save Entry"}
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={resetForm}>
              Clear
            </button>
          </div>
        </form>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Bulk Upload (Admin Setup)</div>
        <div style={guideText}>
          For large inventory uploads, use the prepared CSV template and import directly through Supabase Table Editor. Use Smart Entry for daily operations.
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={buttonStyle} onClick={handleDownloadCsvTemplate}>
            Download CSV Template
          </button>
          <a
            href="https://supabase.com/docs/guides/database/tables#importing-data"
            target="_blank"
            rel="noreferrer"
            style={{
              ...secondaryButtonStyle,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            How to Import in Supabase
          </a>
        </div>
        <div style={smallNote}>
          Recommended for first-time onboarding and large data uploads.
        </div>
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
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(item.unit_cost)}</td>
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
                  <th style={thStyle}>Unit Cost</th>
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
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{formatCurrency(item.unit_cost)}</td>
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