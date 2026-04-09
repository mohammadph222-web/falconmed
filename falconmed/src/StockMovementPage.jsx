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
import { supabase } from "./lib/supabaseClient";
import { emitInventoryUpdated } from "./utils/inventoryEvents";
import { getDrugByCode } from "./utils/drugLookup";

const STOCK_MOVEMENT_V1_DRAFT_KEY = "falconmed_stock_movement_v2_draft";
const DRAFT_WRITE_DEBOUNCE_MS = 220;

const initialForm = {
  movementType: "Receive",
  sourcePharmacyId: "",
  destinationPharmacyId: "",
  drugName: "",
  quantity: "",
  quantityMode: "unit",
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
    window.sessionStorage.setItem(
      STOCK_MOVEMENT_V1_DRAFT_KEY,
      JSON.stringify(value)
    );
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
      color: "#065f46",
      background: "#ecfdf5",
      border: "1px solid #a7f3d0",
      boxShadow: "inset 4px 0 0 #10b981",
    };
  }

  return {
    color: "#9a3412",
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    boxShadow: "inset 4px 0 0 #ea580c",
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(4) : "0.0000";
}

function buildDrugDisplayName(drug) {
  const explicit = normalizeText(drug?.display_name);
  if (explicit) return explicit;

  const brandName = normalizeText(drug?.brand_name || drug?.drug_name);
  const strength = normalizeText(drug?.strength);
  const dosageForm = normalizeText(drug?.dosage_form);

  return [brandName, strength, dosageForm].filter(Boolean).join(" ").trim();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return "";
}

function resolvePackLabel(source) {
  return firstNonEmpty(
    source?.normalized_pack_size,
    source?.package_size,
    source?.pack_size,
    source?.pack_description,
    source?.stock_unit,
    source?.unit
  );
}

function extractPackSizeValue(source) {
  const directCandidates = [
    source?.pack_size_value,
    source?.pack_size,
    source?.normalized_pack_size_value,
    source?.normalized_pack_size,
    source?.outer_pack_count,
    source?.inner_pack_count,
  ];

  for (const candidate of directCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }
  }

  const label = resolvePackLabel(source);
  if (!label) return 1;

  const match = String(label).match(/(\d+(?:\.\d+)?)/);
  if (!match) return 1;

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;

  return Math.floor(parsed);
}

function resolveUnitCostPerBaseUnit(source) {
  const directUnitCost = [
    source?.unit_cost,
    source?.unit_price_pharmacy,
    source?.price_to_pharmacy,
    source?.pharmacy_price,
  ];

  for (const candidate of directUnitCost) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return 0;
}

function resolvePublicPricePerBaseUnit(source) {
  const candidates = [
    source?.price_to_public,
    source?.unit_price_public,
    source?.public_price,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return numeric;
    }
  }

  return 0;
}

function enrichDrug(source) {
  const displayName = buildDrugDisplayName(source);
  const packLabel = resolvePackLabel(source);
  const packSize = extractPackSizeValue(source);
  const unitCostPerBaseUnit = resolveUnitCostPerBaseUnit(source);
  const publicPricePerBaseUnit = resolvePublicPricePerBaseUnit(source);

  return {
    ...source,
    display_name: displayName,
    pack_label: packLabel || `${packSize} units`,
    pack_size_value: packSize,
    unit_cost_per_base_unit: unitCostPerBaseUnit,
    public_price_per_base_unit: publicPricePerBaseUnit,
  };
}

function enrichInventoryRow(row) {
  const packLabel = resolvePackLabel(row);
  const packSize = extractPackSizeValue(row);
  const unitCostPerBaseUnit = resolveUnitCostPerBaseUnit(row);

  return {
    ...row,
    pack_label: packLabel || `${packSize} units`,
    pack_size_value: packSize,
    unit_cost_per_base_unit: unitCostPerBaseUnit,
  };
}

