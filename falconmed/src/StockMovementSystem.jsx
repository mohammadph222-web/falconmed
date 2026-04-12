import { useEffect, useMemo, useRef, useState } from "react";
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
    window.sessionStorage.setItem(
      STOCK_MOVEMENT_DRAFT_STORAGE_KEY,
      JSON.stringify(value)
    );
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeNullableText(value) {
  const v = normalizeText(value);
  return v || null;
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function formatPriceDisplay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `AED ${number.toFixed(2)}`;
}

function buildUniquePharmacyOptions(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const id = normalizeText(row?.id);
    if (!id || map.has(id)) continue;

    map.set(id, {
      id,
      name: normalizeText(row?.name),
      location: normalizeText(row?.location),
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""))
  );
}

function buildDrugDisplayLabel(drug) {
  const brandName = normalizeText(drug?.brand_name);
  const strength = normalizeText(drug?.strength);
  const dosageForm = normalizeText(drug?.dosage_form);

  return [brandName, strength, dosageForm].filter(Boolean).join(" ").trim();
}

function buildDrugSearchIndex(drug) {
  return [
    normalizeText(drug?.brand_name),
    normalizeText(drug?.strength),
    normalizeText(drug?.dosage_form),
    normalizeText(drug?.generic_name),
    normalizeText(drug?.drug_code),
    normalizeText(drug?.package_size),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeDateValue(value) {
  const v = normalizeText(value);
  return v || null;
}

function sameNullableText(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function sameNullableDate(a, b) {
  return normalizeDateValue(a) === normalizeDateValue(b);
}

function buildMovementPayload({
  movementType,
  drugName,
  quantity,
  fromName,
  toName,
  batchNo,
  expiryDate,
  referenceNo,
  notes,
}) {
  return {
    movement_type: movementType,
    drug_name: drugName,
    quantity,
    from_pharmacy: fromName || null,
    to_pharmacy: toName || null,
    batch_no: batchNo || null,
    expiry_date: expiryDate || null,
    reference_no: referenceNo || null,
    notes: notes || null,
    created_at: new Date().toISOString(),
    created_by: "falconmed.demo@preview",
  };
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

  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [selectedDrugOption, setSelectedDrugOption] = useState(null);

  const drugInputRef = useRef(null);

  const pharmacyMap = useMemo(() => {
    const map = new Map();

    for (const row of pharmacyOptions) {
      const id = normalizeText(row?.id);
      if (!id || map.has(id)) continue;

      map.set(id, {
        id,
        name: normalizeText(row?.name),
        location: normalizeText(row?.location),
      });
    }

    return map;
  }, [pharmacyOptions]);

  const isTransferType =
    formData.movement_type === "Transfer Out" ||
    formData.movement_type === "Transfer In";

  const summary = useMemo(() => {
    const total = rows.length;
    const transferOuts = rows.filter(
      (r) => r.movement_type === "Transfer Out"
    ).length;
    const transferIns = rows.filter(
      (r) => r.movement_type === "Transfer In"
    ).length;
    const adjustments = rows.filter(
      (r) =>
        r.movement_type === "Adjustment+" || r.movement_type === "Adjustment-"
    ).length;

    return {
      total,
      transferOuts,
      transferIns,
      adjustments,
    };
  }, [rows]);

  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(initialForm).some((key) => {
      const current = String(formData[key] || "").trim();
      const initial = String(initialForm[key] || "").trim();
      return current !== initial;
    });
  }, [formData]);

  const getPharmacyNameById = (pharmacyId) => {
    const id = normalizeText(pharmacyId);
    return pharmacyMap.get(id)?.name || "Unknown Pharmacy";
  };

  const resolveSelectedDrugOptionFromInput = () => {
    if (
      selectedDrugOption &&
      normalizeText(selectedDrugOption.display_name) ===
        normalizeText(formData.drug_name)
    ) {
      return selectedDrugOption;
    }

    const typed = normalizeText(formData.drug_name).toLowerCase();
    if (!typed) return null;

    const exact = drugOptions.find(
      (option) =>
        normalizeText(option.display_name).toLowerCase() === typed ||
        normalizeText(option.drug_code).toLowerCase() === typed
    );

    return exact || null;
  };

  const filteredDrugOptions = useMemo(() => {
    const query = normalizeText(formData.drug_name).toLowerCase();

    if (!query) {
      return drugOptions.slice(0, 20);
    }

    return drugOptions
      .filter((option) => option.searchIndex.includes(query))
      .slice(0, 20);
  }, [drugOptions, formData.drug_name]);

  useEffect(() => {
    const persisted = readStockMovementDraft();
    if (!persisted?.formData || typeof persisted.formData !== "object") return;

    setFormData((prev) => ({
      ...prev,
      ...persisted.formData,
    }));

    if (persisted?.selectedDrugOption) {
      setSelectedDrugOption(persisted.selectedDrugOption);
    }

    const restored = Object.keys(initialForm).some((key) => {
      const value = String(persisted.formData[key] || "").trim();
      return value !== String(initialForm[key] || "").trim();
    });

    if (restored) {
      setRestoredDraftMessage("Restored unsaved draft");
    }
  }, []);

  useEffect(() => {
    writeStockMovementDraft({ formData, selectedDrugOption });
  }, [formData, selectedDrugOption]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    const beforeUnloadHandler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnloadHandler);
    return () =>
      window.removeEventListener("beforeunload", beforeUnloadHandler);
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

      setRows(Array.isArray(data) ? data : []);
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
      const MAX_ROWS = 30000;

      while (pageFrom < MAX_ROWS) {
        const { data, error } = await supabase
          .from("drug_master")
          .select(
            "brand_name, generic_name, strength, dosage_form, drug_code, package_size, price_to_pharmacy, price_to_public"
          )
          .range(pageFrom, pageFrom + PAGE_SIZE - 1);

        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) break;

        allRows = allRows.concat(data);

        if (data.length < PAGE_SIZE) break;
        pageFrom += PAGE_SIZE;
      }

      const byKey = new Map();

      for (const row of allRows) {
        const displayLabel = buildDrugDisplayLabel(row);
        const drugCode = normalizeText(row?.drug_code);
        if (!displayLabel || !drugCode) continue;

        const option = {
          displayLabel,
          display_name: displayLabel,
          brand_name: normalizeText(row?.brand_name),
          generic_name: normalizeText(row?.generic_name),
          strength: normalizeText(row?.strength),
          dosage_form: normalizeText(row?.dosage_form),
          drug_code: drugCode,
          package_size: normalizeText(row?.package_size),
          price_to_pharmacy: row?.price_to_pharmacy,
          price_to_public: row?.price_to_public,
          searchIndex: buildDrugSearchIndex(row),
        };

        const key = `${drugCode}::${displayLabel}`;
        if (!byKey.has(key)) {
          byKey.set(key, option);
        }
      }

      const distinct = Array.from(byKey.values()).sort((a, b) =>
        a.displayLabel.localeCompare(b.displayLabel)
      );

      setDrugOptions(distinct);
    } catch {
      setDrugOptions([]);
    }

    try {
      const { data, error } = await supabase
        .from("pharmacies")
        .select("id, name, location")
        .limit(2000);

      if (!error && Array.isArray(data)) {
        setPharmacyOptions(buildUniquePharmacyOptions(data));
      } else {
        setPharmacyOptions([]);
      }
    } catch {
      setPharmacyOptions([]);
    }
  };

  useEffect(() => {
    void loadMovements();
    void loadFormOptions();
  }, []);

  const fetchInventoryRows = async (pharmacyId, drugCode) => {
    const safePharmacyId = normalizeText(pharmacyId);
    const safeDrugCode = normalizeText(drugCode);

    if (!safePharmacyId || !safeDrugCode) {
      return [];
    }

    const { data, error } = await supabase
      .from("pharmacy_inventory")
      .select("id, pharmacy_id, drug_code, quantity, unit_type, batch_no, expiry_date")
      .eq("pharmacy_id", safePharmacyId)
      .eq("drug_code", safeDrugCode)
      .limit(500);

    if (error) {
      throw new Error(`Inventory lookup failed: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];

    return rows.sort((a, b) => {
      const aDate = a?.expiry_date ? new Date(a.expiry_date).getTime() : Number.MAX_SAFE_INTEGER;
      const bDate = b?.expiry_date ? new Date(b.expiry_date).getTime() : Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });
  };

  const getAvailableInventoryQuantity = async (pharmacyId, drugCode, batchNo) => {
    const rows = await fetchInventoryRows(pharmacyId, drugCode);
    const safeBatch = normalizeText(batchNo);

    const relevantRows = safeBatch
      ? rows.filter((row) => sameNullableText(row.batch_no, safeBatch))
      : rows;

    return relevantRows.reduce((sum, row) => {
      const qty = Number(row?.quantity || 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);
  };

  const addInventoryQuantity = async ({
    pharmacyId,
    pharmacyName,
    drugCode,
    quantity,
    batchNo,
    expiryDate,
    unitType = "unit",
  }) => {
    const safePharmacyId = normalizeText(pharmacyId);
    const safeDrugCode = normalizeText(drugCode);

    if (!safePharmacyId || !safeDrugCode) {
      throw new Error(
        `Inventory sync failed for "${pharmacyName || "Unknown Pharmacy"}": pharmacy or drug code is missing.`
      );
    }

    const rows = await fetchInventoryRows(safePharmacyId, safeDrugCode);

    const targetRow = rows.find(
      (row) =>
        sameNullableText(row.batch_no, batchNo) &&
        sameNullableDate(row.expiry_date, expiryDate)
    );

    if (targetRow) {
      const currentQty = Number(targetRow.quantity || 0);
      const nextQty = currentQty + quantity;

      const { error } = await supabase
        .from("pharmacy_inventory")
        .update({
          quantity: nextQty,
          unit_type: normalizeNullableText(targetRow.unit_type) || unitType,
          batch_no: normalizeNullableText(targetRow.batch_no) || normalizeNullableText(batchNo),
          expiry_date: normalizeDateValue(targetRow.expiry_date) || normalizeDateValue(expiryDate),
        })
        .eq("id", targetRow.id);

      if (error) {
        throw new Error(`Inventory update failed: ${error.message}`);
      }

      return;
    }

    const insertPayload = {
      pharmacy_id: safePharmacyId,
      drug_code: safeDrugCode,
      quantity,
      unit_type: unitType,
      batch_no: normalizeNullableText(batchNo),
      expiry_date: normalizeDateValue(expiryDate),
    };

    const { error } = await supabase
      .from("pharmacy_inventory")
      .insert([insertPayload]);

    if (error) {
      throw new Error(`Inventory insert failed: ${error.message}`);
    }
  };

  const subtractInventoryQuantity = async ({
    pharmacyId,
    pharmacyName,
    drugCode,
    quantity,
    batchNo,
  }) => {
    const safePharmacyId = normalizeText(pharmacyId);
    const safeDrugCode = normalizeText(drugCode);

    if (!safePharmacyId || !safeDrugCode) {
      throw new Error(
        `Inventory sync failed for "${pharmacyName || "Unknown Pharmacy"}": pharmacy or drug code is missing.`
      );
    }

    let rows = await fetchInventoryRows(safePharmacyId, safeDrugCode);

    const safeBatch = normalizeText(batchNo);
    if (safeBatch) {
      rows = rows.filter((row) => sameNullableText(row.batch_no, safeBatch));
    }

    const totalAvailable = rows.reduce((sum, row) => {
      const qty = Number(row?.quantity || 0);
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    if (totalAvailable < quantity) {
      throw new Error(
        `Insufficient stock: "${safeDrugCode}" at "${
          pharmacyName || "Unknown Pharmacy"
        }" has ${totalAvailable} unit(s). Cannot subtract ${quantity}.`
      );
    }

    let remainingToSubtract = quantity;

    for (const row of rows) {
      if (remainingToSubtract <= 0) break;

      const currentQty = Number(row.quantity || 0);
      if (currentQty <= 0) continue;

      const deduct = Math.min(currentQty, remainingToSubtract);
      const nextQty = currentQty - deduct;

      if (nextQty <= 0) {
        const { error } = await supabase
          .from("pharmacy_inventory")
          .delete()
          .eq("id", row.id);

        if (error) {
          throw new Error(`Inventory delete failed: ${error.message}`);
        }
      } else {
        const { error } = await supabase
          .from("pharmacy_inventory")
          .update({ quantity: nextQty })
          .eq("id", row.id);

        if (error) {
          throw new Error(`Inventory update failed: ${error.message}`);
        }
      }

      remainingToSubtract -= deduct;
    }
  };

  const insertMovementRows = async (movementPayloads) => {
    if (!Array.isArray(movementPayloads) || movementPayloads.length === 0) {
      return [];
    }

    let movementInsert = await supabase
      .from("stock_movements")
      .insert(movementPayloads)
      .select("*");

    if (movementInsert.error) {
      const msg = String(movementInsert.error.message || "").toLowerCase();
      const createdByMissing =
        msg.includes("created_by") && msg.includes("column");

      if (createdByMissing) {
        const fallbackPayloads = movementPayloads.map((payload) => {
          const { created_by, ...rest } = payload;
          return rest;
        });

        movementInsert = await supabase
          .from("stock_movements")
          .insert(fallbackPayloads)
          .select("*");
      }
    }

    if (movementInsert.error) {
      throw movementInsert.error;
    }

    return Array.isArray(movementInsert.data) ? movementInsert.data : [];
  };

  const onChange = (event) => {
    const { name, value } = event.target;

    setFormData((prev) => {
      const next = { ...prev, [name]: value };

      if (name === "movement_type") {
        const transfer = value === "Transfer Out" || value === "Transfer In";

        if (
          transfer &&
          next.from_pharmacy &&
          next.from_pharmacy === next.to_pharmacy
        ) {
          next.to_pharmacy = "";
        }
      }

      if (
        name === "from_pharmacy" &&
        isTransferType &&
        value &&
        value === prev.to_pharmacy
      ) {
        next.to_pharmacy = "";
      }

      if (
        name === "to_pharmacy" &&
        isTransferType &&
        value &&
        value === prev.from_pharmacy
      ) {
        next.from_pharmacy = "";
      }

      return next;
    });
  };

  const handleDrugInputChange = (event) => {
    const value = event.target.value;

    setFormData((prev) => ({
      ...prev,
      drug_name: value,
    }));

    setSelectedDrugOption((prev) => {
      if (!prev) return null;
      return normalizeText(prev.display_name) === normalizeText(value)
        ? prev
        : null;
    });

    setShowDrugDropdown(true);
  };

  const handleDrugInputBlur = () => {
    window.setTimeout(() => {
      setShowDrugDropdown(false);
    }, 120);
  };

  const selectDrugName = (drugOption) => {
    const resolvedLabel =
      buildDrugDisplayLabel(drugOption) ||
      normalizeText(drugOption?.display_name) ||
      normalizeText(drugOption?.brand_name);

    const normalizedOption = {
      ...drugOption,
      display_name: resolvedLabel,
    };

    setFormData((prev) => ({
      ...prev,
      drug_name: resolvedLabel,
    }));

    setSelectedDrugOption(normalizedOption);
    setShowDrugDropdown(false);

    window.requestAnimationFrame(() => {
      drugInputRef.current?.blur();
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();

    if (submitting) return;

    setFeedback({ type: "", text: "" });

    const qty = Number(formData.quantity);
    const movementType = normalizeText(formData.movement_type);
    const drugName = normalizeText(formData.drug_name);
    const batchNo = normalizeNullableText(formData.batch_no);
    const expiryDate = normalizeDateValue(formData.expiry_date);
    const referenceNo = normalizeNullableText(formData.reference_no);
    const notes = normalizeNullableText(formData.notes);

    const fromPharmacyId = normalizeText(formData.from_pharmacy);
    const toPharmacyId = normalizeText(formData.to_pharmacy);

    if (!drugName) {
      setFeedback({ type: "error", text: "Drug name is required." });
      return;
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({
        type: "error",
        text: "Quantity must be greater than zero.",
      });
      return;
    }

    const resolvedDrug = resolveSelectedDrugOptionFromInput();

    if (!resolvedDrug?.drug_code) {
      setFeedback({
        type: "error",
        text: "Please select a valid drug from the dropdown so the system can use the correct drug code.",
      });
      return;
    }

    const drugCode = normalizeText(resolvedDrug.drug_code);
    const unitType = "unit";

    if (!supabase) {
      setFeedback({
        type: "warning",
        text: "Supabase is not configured. Unable to save movement.",
      });
      return;
    }

    if (movementType === "Receive" && !toPharmacyId) {
      setFeedback({
        type: "error",
        text: "To Pharmacy is required for Receive movements.",
      });
      return;
    }

    if (movementType === "Issue" && !fromPharmacyId) {
      setFeedback({
        type: "error",
        text: "From Pharmacy is required for Issue movements.",
      });
      return;
    }

    if (isTransferType) {
      if (!fromPharmacyId || !toPharmacyId) {
        setFeedback({
          type: "error",
          text: "Both From Pharmacy and To Pharmacy are required for transfer movements.",
        });
        return;
      }

      if (fromPharmacyId === toPharmacyId) {
        setFeedback({
          type: "error",
          text: "From Pharmacy and To Pharmacy cannot be the same for transfer movements.",
        });
        return;
      }
    }

    if (movementType === "Adjustment-" && !fromPharmacyId && !toPharmacyId) {
      setFeedback({
        type: "error",
        text: "Please choose a pharmacy for Adjustment- movement.",
      });
      return;
    }

    if (movementType === "Adjustment+" && !fromPharmacyId && !toPharmacyId) {
      setFeedback({
        type: "error",
        text: "Please choose a pharmacy for Adjustment+ movement.",
      });
      return;
    }

    if (movementType === "Return" && !fromPharmacyId && !toPharmacyId) {
      setFeedback({
        type: "error",
        text: "Please choose a pharmacy for Return movement.",
      });
      return;
    }

    setSubmitting(true);

    try {
      const fromName = fromPharmacyId ? getPharmacyNameById(fromPharmacyId) : null;
      const toName = toPharmacyId ? getPharmacyNameById(toPharmacyId) : null;

      if (movementType === "Issue") {
        const availableQty = await getAvailableInventoryQuantity(
          fromPharmacyId,
          drugCode,
          batchNo
        );

        if (availableQty < qty) {
          setFeedback({
            type: "error",
            text: `Insufficient stock: "${drugName}" at "${fromName}" has ${availableQty} unit(s). Cannot subtract ${qty}.`,
          });
          setSubmitting(false);
          return;
        }

        await subtractInventoryQuantity({
          pharmacyId: fromPharmacyId,
          pharmacyName: fromName,
          drugCode,
          quantity: qty,
          batchNo,
        });

        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Issue",
            drugName,
            quantity: qty,
            fromName,
            toName: null,
            batchNo,
            expiryDate,
            referenceNo,
            notes,
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else if (movementType === "Receive") {
        await addInventoryQuantity({
          pharmacyId: toPharmacyId,
          pharmacyName: toName,
          drugCode,
          quantity: qty,
          batchNo,
          expiryDate,
          unitType,
        });

        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Receive",
            drugName,
            quantity: qty,
            fromName: null,
            toName,
            batchNo,
            expiryDate,
            referenceNo,
            notes,
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else if (isTransferType) {
        const availableQty = await getAvailableInventoryQuantity(
          fromPharmacyId,
          drugCode,
          batchNo
        );

        if (availableQty < qty) {
          setFeedback({
            type: "error",
            text: `Insufficient stock: "${drugName}" at "${fromName}" has ${availableQty} unit(s). Cannot transfer ${qty}.`,
          });
          setSubmitting(false);
          return;
        }

        await subtractInventoryQuantity({
          pharmacyId: fromPharmacyId,
          pharmacyName: fromName,
          drugCode,
          quantity: qty,
          batchNo,
        });

        await addInventoryQuantity({
          pharmacyId: toPharmacyId,
          pharmacyName: toName,
          drugCode,
          quantity: qty,
          batchNo,
          expiryDate,
          unitType,
        });

        const transferNoteBase = notes ? `${notes}` : "";
        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Transfer Out",
            drugName,
            quantity: qty,
            fromName,
            toName,
            batchNo,
            expiryDate,
            referenceNo,
            notes: transferNoteBase || "Auto-generated transfer out entry",
          }),
          buildMovementPayload({
            movementType: "Transfer In",
            drugName,
            quantity: qty,
            fromName,
            toName,
            batchNo,
            expiryDate,
            referenceNo,
            notes: transferNoteBase || "Auto-generated transfer in entry",
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else if (movementType === "Adjustment+") {
        const targetPharmacyId = toPharmacyId || fromPharmacyId;
        const targetPharmacyName = targetPharmacyId
          ? getPharmacyNameById(targetPharmacyId)
          : null;

        await addInventoryQuantity({
          pharmacyId: targetPharmacyId,
          pharmacyName: targetPharmacyName,
          drugCode,
          quantity: qty,
          batchNo,
          expiryDate,
          unitType,
        });

        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Adjustment+",
            drugName,
            quantity: qty,
            fromName: fromPharmacyId ? getPharmacyNameById(fromPharmacyId) : null,
            toName: toPharmacyId ? getPharmacyNameById(toPharmacyId) : null,
            batchNo,
            expiryDate,
            referenceNo,
            notes,
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else if (movementType === "Adjustment-") {
        const targetPharmacyId = fromPharmacyId || toPharmacyId;
        const targetPharmacyName = targetPharmacyId
          ? getPharmacyNameById(targetPharmacyId)
          : null;

        const availableQty = await getAvailableInventoryQuantity(
          targetPharmacyId,
          drugCode,
          batchNo
        );

        if (availableQty < qty) {
          setFeedback({
            type: "error",
            text: `Insufficient stock: "${drugName}" at "${targetPharmacyName}" has ${availableQty} unit(s). Cannot subtract ${qty}.`,
          });
          setSubmitting(false);
          return;
        }

        await subtractInventoryQuantity({
          pharmacyId: targetPharmacyId,
          pharmacyName: targetPharmacyName,
          drugCode,
          quantity: qty,
          batchNo,
        });

        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Adjustment-",
            drugName,
            quantity: qty,
            fromName: fromPharmacyId ? getPharmacyNameById(fromPharmacyId) : null,
            toName: toPharmacyId ? getPharmacyNameById(toPharmacyId) : null,
            batchNo,
            expiryDate,
            referenceNo,
            notes,
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else if (movementType === "Return") {
        const targetPharmacyId = toPharmacyId || fromPharmacyId;
        const targetPharmacyName = targetPharmacyId
          ? getPharmacyNameById(targetPharmacyId)
          : null;

        await addInventoryQuantity({
          pharmacyId: targetPharmacyId,
          pharmacyName: targetPharmacyName,
          drugCode,
          quantity: qty,
          batchNo,
          expiryDate,
          unitType,
        });

        const insertedRows = await insertMovementRows([
          buildMovementPayload({
            movementType: "Return",
            drugName,
            quantity: qty,
            fromName: fromPharmacyId ? getPharmacyNameById(fromPharmacyId) : null,
            toName: toPharmacyId ? getPharmacyNameById(toPharmacyId) : null,
            batchNo,
            expiryDate,
            referenceNo,
            notes,
          }),
        ]);

        setRows((prev) => [...insertedRows, ...prev]);
      } else {
        setFeedback({
          type: "error",
          text: "Unsupported movement type.",
        });
        setSubmitting(false);
        return;
      }

      setFormData(initialForm);
      setSelectedDrugOption(null);
      setShowDrugDropdown(false);
      clearStockMovementDraft();

      setFeedback({
        type: "success",
        text: "Stock movement added and inventory updated successfully.",
      });

      const refreshIds = [fromPharmacyId, toPharmacyId].filter(Boolean);
      refreshIds.forEach((id) => emitInventoryUpdated(id));
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
        <p style={subtitle}>
          Record, track, and review pharmacy stock movement activity.
        </p>
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

      {feedback.text ? (
        <div style={{ ...feedbackBox, ...feedbackStyle }}>{feedback.text}</div>
      ) : null}

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

            <div style={{ ...fieldGroup, position: "relative" }}>
              <label style={fieldLabel}>Drug Name</label>
              <input
                ref={drugInputRef}
                name="drug_name"
                value={formData.drug_name}
                onChange={handleDrugInputChange}
                onFocus={() => setShowDrugDropdown(true)}
                onBlur={handleDrugInputBlur}
                style={inputStyle}
                required
                placeholder={
                  drugOptions.length === 0
                    ? "No drug options available"
                    : "Search and select drug"
                }
                autoComplete="off"
              />

              {showDrugDropdown && formData.drug_name.trim() ? (
                <div style={drugDropdown}>
                  {filteredDrugOptions.length > 0 ? (
                    filteredDrugOptions.map((option) => (
                      <div
                        key={`${option.displayLabel}::${option.drug_code}`}
                        style={drugDropdownItem}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          selectDrugName(option);
                        }}
                      >
                        <div style={drugDropdownTitle}>{option.display_name}</div>
                        <div style={drugDropdownMeta}>
                          <span>Code: {option.drug_code || "-"}</span>
                          <span>Pack: {option.package_size || "-"}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={drugDropdownEmpty}>No matching drugs found</div>
                  )}
                </div>
              ) : null}

              {selectedDrugOption ? (
                <div style={selectedDrugCard}>
                  <div style={selectedDrugTitle}>
                    {selectedDrugOption.display_name}
                  </div>

                  <div style={selectedDrugMetaGrid}>
                    <div>
                      <div style={selectedDrugMetaLabel}>Drug Code</div>
                      <div style={selectedDrugMetaValue}>
                        {selectedDrugOption.drug_code || "-"}
                      </div>
                    </div>

                    <div>
                      <div style={selectedDrugMetaLabel}>Package Size</div>
                      <div style={selectedDrugMetaValue}>
                        {selectedDrugOption.package_size || "-"}
                      </div>
                    </div>

                    <div>
                      <div style={selectedDrugMetaLabel}>Price to Pharmacy</div>
                      <div style={selectedDrugMetaValue}>
                        {formatPriceDisplay(selectedDrugOption.price_to_pharmacy)}
                      </div>
                    </div>

                    <div>
                      <div style={selectedDrugMetaLabel}>Price to Public</div>
                      <div style={selectedDrugMetaValue}>
                        {formatPriceDisplay(selectedDrugOption.price_to_public)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity</label>
              <input
                type="number"
                min="1"
                step="1"
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
                <option value="">
                  Select from pharmacy{isTransferType ? "" : " (optional)"}
                </option>
                {pharmacyOptions
                  .filter(
                    (option) =>
                      !(
                        isTransferType &&
                        formData.to_pharmacy &&
                        option.id === formData.to_pharmacy
                      )
                  )
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name || "Unknown Pharmacy"}
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
                <option value="">
                  Select to pharmacy{isTransferType ? "" : " (optional)"}
                </option>
                {pharmacyOptions
                  .filter(
                    (option) =>
                      !(
                        isTransferType &&
                        formData.from_pharmacy &&
                        option.id === formData.from_pharmacy
                      )
                  )
                  .map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name || "Unknown Pharmacy"}
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

const drugDropdown = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  boxShadow: "0 10px 24px rgba(15,23,42,0.10)",
  maxHeight: "240px",
  overflowY: "auto",
  zIndex: 50,
};

const drugDropdownItem = {
  padding: "10px 12px",
  cursor: "pointer",
  borderBottom: "1px solid #f1f5f9",
  background: "#ffffff",
};

const drugDropdownTitle = {
  fontSize: "14px",
  color: "#0f172a",
  fontWeight: 700,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  lineHeight: 1.45,
};

const drugDropdownMeta = {
  marginTop: "4px",
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  fontSize: "12px",
  color: "#64748b",
};

const drugDropdownEmpty = {
  padding: "10px 12px",
  fontSize: "13px",
  color: "#64748b",
  background: "#ffffff",
};

const selectedDrugCard = {
  marginTop: "10px",
  border: "1px solid #dbe7f5",
  borderRadius: "10px",
  padding: "10px 12px",
  background: "#f8fbff",
};

const selectedDrugTitle = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#0f172a",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  lineHeight: 1.45,
};

const selectedDrugMetaGrid = {
  marginTop: "8px",
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px 12px",
};

const selectedDrugMetaLabel = {
  fontSize: "10px",
  color: "#64748b",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const selectedDrugMetaValue = {
  marginTop: "2px",
  fontSize: "13px",
  color: "#0f172a",
  fontWeight: 600,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
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