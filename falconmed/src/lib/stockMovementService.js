import { supabase } from "./supabaseClient";

const MOVEMENT_TYPES = [
  "Receive",
  "Dispense",
  "Adjustment Remove",
  "Transfer Out",
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeOptional(value) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function normalizeNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function insertMovementRow(payload) {
  const runInsert = async (value) =>
    supabase
      .from("stock_movements")
      .insert([value])
      .select("*")
      .single();

  let movementInsert = await runInsert(payload);

  if (movementInsert.error) {
    const message = String(movementInsert.error.message || "").toLowerCase();
    let fallbackPayload = { ...payload };
    let changed = false;

    if (message.includes("created_by") && message.includes("column")) {
      const { created_by, ...nextPayload } = fallbackPayload;
      fallbackPayload = nextPayload;
      changed = true;
    }

    if (message.includes("barcode") && message.includes("column")) {
      const { barcode, ...nextPayload } = fallbackPayload;
      fallbackPayload = nextPayload;
      changed = true;
    }

    if (changed) {
      movementInsert = await runInsert(fallbackPayload);
    }
  }

  if (movementInsert.error) {
    throw new Error(movementInsert.error.message || "Failed to insert stock movement.");
  }

  return movementInsert.data;
}

async function getInventoryRows(pharmacyId, drugName) {
  const { data, error } = await supabase
    .from("pharmacy_inventory")
    .select("id, pharmacy_id, drug_name, quantity, batch_no, expiry_date, barcode, unit_cost")
    .eq("pharmacy_id", pharmacyId)
    .eq("drug_name", drugName)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .limit(500);

  if (error) {
    throw new Error(`Inventory lookup failed: ${error.message}`);
  }

  return data || [];
}

async function getInventoryRowById(rowId) {
  const { data, error } = await supabase
    .from("pharmacy_inventory")
    .select("id, pharmacy_id, drug_name, quantity, batch_no, expiry_date, barcode, unit_cost")
    .eq("id", rowId)
    .limit(1);

  if (error) {
    throw new Error(`Inventory lookup failed: ${error.message}`);
  }

  return data?.[0] || null;
}

async function subtractFromInventoryRow({ inventoryRowId, quantity, pharmacyName, drugName }) {
  const row = await getInventoryRowById(inventoryRowId);

  if (!row) {
    throw new Error("Selected source inventory row no longer exists.");
  }

  const currentQty = Number(row.quantity || 0);
  const nextQty = currentQty - quantity;

  if (nextQty < 0) {
    throw new Error(
      `Insufficient stock at \"${pharmacyName}\": available ${currentQty}, requested ${quantity}.`
    );
  }

  const { error } = await supabase
    .from("pharmacy_inventory")
    .update({ quantity: nextQty })
    .eq("id", row.id);

  if (error) {
    throw new Error(`Inventory update failed: ${error.message}`);
  }

  return {
    ...row,
    quantity: nextQty,
    drug_name: drugName || row.drug_name,
  };
}

async function addToInventoryRow({
  pharmacyId,
  drugName,
  quantity,
  batchNo,
  expiryDate,
  barcode,
  unitCost,
}) {
  const unitCostValue = normalizeNumeric(unitCost);

  let query = supabase
    .from("pharmacy_inventory")
    .select("id, quantity")
    .eq("pharmacy_id", pharmacyId)
    .eq("drug_name", drugName);

  if (batchNo) {
    query = query.eq("batch_no", batchNo);
  } else {
    query = query.is("batch_no", null);
  }

  if (expiryDate) {
    query = query.eq("expiry_date", expiryDate);
  } else {
    query = query.is("expiry_date", null);
  }

  if (barcode) {
    query = query.eq("barcode", barcode);
  }

  const { data: existingRows, error: existingError } = await query.limit(1);
  if (existingError) {
    throw new Error(`Inventory lookup failed: ${existingError.message}`);
  }

  const existing = existingRows?.[0] || null;

  if (existing) {
    const nextQty = Number(existing.quantity || 0) + quantity;
    const updatePayload = { quantity: nextQty };
    if (unitCostValue != null) {
      updatePayload.unit_cost = unitCostValue;
    }

    const { error } = await supabase
      .from("pharmacy_inventory")
      .update(updatePayload)
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Inventory update failed: ${error.message}`);
    }

    return;
  }

  const insertPayload = {
    pharmacy_id: pharmacyId,
    drug_name: drugName,
    quantity,
    batch_no: batchNo || null,
    expiry_date: expiryDate || null,
    barcode: barcode || null,
    unit_cost: unitCostValue || 0,
  };

  const { error } = await supabase.from("pharmacy_inventory").insert([insertPayload]);
  if (error) {
    throw new Error(`Inventory insert failed: ${error.message}`);
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function requireValidQuantity(quantity) {
  const qty = toNumber(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
  return qty;
}

function validateTransfer(fromPharmacyId, toPharmacyId) {
  if (!fromPharmacyId || !toPharmacyId) {
    throw new Error("Both source and destination pharmacies are required for transfers.");
  }

  if (fromPharmacyId === toPharmacyId) {
    throw new Error("Source and destination pharmacies must be different.");
  }
}

export async function fetchStockMovementOptions() {
  if (!supabase) {
    return {
      pharmacies: [],
    };
  }

  const { data, error } = await supabase
    .from("pharmacies")
    .select("id, name, location")
    .order("name", { ascending: true });

  if (error) {
    return { pharmacies: [] };
  }

  const pharmacies = (data || [])
    .map((item) => ({
      id: cleanString(item?.id),
      name: cleanString(item?.name) || "Unknown Pharmacy",
      location: cleanString(item?.location),
    }))
    .filter((item) => Boolean(item.id))
    .filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index);

  return { pharmacies };
}

export async function fetchInventoryRowsByPharmacy(pharmacyId, searchTerm = "", limit = 80) {
  requireSupabase();

  const id = cleanString(pharmacyId);
  if (!id) return [];

  const q = cleanString(searchTerm).toLowerCase();
  const cap = Math.max(10, Math.min(Number(limit) || 80, 200));

  const { data, error } = await supabase
    .from("pharmacy_inventory")
    .select("id, pharmacy_id, drug_name, quantity, batch_no, expiry_date, barcode, unit_cost")
    .eq("pharmacy_id", id)
    .gt("quantity", 0)
    .order("drug_name", { ascending: true })
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (error) {
    throw new Error(`Failed to load source inventory rows: ${error.message}`);
  }

  const rows = (data || []).filter((row) => {
    if (!q) return true;
    const haystack = [
      cleanString(row?.drug_name),
      cleanString(row?.batch_no),
      cleanString(row?.barcode),
      cleanString(row?.expiry_date),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return rows.slice(0, cap);
}

export async function fetchRecentStockMovements(limit = 50) {
  if (!supabase) return [];

  const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id, movement_type, drug_name, quantity, from_pharmacy, to_pharmacy, batch_no, expiry_date, reference_no, notes, created_at, created_by")
    .order("created_at", { ascending: false })
    .limit(cap);

  if (error) {
    throw new Error(`Failed to load stock movements: ${error.message}`);
  }

  return data || [];
}

export async function fetchInventoryBalance(pharmacyId, drugName) {
  requireSupabase();

  const pharmacy = cleanString(pharmacyId);
  const drug = cleanString(drugName);

  if (!pharmacy || !drug) {
    return 0;
  }

  const rows = await getInventoryRows(pharmacy, drug);
  return rows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
}

export async function postStockMovement(input) {
  requireSupabase();

  const movementType = cleanString(input?.movementType);
  const drugName = cleanString(input?.drugName);
  const quantity = requireValidQuantity(input?.quantity);

  const fromPharmacyId = cleanString(input?.fromPharmacyId);
  const toPharmacyId = cleanString(input?.toPharmacyId);
  const fromPharmacyName = cleanString(input?.fromPharmacyName);
  const toPharmacyName = cleanString(input?.toPharmacyName);
  const sourceInventoryRowId = cleanString(input?.sourceInventoryRowId);
  const sourceInventoryRow = input?.sourceInventoryRow || null;

  const batchNo = normalizeOptional(input?.batchNo);
  const expiryDate = normalizeOptional(input?.expiryDate);
  const barcode = normalizeOptional(input?.barcode);
  const unitCost = normalizeNumeric(input?.unitCost);
  const referenceNo = normalizeOptional(input?.referenceNo);
  const notes = normalizeOptional(input?.notes);
  const createdBy = normalizeOptional(input?.createdBy) || "falconmed.v1@system";

  const nowIso = new Date().toISOString();

  if (!MOVEMENT_TYPES.includes(movementType)) {
    throw new Error("Unsupported movement type.");
  }

  const derivedDrug = drugName || cleanString(sourceInventoryRow?.drug_name);
  const derivedBatch = batchNo || normalizeOptional(sourceInventoryRow?.batch_no);
  const derivedExpiry = expiryDate || normalizeOptional(sourceInventoryRow?.expiry_date);
  const derivedBarcode = barcode || normalizeOptional(sourceInventoryRow?.barcode);
  const effectiveDrugName = derivedDrug;

  if (!effectiveDrugName) {
    throw new Error("Drug name is required.");
  }

  if (movementType === "Receive") {
    if (!toPharmacyId || !toPharmacyName) {
      throw new Error("Destination pharmacy is required for Receive movements.");
    }

    const record = await insertMovementRow({
      movement_type: "Receive",
      drug_name: effectiveDrugName,
      quantity,
      from_pharmacy: fromPharmacyName || null,
      to_pharmacy: toPharmacyName,
      batch_no: derivedBatch,
      expiry_date: derivedExpiry,
      barcode: derivedBarcode,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await addToInventoryRow({
      pharmacyId: toPharmacyId,
      drugName: effectiveDrugName,
      quantity,
      batchNo: derivedBatch,
      expiryDate: derivedExpiry,
      barcode: derivedBarcode,
      unitCost,
    });

    return { records: [record], emittedPharmacyId: toPharmacyId };
  }

  if (movementType === "Dispense" || movementType === "Adjustment Remove" || movementType === "Transfer Out") {
    if (!fromPharmacyId || !fromPharmacyName) {
      throw new Error("Source pharmacy is required for this movement.");
    }

    const isTransferOut = movementType === "Transfer Out";
    if (isTransferOut) {
      validateTransfer(fromPharmacyId, toPharmacyId);
      if (!toPharmacyName) {
        throw new Error("Destination pharmacy is required for Transfer Out movements.");
      }
    }

    if (!sourceInventoryRowId) {
      throw new Error("Select a source inventory row before posting this movement.");
    }

    const sourceRow = await getInventoryRowById(sourceInventoryRowId);
    if (!sourceRow) {
      throw new Error("Selected source inventory row no longer exists.");
    }

    if (cleanString(sourceRow.pharmacy_id) !== fromPharmacyId) {
      throw new Error("Selected source row does not belong to the selected source pharmacy.");
    }

    const sourceQty = Number(sourceRow.quantity || 0);
    if (sourceQty - quantity < 0) {
      throw new Error(
        `Insufficient stock at \"${fromPharmacyName}\": available ${sourceQty}, requested ${quantity}.`
      );
    }

    const dbMovementType =
      movementType === "Dispense"
        ? "Issue"
        : movementType === "Adjustment Remove"
          ? "Adjustment-"
          : "Transfer Out";

    const record = await insertMovementRow({
      movement_type: dbMovementType,
      drug_name: effectiveDrugName,
      quantity,
      from_pharmacy: fromPharmacyName,
      to_pharmacy: isTransferOut ? toPharmacyName : null,
      batch_no: derivedBatch,
      expiry_date: derivedExpiry,
      barcode: derivedBarcode,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await subtractFromInventoryRow({
      inventoryRowId: sourceInventoryRowId,
      quantity,
      pharmacyName: fromPharmacyName,
      drugName: effectiveDrugName,
    });

    if (isTransferOut) {
      await addToInventoryRow({
        pharmacyId: toPharmacyId,
        drugName: effectiveDrugName,
        quantity,
        batchNo: derivedBatch,
        expiryDate: derivedExpiry,
        barcode: derivedBarcode,
        unitCost: unitCost ?? sourceRow?.unit_cost,
      });
    }

    return {
      records: [record],
      emittedPharmacyId: isTransferOut ? toPharmacyId : fromPharmacyId,
    };
  }

  throw new Error("Unsupported movement type.");
}

export function getStockMovementTypes() {
  return [...MOVEMENT_TYPES];
}