function pluralizeUnit(count) {
  return Number(count) === 1 ? "unit" : "units";
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

  const [quickBarcode, setQuickBarcode] = useState("");
  const [quickQuantity, setQuickQuantity] = useState(1);
  const [quickQuantityMode, setQuickQuantityMode] = useState("unit");
  const [quickPharmacyId, setQuickPharmacyId] = useState("");
  const [quickResolved, setQuickResolved] = useState(null);
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickFeedback, setQuickFeedback] = useState({ type: "", text: "" });

  const [lookupDrugCode, setLookupDrugCode] = useState("");
  const [debouncedLookupDrugCode, setDebouncedLookupDrugCode] = useState("");
  const [lookupDrugMeta, setLookupDrugMeta] = useState(null);
  const [lookupDrugMessage, setLookupDrugMessage] = useState("");

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
    form.movementType === "Adjustment Remove" ||
    form.movementType === "Transfer Out";

  const activePackSize = useMemo(() => {
    if (isReceive && selectedDrug) return selectedDrug.pack_size_value || 1;
    if (!isReceive && selectedSourceRow) return selectedSourceRow.pack_size_value || 1;
    return 1;
  }, [isReceive, selectedDrug, selectedSourceRow]);

  const activePackLabel = useMemo(() => {
    if (isReceive && selectedDrug) return selectedDrug.pack_label || `${activePackSize} units`;
    if (!isReceive && selectedSourceRow) return selectedSourceRow.pack_label || `${activePackSize} units`;
    return `${activePackSize} units`;
  }, [isReceive, selectedDrug, selectedSourceRow, activePackSize]);

  const enteredQuantity = useMemo(() => {
    const value = Math.floor(safeNumber(form.quantity));
    return value > 0 ? value : 0;
  }, [form.quantity]);

  const inventoryQuantity = useMemo(() => {
    if (enteredQuantity <= 0) return 0;
    if (form.quantityMode === "pack") {
      return enteredQuantity * Math.max(1, activePackSize);
    }
    return enteredQuantity;
  }, [enteredQuantity, form.quantityMode, activePackSize]);

  const availableBaseUnits = useMemo(() => {
    if (!selectedSourceRow) return 0;
    return Math.max(0, Math.floor(safeNumber(selectedSourceRow.quantity)));
  }, [selectedSourceRow]);

  const availablePacks = useMemo(() => {
    if (!selectedSourceRow) return 0;
    return Math.floor(availableBaseUnits / Math.max(1, activePackSize));
  }, [selectedSourceRow, availableBaseUnits, activePackSize]);

  const effectiveUnitCost = useMemo(() => {
    const numeric = Number(form.unitCost);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;

    if (isReceive && selectedDrug) return selectedDrug.unit_cost_per_base_unit || 0;
    if (!isReceive && selectedSourceRow) return selectedSourceRow.unit_cost_per_base_unit || 0;

    return 0;
  }, [form.unitCost, isReceive, selectedDrug, selectedSourceRow]);

  const estimatedLineCost = useMemo(() => {
    if (inventoryQuantity <= 0) return 0;
    return inventoryQuantity * effectiveUnitCost;
  }, [inventoryQuantity, effectiveUnitCost]);

  const quickPackSize = useMemo(() => {
    if (!quickResolved) return 1;
    return Math.max(1, quickResolved.pack_size_value || 1);
  }, [quickResolved]);

  const quickPackLabel = useMemo(() => {
    if (!quickResolved) return "1 unit";
    return quickResolved.pack_label || `${quickPackSize} ${pluralizeUnit(quickPackSize)}`;
  }, [quickResolved, quickPackSize]);

  const quickEnteredQuantity = useMemo(() => {
    const n = Math.floor(safeNumber(quickQuantity));
    return n > 0 ? n : 0;
  }, [quickQuantity]);

  const quickInventoryQuantity = useMemo(() => {
    if (quickEnteredQuantity <= 0) return 0;
    if (quickQuantityMode === "pack") {
      return quickEnteredQuantity * Math.max(1, quickPackSize);
    }
    return quickEnteredQuantity;
  }, [quickEnteredQuantity, quickQuantityMode, quickPackSize]);

  const isQuantityOverAvailable =
    isInventoryFirst && enteredQuantity > 0 && inventoryQuantity > availableBaseUnits;

  useEffect(() => {
    const draft = readDraft();
    if (draft?.form && typeof draft.form === "object") {
      setForm((prev) => ({ ...prev, ...draft.form }));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeDraft({ form });
    }, DRAFT_WRITE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [form]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedLookupDrugCode(normalizeText(lookupDrugCode));
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [lookupDrugCode]);

  useEffect(() => {
    let canceled = false;
    const code = normalizeText(debouncedLookupDrugCode);

    if (!code) {
      setLookupDrugMeta(null);
      setLookupDrugMessage("");
      return;
    }

    const run = async () => {
      try {
        const row = await getDrugByCode(code);
        if (canceled) return;

        if (!row) {
          setLookupDrugMeta(null);
          setLookupDrugMessage("Drug code not found");
          if (isReceive) {
            setSelectedDrug(null);
          }
          return;
        }

        const enrichedLookupDrug = enrichDrug({
          ...row,
          drug_name: row.display_name || buildDrugDisplayName(row),
        });

        setLookupDrugMeta(enrichedLookupDrug);
        setLookupDrugMessage("");

        setForm((prev) => ({
          ...prev,
          drugName: enrichedLookupDrug.display_name || prev.drugName,
          unitCost:
            enrichedLookupDrug.unit_cost_per_base_unit !== undefined &&
            enrichedLookupDrug.unit_cost_per_base_unit !== null
              ? String(enrichedLookupDrug.unit_cost_per_base_unit)
              : prev.unitCost,
        }));

        if (isReceive) {
          setSelectedDrug(enrichedLookupDrug);
        }
      } catch {
        if (!canceled) {
          setLookupDrugMeta(null);
          setLookupDrugMessage("Drug code not found");
          if (isReceive) {
            setSelectedDrug(null);
          }
        }
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, [debouncedLookupDrugCode, isReceive]);

  useEffect(() => {
    if (!quickPharmacyId && pharmacies.length > 0) {
      setQuickPharmacyId(pharmacies[0].id || "");
    }
  }, [pharmacies, quickPharmacyId]);

  const loadPage = async () => {
    setLoading(true);
    setFeedback({ type: "", text: "" });

    try {
      const [options, recent] = await Promise.all([
        fetchStockMovementOptions(),
        fetchRecentStockMovements(100),
      ]);

      setPharmacies(options?.pharmacies || []);
      setRows(recent || []);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error?.message || "Failed to load stock movement data.",
      });
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadPage();
  }, []);

  const resetLookupState = () => {
    setLookupDrugCode("");
    setDebouncedLookupDrugCode("");
    setLookupDrugMeta(null);
    setLookupDrugMessage("");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => {
      const next = { ...prev, [name]: value };

      if (name === "movementType") {
        next.sourcePharmacyId = "";
        next.destinationPharmacyId = "";
        next.drugName = "";
        next.quantity = "";
        next.quantityMode = "unit";
        next.batchNo = "";
        next.expiryDate = "";
        next.barcode = "";
        next.unitCost = "";
      }

      if (name === "sourcePharmacyId") {
        next.drugName = "";
        next.quantity = "";
        next.quantityMode = "unit";
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
      resetLookupState();
    }
  };

  const setFormQuantityMode = (mode) => {
    setForm((prev) => ({
      ...prev,
      quantityMode: mode,
      quantity: "",
    }));
  };

  const chooseMasterDrug = (drug) => {
    const enrichedDrug = enrichDrug(drug);

    setSelectedDrug(enrichedDrug);
    setSelectedSourceRow(null);
    setLookupDrugCode(normalizeText(enrichedDrug.drug_code));
    setLookupDrugMeta(enrichedDrug);
    setLookupDrugMessage("");

    setForm((prev) => ({
      ...prev,
      drugName: enrichedDrug.display_name,
      barcode: drug?.barcode || "",
      unitCost:
        enrichedDrug.unit_cost_per_base_unit > 0
          ? String(enrichedDrug.unit_cost_per_base_unit)
          : "",
      quantityMode: enrichedDrug.pack_size_value > 1 ? "pack" : "unit",
      quantity: "",
    }));
  };

  const chooseSourceRow = (row) => {
    const enrichedRow = enrichInventoryRow(row);

    setSelectedSourceRow(enrichedRow);
    setSelectedDrug(null);
    resetLookupState();

    setForm((prev) => ({
      ...prev,
      drugName: enrichedRow?.drug_name || "",
      batchNo: enrichedRow?.batch_no || "",
      expiryDate: enrichedRow?.expiry_date || "",
      barcode: enrichedRow?.barcode || "",
      unitCost:
        enrichedRow.unit_cost_per_base_unit > 0
          ? String(enrichedRow.unit_cost_per_base_unit)
          : "",
      quantityMode: enrichedRow.pack_size_value > 1 ? "pack" : "unit",
      quantity: "",
    }));
  };

  const resolveQuickBarcode = async (rawBarcode, preferredPharmacyId) => {
    const barcode = normalizeText(rawBarcode);
    if (!barcode) {
      setQuickResolved(null);
      return null;
    }

    if (!supabase) {
      throw new Error("Supabase is not configured for barcode resolution.");
    }

    const { data: masterRows, error: masterError } = await supabase
      .from("drug_master")
      .select("*")
      .eq("barcode", barcode)
      .limit(1);

    if (masterError) {
      throw new Error(masterError.message || "Failed to search barcode in drug master.");
    }

    if (Array.isArray(masterRows) && masterRows.length > 0) {
      const enriched = enrichDrug(masterRows[0]);
      const resolved = {
        source: "drug_master",
        barcode,
        drug_name: enriched.display_name || normalizeText(masterRows[0]?.drug_name),
        drug_code: normalizeText(masterRows[0]?.drug_code),
        pack_label: enriched.pack_label,
        pack_size_value: enriched.pack_size_value,
        unit_cost_per_base_unit: enriched.unit_cost_per_base_unit || 0,
        public_price_per_base_unit: enriched.public_price_per_base_unit || 0,
      };
      setQuickResolved(resolved);
      return resolved;
    }

    let inventoryQuery = supabase
      .from("pharmacy_inventory")
      .select("id,pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
      .eq("barcode", barcode)
      .order("quantity", { ascending: false })
      .limit(1);

    const preferredPharmacy = normalizeText(preferredPharmacyId);
    if (preferredPharmacy) {
      inventoryQuery = inventoryQuery.eq("pharmacy_id", preferredPharmacy);
    }

    const { data: inventoryRows, error: inventoryError } = await inventoryQuery;

    if (inventoryError) {
      throw new Error(inventoryError.message || "Failed to search barcode in inventory.");
    }

    if (Array.isArray(inventoryRows) && inventoryRows.length > 0) {
      const row = enrichInventoryRow(inventoryRows[0]);
      const resolved = {
        source: "pharmacy_inventory",
        barcode,
        drug_name: normalizeText(row?.drug_name),
        drug_code: "",
        pack_label: row.pack_label,
        pack_size_value: row.pack_size_value,
        unit_cost_per_base_unit: row.unit_cost_per_base_unit || 0,
        public_price_per_base_unit: 0,
      };
      setQuickResolved(resolved);
      return resolved;
    }

    setQuickResolved(null);
    throw new Error("Barcode not found in drug master or pharmacy inventory.");
  };

  const handleQuickReceive = async () => {
    setQuickSubmitting(true);
    setQuickFeedback({ type: "", text: "" });

    try {
      const pharmacyId = normalizeText(quickPharmacyId);
      const barcode = normalizeText(quickBarcode);
      if (!pharmacyId) throw new Error("Select a pharmacy for quick receive.");
      if (!barcode) throw new Error("Enter a barcode first.");
      if (!quickInventoryQuantity || quickInventoryQuantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }

      const resolved = await resolveQuickBarcode(barcode, pharmacyId);
      const toPharmacy = pharmacyMap.get(pharmacyId);
      if (!toPharmacy?.name) throw new Error("Selected pharmacy is not available.");

      const result = await postStockMovement({
        movementType: "Receive",
        drugName: resolved?.drug_name || "",
        quantity: quickInventoryQuantity,
        toPharmacyId: pharmacyId,
        toPharmacyName: toPharmacy.name,
        barcode,
        unitCost: resolved?.unit_cost_per_base_unit || 0,
        createdBy: user?.email || "falconmed.v1@system",
      });

      const recent = await fetchRecentStockMovements(100);
      setRows(recent || []);
      emitInventoryUpdated(result.emittedPharmacyId || pharmacyId);

      setQuickFeedback({
        type: "success",
        text: `Quick Receive posted: ${quickEnteredQuantity} ${quickQuantityMode}${quickEnteredQuantity === 1 ? "" : "s"} = ${quickInventoryQuantity} ${pluralizeUnit(quickInventoryQuantity)}.`,
      });
    } catch (error) {
      setQuickFeedback({
        type: "error",
        text: error?.message || "Quick Receive failed.",
      });
    }

    setQuickSubmitting(false);
  };

  const handleQuickDispense = async () => {
    setQuickSubmitting(true);
    setQuickFeedback({ type: "", text: "" });

    try {
      const pharmacyId = normalizeText(quickPharmacyId);
      const barcode = normalizeText(quickBarcode);
      if (!pharmacyId) throw new Error("Select a pharmacy for quick dispense.");
      if (!barcode) throw new Error("Enter a barcode first.");
      if (!quickInventoryQuantity || quickInventoryQuantity <= 0) {
        throw new Error("Quantity must be greater than zero.");
      }

      await resolveQuickBarcode(barcode, pharmacyId);

      if (!supabase) {
        throw new Error("Supabase is not configured for quick dispense.");
      }

      const { data: sourceRows, error: sourceError } = await supabase
        .from("pharmacy_inventory")
        .select("id,pharmacy_id,drug_name,quantity,batch_no,expiry_date,barcode,unit_cost")
        .eq("pharmacy_id", pharmacyId)
        .eq("barcode", barcode)
        .gt("quantity", 0)
        .order("expiry_date", { ascending: true, nullsFirst: false })
        .limit(1);

      if (sourceError) {
        throw new Error(sourceError.message || "Failed to resolve inventory row for quick dispense.");
      }

      const sourceRow = sourceRows?.[0] || null;
      if (!sourceRow?.id) {
        throw new Error("No available inventory row found for this barcode in the selected pharmacy.");
      }

      const availableQty = Math.max(0, Math.floor(safeNumber(sourceRow.quantity)));
      if (quickInventoryQuantity > availableQty) {
        throw new Error(
          `Insufficient stock. Available ${availableQty} ${pluralizeUnit(availableQty)}, attempted ${quickInventoryQuantity} ${pluralizeUnit(quickInventoryQuantity)}.`
        );
      }

      const fromPharmacy = pharmacyMap.get(pharmacyId);
      if (!fromPharmacy?.name) throw new Error("Selected pharmacy is not available.");

      const result = await postStockMovement({
        movementType: "Dispense",
        drugName: normalizeText(sourceRow.drug_name),
        quantity: quickInventoryQuantity,
        fromPharmacyId: pharmacyId,
        fromPharmacyName: fromPharmacy.name,
        sourceInventoryRowId: String(sourceRow.id),
        sourceInventoryRow: sourceRow,
        batchNo: sourceRow.batch_no || "",
        expiryDate: sourceRow.expiry_date || "",
        barcode,
        unitCost: sourceRow.unit_cost || 0,
        createdBy: user?.email || "falconmed.v1@system",
      });

      const recent = await fetchRecentStockMovements(100);
      setRows(recent || []);
      emitInventoryUpdated(result.emittedPharmacyId || pharmacyId);

      setQuickFeedback({
        type: "success",
        text: `Quick Dispense posted: ${quickEnteredQuantity} ${quickQuantityMode}${quickEnteredQuantity === 1 ? "" : "s"} = ${quickInventoryQuantity} ${pluralizeUnit(quickInventoryQuantity)}.`,
      });
    } catch (error) {
      setQuickFeedback({
        type: "error",
        text: error?.message || "Quick Dispense failed.",
      });
    }

    setQuickSubmitting(false);
  };

  const resetForm = () => {
    setForm(initialForm);
    setSelectedDrug(null);
    setSelectedSourceRow(null);
    resetLookupState();
    clearDraft();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback({ type: "", text: "" });

    try {
      const fromPharmacy = pharmacyMap.get(form.sourcePharmacyId) || null;
      const toPharmacy = pharmacyMap.get(form.destinationPharmacyId) || null;

      if (isReceive && !selectedDrug) {
        throw new Error("Select a drug from Drug Master Search before recording Receive.");
      }

      if (isInventoryFirst && !selectedSourceRow?.id) {
        throw new Error("Select a source inventory row before posting this movement.");
      }

      if (!inventoryQuantity || inventoryQuantity <= 0) {
        throw new Error("Enter a valid quantity greater than zero.");
      }

      if (isInventoryFirst && inventoryQuantity > availableBaseUnits) {
        throw new Error(
          `Insufficient stock. Available ${availableBaseUnits} ${pluralizeUnit(
            availableBaseUnits
          )}, attempted ${inventoryQuantity} ${pluralizeUnit(inventoryQuantity)}.`
        );
      }

      const result = await postStockMovement({
        movementType: form.movementType,
        drugName: form.drugName,
        quantity: inventoryQuantity,
        fromPharmacyId: form.sourcePharmacyId,
        toPharmacyId: form.destinationPharmacyId,
        fromPharmacyName: fromPharmacy?.name || "",
        toPharmacyName: toPharmacy?.name || "",
        batchNo: form.batchNo,
        expiryDate: form.expiryDate,
        barcode: form.barcode,
        unitCost: effectiveUnitCost,
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
        text: `Movement recorded successfully. Entered ${enteredQuantity} ${form.quantityMode}${
          enteredQuantity === 1 ? "" : "s"
        } = ${inventoryQuantity} ${pluralizeUnit(
          inventoryQuantity
        )} in inventory (${result.records.length} ledger entr${
          result.records.length === 1 ? "y" : "ies"
        }).`,
      });

      emitInventoryUpdated(result.emittedPharmacyId || "");
      resetForm();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error?.message || "Failed to record movement.",
      });
    }

    setSubmitting(false);
  };

  return (
    <div style={pageShell}>
      <div style={pageWrap}>
        <div style={heroCard}>
          <div style={heroEyebrow}>Operations</div>
          <h2 style={heroTitle}>Stock Movement</h2>
          <p style={heroSubtitle}>Manage inventory movements safely and accurately</p>
        </div>

        {feedback.text ? (
          <div style={{ ...feedbackBox, ...getFeedbackStyle(feedback.type) }}>
            {feedback.text}
          </div>
        ) : null}

        <div style={panel}>
          <h3 style={panelTitle}>Quick Barcode Entry</h3>

          <div style={quickGrid}>
            <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
              <label style={fieldLabel}>Barcode Input</label>
              <input
                value={quickBarcode}
                onChange={(event) => {
                  setQuickBarcode(event.target.value);
                  setQuickFeedback({ type: "", text: "" });
                }}
                onBlur={() => {
                  if (normalizeText(quickBarcode)) {
                    void resolveQuickBarcode(quickBarcode, quickPharmacyId).catch(() => {
                      // Keep silent on blur; explicit actions surface feedback.
                    });
                  }
                }}
                style={inputStyle}
                placeholder="Scan or type barcode"
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Pharmacy</label>
              <select
                value={quickPharmacyId}
                onChange={(event) => setQuickPharmacyId(event.target.value)}
                style={inputStyle}
              >
                <option value="">Select pharmacy</option>
                {pharmacies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity Input</label>
              <input
                type="number"
                min="1"
                step="1"
                value={quickQuantity}
                onChange={(event) => setQuickQuantity(event.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={fieldGroup}>
              <label style={fieldLabel}>Quantity Entry Mode</label>
              <div style={modeToggleWrap}>
                <button
                  type="button"
                  style={
                    quickQuantityMode === "unit"
                      ? modeToggleActive
                      : modeToggleButton
                  }
                  onClick={() => setQuickQuantityMode("unit")}
                >
                  Unit
                </button>

                <button
                  type="button"
                  style={
                    quickPackSize <= 1
                      ? modeToggleDisabled
                      : quickQuantityMode === "pack"
                      ? modeToggleActive
                      : modeToggleButton
                  }
                  onClick={() => {
                    if (quickPackSize <= 1) return;
                    setQuickQuantityMode("pack");
                  }}
                  disabled={quickPackSize <= 1}
                >
                  Pack
                </button>
              </div>

              <div style={modeHelperText}>
                {quickPackSize > 1
                  ? `1 pack = ${quickPackSize} ${pluralizeUnit(quickPackSize)}`
                  : "Pack mode unavailable because current item resolves to 1 unit only."}
              </div>
            </div>
          </div>

          {quickResolved ? (
            <div style={quickResolvedCard}>
              <div style={selectedDrugTitle}>{quickResolved.drug_name || "-"}</div>
              <div style={selectedDrugMetaGrid}>
                <div>
                  <div style={selectedDrugMetaLabel}>Found In</div>
                  <div style={selectedDrugMetaValue}>
                    {quickResolved.source === "drug_master"
                      ? "Drug Master"
                      : "Pharmacy Inventory"}
                  </div>
                </div>
                <div>
                  <div style={selectedDrugMetaLabel}>Drug Code</div>
                  <div style={selectedDrugMetaValue}>{quickResolved.drug_code || "-"}</div>
                </div>
                <div>
                  <div style={selectedDrugMetaLabel}>Pack Size</div>
                  <div style={selectedDrugMetaValue}>{quickPackLabel}</div>
                </div>
                <div>
                  <div style={selectedDrugMetaLabel}>Pharmacy Cost / Unit</div>
                  <div style={selectedDrugMetaValue}>
                    AED {formatMoney(quickResolved.unit_cost_per_base_unit || 0)}
                  </div>
                </div>
                <div>
                  <div style={selectedDrugMetaLabel}>Public Price / Unit</div>
                  <div style={selectedDrugMetaValue}>
                    AED {formatMoney(quickResolved.public_price_per_base_unit || 0)}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div style={packIntelligenceCard}>
            <div style={packIntelligenceLine}>
              Pack Size: <strong>{quickPackLabel}</strong>
            </div>
            <div style={packIntelligenceLine}>
              Entered:{" "}
              <strong>
                {quickEnteredQuantity > 0
                  ? `${quickEnteredQuantity} ${quickQuantityMode}${quickEnteredQuantity === 1 ? "" : "s"}`
                  : "-"}
              </strong>
            </div>
            <div style={packIntelligenceLine}>
              Inventory Preview:{" "}
              <strong>
                {quickInventoryQuantity > 0
                  ? `${quickInventoryQuantity} ${pluralizeUnit(quickInventoryQuantity)}`
                  : "-"}
              </strong>
            </div>
          </div>

          {quickFeedback.text ? (
            <div
              style={{
                ...feedbackBox,
                ...getFeedbackStyle(quickFeedback.type),
                marginTop: "10px",
              }}
            >
              {quickFeedback.text}
            </div>
          ) : null}

          <div style={quickActionRow}>
            <button
              type="button"
              onClick={() => {
                void handleQuickReceive();
              }}
              disabled={quickSubmitting || loading}
              style={primaryButton}
            >
              {quickSubmitting ? "Posting..." : "Quick Receive"}
            </button>

            <button
              type="button"
              onClick={() => {
                void handleQuickDispense();
              }}
              disabled={quickSubmitting || loading}
              style={ghostButton}
            >
              Quick Dispense
            </button>
          </div>
        </div>

        <div style={panel}>
          <h3 style={panelTitle}>Record Movement</h3>

          <form onSubmit={handleSubmit}>
            <div style={formStack}>
              <section style={sectionCard}>
                <div style={sectionHeading}>Movement Details</div>
                <div style={sectionGrid}>
                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Movement Type</label>
                    <select
                      name="movementType"
                      value={form.movementType}
                      onChange={handleChange}
                      style={inputStyle}
                    >
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
                      <select
                        name="sourcePharmacyId"
                        value={form.sourcePharmacyId}
                        onChange={handleChange}
                        style={inputStyle}
                        required
                      >
                        <option value="">Select source pharmacy</option>
                        {pharmacies
                          .filter(
                            (item) =>
                              !(form.destinationPharmacyId && item.id === form.destinationPharmacyId)
                          )
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
                      <select
                        name="destinationPharmacyId"
                        value={form.destinationPharmacyId}
                        onChange={handleChange}
                        style={inputStyle}
                        required
                      >
                        <option value="">Select pharmacy</option>
                        {pharmacies.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </section>

              {isReceive ? (
                <section style={sectionCard}>
                  <div style={sectionHeading}>Drug Selection</div>
                  <div style={sectionGrid}>
                    <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                      <label style={fieldLabel}>Drug Master Search</label>
                      <DrugMasterPicker value={selectedDrug} onSelect={chooseMasterDrug} required />
                    </div>

                    {selectedDrug ? (
                      <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                        <div style={selectedDrugCard}>
                          <div style={selectedDrugTitle}>
                            {selectedDrug.display_name || "-"}
                          </div>

                          <div style={selectedDrugMetaGrid}>
                            <div>
                              <div style={selectedDrugMetaLabel}>Drug Code</div>
                              <div style={selectedDrugMetaValue}>
                                {selectedDrug?.drug_code || "-"}
                              </div>
                            </div>

                            <div>
                              <div style={selectedDrugMetaLabel}>Pack Size</div>
                              <div style={selectedDrugMetaValue}>
                                {selectedDrug?.pack_label || "-"}{" "}
                                <span style={mutedInline}>
                                  ({selectedDrug?.pack_size_value || 1}{" "}
                                  {pluralizeUnit(selectedDrug?.pack_size_value || 1)})
                                </span>
                              </div>
                            </div>

                            <div>
                              <div style={selectedDrugMetaLabel}>Pharmacy Cost / Unit</div>
                              <div style={selectedDrugMetaValue}>
                                AED {formatMoney(selectedDrug?.unit_cost_per_base_unit || 0)}
                              </div>
                            </div>

                            <div>
                              <div style={selectedDrugMetaLabel}>Public Price / Unit</div>
                              <div style={selectedDrugMetaValue}>
                                AED {formatMoney(selectedDrug?.public_price_per_base_unit || 0)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section style={sectionCard}>
                <div style={sectionHeading}>Drug Details</div>
                <div style={sectionGrid}>
                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Drug Code</label>
                    <input
                      value={lookupDrugCode}
                      onChange={(event) => setLookupDrugCode(event.target.value)}
                      style={inputStyle}
                      placeholder="Enter drug code for lookup"
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Drug Name</label>
                    <input
                      name="drugName"
                      value={form.drugName}
                      onChange={handleChange}
                      style={inputStyle}
                      required
                      placeholder={
                        isReceive
                          ? "Auto-filled from Drug Master Search"
                          : "Select source row to auto-fill"
                      }
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Batch No</label>
                    <input
                      name="batchNo"
                      value={form.batchNo}
                      onChange={handleChange}
                      style={inputStyle}
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Expiry Date</label>
                    <input
                      type="date"
                      name="expiryDate"
                      value={form.expiryDate}
                      onChange={handleChange}
                      style={inputStyle}
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Barcode</label>
                    <input
                      name="barcode"
                      value={form.barcode}
                      onChange={handleChange}
                      style={inputStyle}
                    />
                  </div>

                  {lookupDrugMessage ? (
                    <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                      <div style={{ ...warningBanner, marginTop: 0 }}>
                        {lookupDrugMessage}
                      </div>
                    </div>
                  ) : null}

                  {lookupDrugMeta ? (
                    <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                      <div style={selectedDrugCard}>
                        <div style={selectedDrugTitle}>
                          {lookupDrugMeta.display_name ||
                            lookupDrugMeta.brand_name ||
                            lookupDrugMeta.generic_name ||
                            "-"}
                        </div>
                        <div style={selectedDrugMetaGrid}>
                          <div>
                            <div style={selectedDrugMetaLabel}>Code</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.drug_code || "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Generic</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.generic_name || "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Strength</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.strength || "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Dosage Form</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.dosage_form || "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Package Size</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.package_size || lookupDrugMeta.pack_label || "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Pharmacy Price</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.pharmacy_price ?? "-"}
                            </div>
                          </div>
                          <div>
                            <div style={selectedDrugMetaLabel}>Public Price</div>
                            <div style={selectedDrugMetaValue}>
                              {lookupDrugMeta.public_price ?? "-"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <section style={sectionCard}>
                <div style={sectionHeading}>Quantity and Pricing</div>
                <div style={sectionGrid}>
                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Quantity Entry Mode</label>

                    <div style={modeToggleWrap}>
                      <button
                        type="button"
                        style={
                          form.quantityMode === "unit"
                            ? modeToggleActive
                            : modeToggleButton
                        }
                        onClick={() => setFormQuantityMode("unit")}
                      >
                        Unit
                      </button>

                      <button
                        type="button"
                        style={
                          activePackSize <= 1
                            ? modeToggleDisabled
                            : form.quantityMode === "pack"
                            ? modeToggleActive
                            : modeToggleButton
                        }
                        onClick={() => {
                          if (activePackSize <= 1) return;
                          setFormQuantityMode("pack");
                        }}
                        disabled={activePackSize <= 1}
                      >
                        Pack
                      </button>
                    </div>

                    <div style={modeHelperText}>
                      {activePackSize > 1
                        ? `1 pack = ${activePackSize} ${pluralizeUnit(activePackSize)}`
                        : "Pack mode unavailable because this drug currently resolves to 1 unit only."}
                    </div>
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>
                      Entered Quantity ({form.quantityMode === "pack" ? "packs" : "units"})
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      name="quantity"
                      value={form.quantity}
                      onChange={handleChange}
                      style={inputStyle}
                      required
                      placeholder={
                        form.quantityMode === "pack" ? "e.g. 2 packs" : "e.g. 20 units"
                      }
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Inventory Quantity Preview</label>
                    <input
                      value={
                        inventoryQuantity > 0
                          ? `${inventoryQuantity} ${pluralizeUnit(inventoryQuantity)}`
                          : "-"
                      }
                      readOnly
                      style={readOnlyInputStyle}
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Pack Size</label>
                    <input
                      value={`${activePackSize} ${pluralizeUnit(activePackSize)}${
                        activePackLabel ? ` • ${activePackLabel}` : ""
                      }`}
                      readOnly
                      style={readOnlyInputStyle}
                    />
                  </div>

                  <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                    <div style={packIntelligenceCard}>
                      <div style={packIntelligenceLine}>
                        Pack Size:{" "}
                        <strong>
                          {activePackLabel || `${activePackSize} ${pluralizeUnit(activePackSize)}`}
                        </strong>
                      </div>
                      <div style={packIntelligenceLine}>
                        Entered:{" "}
                        <strong>
                          {enteredQuantity > 0
                            ? `${enteredQuantity} ${form.quantityMode}${enteredQuantity === 1 ? "" : "s"}`
                            : "-"}
                        </strong>
                      </div>
                      <div style={packIntelligenceLine}>
                        Inventory preview:{" "}
                        <strong>
                          {inventoryQuantity > 0
                            ? `${inventoryQuantity} ${pluralizeUnit(inventoryQuantity)}`
                            : "-"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Unit Cost</label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      name="unitCost"
                      value={form.unitCost}
                      onChange={handleChange}
                      style={inputStyle}
                      placeholder="Auto-filled per inventory unit"
                    />
                  </div>

                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Estimated Line Cost</label>
                    <input
                      value={formatMoney(estimatedLineCost)}
                      readOnly
                      style={readOnlyInputStyle}
                    />
                  </div>
                </div>
              </section>

              <section style={sectionCard}>
                <div style={sectionHeading}>Notes and Reference</div>
                <div style={sectionGrid}>
                  <div style={fieldGroup}>
                    <label style={fieldLabel}>Reference No</label>
                    <input
                      name="referenceNo"
                      value={form.referenceNo}
                      onChange={handleChange}
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ ...fieldGroup, gridColumn: "1 / -1" }}>
                    <label style={fieldLabel}>Notes</label>
                    <textarea
                      name="notes"
                      value={form.notes}
                      onChange={handleChange}
                      style={textareaStyle}
                      rows={3}
                    />
                  </div>
                </div>
              </section>
            </div>

            {isQuantityOverAvailable ? (
              <div style={warningBanner}>
                Quantity exceeds available inventory. Available{" "}
                <strong>{availableBaseUnits}</strong> {pluralizeUnit(availableBaseUnits)}, preview is{" "}
                <strong>{inventoryQuantity}</strong> {pluralizeUnit(inventoryQuantity)}.
              </div>
            ) : null}

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
                <div style={balanceLine}>
                  Selected row: <strong>{selectedSourceRow.drug_name || "-"}</strong>
                </div>
                <div style={balanceLine}>
                  Available stock: <strong>{availableBaseUnits}</strong>{" "}
                  {pluralizeUnit(availableBaseUnits)}
                  {activePackSize > 1 ? (
                    <>
                      {" "}
                      • Approx packs: <strong>{availablePacks}</strong>
                    </>
                  ) : null}
                </div>
                <div style={balanceLine}>
                  Batch: <strong>{selectedSourceRow.batch_no || "-"}</strong> • Expiry:{" "}
                  <strong>{formatExpiry(selectedSourceRow.expiry_date)}</strong> • Barcode:{" "}
                  <strong>{selectedSourceRow.barcode || "-"}</strong>
                </div>
                <div style={balanceLine}>
                  Pack intelligence: <strong>{activePackLabel}</strong> • Posting preview:{" "}
                  <strong>
                    {enteredQuantity > 0
                      ? `${enteredQuantity} ${form.quantityMode}${enteredQuantity === 1 ? "" : "s"} = ${inventoryQuantity} ${pluralizeUnit(inventoryQuantity)}`
                      : "-"}
                  </strong>
                </div>
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
            {loading ? (
              <span style={tableMeta}>Loading...</span>
            ) : (
              <span style={tableMeta}>{rows.length} rows</span>
            )}
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
                    <tr
                      key={row.id || `${row.movement_type}-${row.created_at}-${row.reference_no || "na"}`}
                      className="stock-ledger-row"
                    >
                      <td style={td}>{formatDate(row.created_at)}</td>
                      <td style={td}>{row.movement_type || "-"}</td>
                      <td style={tdDrug}>{row.drug_name || "-"}</td>
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
    </div>
  );
}

const pageShell = {
  background: "#f5f7fb",
  padding: "8px 2px 20px",
};

const pageWrap = {
  display: "grid",
  gap: "20px",
  maxWidth: "1220px",
  margin: "0 auto",
};

const heroCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  borderRadius: "16px",
  padding: "22px 24px 20px",
  color: "#0f172a",
  border: "1px solid #e6edf6",
  boxShadow: "0 10px 20px rgba(15, 23, 42, 0.055)",
};

const heroEyebrow = {
  fontSize: "10.5px",
  textTransform: "uppercase",
  letterSpacing: "0.11em",
  color: "#52637a",
  marginBottom: "8px",
  fontWeight: 700,
};

const heroTitle = {
  margin: 0,
  fontSize: "32px",
  letterSpacing: "-0.02em",
  color: "#0b1220",
  lineHeight: 1.16,
};

const heroSubtitle = {
  marginTop: "10px",
  marginBottom: 0,
  fontSize: "14px",
  color: "#4a5a70",
  lineHeight: 1.6,
  maxWidth: "800px",
};

const feedbackBox = {
  borderRadius: "12px",
  padding: "12px 14px 12px 16px",
  fontSize: "13px",
  fontWeight: 600,
};

const panel = {
  background: "#ffffff",
  border: "1px solid #e3eaf3",
  borderRadius: "16px",
  padding: "20px 20px 18px",
  boxShadow: "0 8px 22px rgba(15, 23, 42, 0.05)",
};

const panelTitle = {
  marginTop: 0,
  marginBottom: "16px",
  fontSize: "19px",
  color: "#0b1220",
  letterSpacing: "-0.01em",
  fontWeight: 700,
};

const formStack = {
  display: "grid",
  gap: "16px",
};

const quickGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const quickResolvedCard = {
  marginTop: "14px",
  border: "1px solid #dbe6f3",
  borderRadius: "14px",
  padding: "14px 15px",
  background: "#fcfdff",
  boxShadow: "0 3px 10px rgba(15, 23, 42, 0.03)",
};

const quickActionRow = {
  marginTop: "14px",
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
};

const sectionCard = {
  border: "1px solid #e3ebf5",
  borderRadius: "14px",
  background: "#fcfdff",
  padding: "15px",
  display: "grid",
  gap: "13px",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
};

const sectionGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const sectionHeading = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.09em",
  color: "#516079",
  fontWeight: 700,
  marginTop: "0",
  paddingTop: "0",
  paddingBottom: "10px",
  borderBottom: "1px solid #e7eef8",
};

const fieldGroup = {
  display: "grid",
  gap: "8px",
};

const fieldLabel = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#4d5d74",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
};

const inputStyle = {
  width: "100%",
  borderRadius: "10px",
  border: "1px solid #d6e0ee",
  background: "#ffffff",
  color: "#0f172a",
  padding: "10px 12px",
  minHeight: "42px",
  fontSize: "13px",
  boxSizing: "border-box",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  transition: "border-color 140ms ease, box-shadow 140ms ease",
};

const readOnlyInputStyle = {
  ...inputStyle,
  background: "#f7fafe",
  color: "#122034",
  fontWeight: 600,
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "96px",
  resize: "vertical",
  paddingTop: "11px",
};

const packIntelligenceCard = {
  border: "1px solid #d9e6f5",
  borderRadius: "12px",
  background: "linear-gradient(180deg, #f8fbff 0%, #f3f8ff 100%)",
  padding: "13px 14px",
  display: "grid",
  gap: "7px",
  color: "#2a3e5b",
  fontSize: "13px",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
};

const packIntelligenceLine = {
  lineHeight: 1.5,
};

const balanceBanner = {
  marginTop: "14px",
  borderRadius: "12px",
  background: "#f4f8ff",
  border: "1px solid #d5e4fb",
  color: "#1e40af",
  padding: "13px 14px",
  fontSize: "13px",
};

const warningBanner = {
  marginTop: "14px",
  borderRadius: "12px",
  background: "#fff7ed",
  border: "1px solid #fed7aa",
  color: "#9a3412",
  boxShadow: "inset 3px 0 0 #ea580c",
  padding: "12px 13px",
  fontSize: "13px",
  lineHeight: 1.45,
};

const balanceLine = {
  marginBottom: "5px",
  lineHeight: 1.45,
};

const inventoryPickerWrap = {
  marginTop: "16px",
  display: "grid",
  gap: "10px",
};

const actionRow = {
  marginTop: "18px",
  display: "flex",
  flexWrap: "wrap",
  gap: "12px",
};

const primaryButton = {
  border: "none",
  borderRadius: "11px",
  padding: "11px 18px",
  minHeight: "42px",
  background: "linear-gradient(135deg, #1e4fcf 0%, #255ccf 100%)",
  color: "#ffffff",
  fontWeight: 700,
  fontSize: "13px",
  letterSpacing: "0.01em",
  cursor: "pointer",
  boxShadow: "0 8px 16px rgba(37, 92, 207, 0.22)",
  transition: "transform 140ms ease, box-shadow 140ms ease",
};

const ghostButton = {
  border: "1px solid #ccd8ea",
  borderRadius: "11px",
  padding: "11px 18px",
  minHeight: "42px",
  background: "#ffffff",
  color: "#233246",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

const modeToggleWrap = {
  display: "flex",
  gap: "8px",
};

const modeToggleButton = {
  flex: 1,
  minHeight: "42px",
  borderRadius: "10px",
  border: "1px solid #d6e0ee",
  background: "#ffffff",
  color: "#233246",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

const modeToggleActive = {
  ...modeToggleButton,
  border: "1px solid #255ccf",
  background: "linear-gradient(135deg, #1e4fcf 0%, #255ccf 100%)",
  color: "#ffffff",
  boxShadow: "0 8px 16px rgba(37, 92, 207, 0.18)",
};

const modeToggleDisabled = {
  ...modeToggleButton,
  background: "#f8fafc",
  color: "#94a3b8",
  border: "1px solid #e2e8f0",
  cursor: "not-allowed",
  boxShadow: "none",
};

const modeHelperText = {
  fontSize: "12px",
  color: "#64748b",
  lineHeight: 1.45,
};

const tableHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "14px",
};

const tableMeta = {
  fontSize: "12px",
  color: "#5b6678",
  fontWeight: 600,
};

const tableWrap = {
  border: "1px solid #e4ebf4",
  borderRadius: "14px",
  overflow: "hidden",
  overflowX: "auto",
  background: "#ffffff",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.8)",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: "960px",
};

const th = {
  borderBottom: "1px solid #dde6f2",
  padding: "12px 12px",
  textAlign: "left",
  fontSize: "11px",
  color: "#566880",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 700,
  background: "#f7fafe",
  whiteSpace: "nowrap",
};

const td = {
  borderBottom: "1px solid #ebf0f7",
  padding: "12px 12px",
  fontSize: "12.75px",
  color: "#0f172a",
  whiteSpace: "normal",
  lineHeight: 1.5,
  background: "#ffffff",
};

const tdDrug = {
  ...td,
  whiteSpace: "normal",
  wordBreak: "break-word",
  minWidth: "280px",
};

const emptyCell = {
  ...td,
  textAlign: "center",
  color: "#64748b",
};

const selectedDrugCard = {
  border: "1px solid #dbe5f2",
  borderRadius: "14px",
  padding: "15px 16px",
  background: "linear-gradient(180deg, #fcfdff 0%, #f8fbff 100%)",
  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.04)",
};

const selectedDrugTitle = {
  fontSize: "17px",
  fontWeight: 700,
  color: "#0c1525",
  whiteSpace: "normal",
  wordBreak: "break-word",
  lineHeight: 1.4,
};

const selectedDrugMetaGrid = {
  marginTop: "13px",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const selectedDrugMetaLabel = {
  fontSize: "10.5px",
  fontWeight: 700,
  color: "#5c6777",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: "5px",
};

const selectedDrugMetaValue = {
  fontSize: "13px",
  color: "#0f1c2f",
  fontWeight: 700,
  whiteSpace: "normal",
  wordBreak: "break-word",
  lineHeight: 1.45,
};

const mutedInline = {
  color: "#64748b",
  fontWeight: 500,
};