import { supabase } from "./supabaseClient";

const MOVEMENT_TYPES = {
  RECEIVE: "Receive",
  ISSUE: "Issue",
  TRANSFER_OUT: "Transfer Out",
  TRANSFER_IN: "Transfer In",
  ADJUSTMENT_PLUS: "Adjustment+",
  ADJUSTMENT_MINUS: "Adjustment-",
  RETURN: "Return",
};

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

async function insertMovementRow(payload) {
  let movementInsert = await supabase
    .from("stock_movements")
    .insert([payload])
    .select("*")
    .single();

  if (movementInsert.error) {
    const message = String(movementInsert.error.message || "").toLowerCase();
    const createdByMissing = message.includes("created_by") && message.includes("column");

    if (createdByMissing) {
      const { created_by, ...fallbackPayload } = payload;
      movementInsert = await supabase
        .from("stock_movements")
        .insert([fallbackPayload])
        .select("*")
        .single();
    }
  }

  if (movementInsert.error) {
    throw new Error(movementInsert.error.message || "Failed to insert stock movement.");
  }

  return movementInsert.data;
}

async function getInventoryRow(pharmacyId, drugName) {
  const { data, error } = await supabase
    .from("pharmacy_inventory")
    .select("id, quantity, batch_no, expiry_date, unit_cost")
    .eq("pharmacy_id", pharmacyId)
    .eq("drug_name", drugName)
    .limit(1);

  if (error) {
    throw new Error(`Inventory lookup failed: ${error.message}`);
  }

  return data?.[0] || null;
}

async function applyInventoryDelta({
  pharmacyId,
  pharmacyName,
  drugName,
  quantity,
  direction,
  batchNo,
  expiryDate,
}) {
  const existing = await getInventoryRow(pharmacyId, drugName);

  if (direction === "subtract") {
    if (!existing) {
      throw new Error(
        `No inventory record found for \"${drugName}\" at \"${pharmacyName}\". Cannot reduce stock.`
      );
    }

    const currentQty = Number(existing.quantity || 0);
    const nextQty = currentQty - quantity;

    if (nextQty < 0) {
      throw new Error(
        `Insufficient stock at \"${pharmacyName}\": available ${currentQty}, requested ${quantity}.`
      );
    }

    const { error } = await supabase
      .from("pharmacy_inventory")
      .update({ quantity: nextQty })
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Inventory update failed: ${error.message}`);
    }

    return;
  }

  if (existing) {
    const currentQty = Number(existing.quantity || 0);
    const { error } = await supabase
      .from("pharmacy_inventory")
      .update({ quantity: currentQty + quantity })
      .eq("id", existing.id);

    if (error) {
      throw new Error(`Inventory update failed: ${error.message}`);
    }

    return;
  }

  const { error } = await supabase.from("pharmacy_inventory").insert([
    {
      pharmacy_id: pharmacyId,
      drug_name: drugName,
      quantity,
      batch_no: batchNo || null,
      expiry_date: expiryDate || null,
      unit_cost: 0,
    },
  ]);

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
      drugs: [],
      pharmacies: [],
    };
  }

  const [drugsResult, pharmaciesResult] = await Promise.all([
    supabase.from("drug_master").select("drug_name").limit(5000),
    supabase.from("pharmacies").select("id, name, location").order("name", { ascending: true }),
  ]);

  const drugs = (drugsResult.data || [])
    .map((item) => cleanString(item?.drug_name))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .sort((left, right) => left.localeCompare(right));

  const pharmacies = (pharmaciesResult.data || [])
    .map((item) => ({
      id: cleanString(item?.id),
      name: cleanString(item?.name) || "Unknown Pharmacy",
      location: cleanString(item?.location),
    }))
    .filter((item) => Boolean(item.id))
    .filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index);

  return { drugs, pharmacies };
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

  const row = await getInventoryRow(pharmacy, drug);
  return Number(row?.quantity || 0);
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

  const batchNo = normalizeOptional(input?.batchNo);
  const expiryDate = normalizeOptional(input?.expiryDate);
  const referenceNo = normalizeOptional(input?.referenceNo);
  const notes = normalizeOptional(input?.notes);
  const createdBy = normalizeOptional(input?.createdBy) || "falconmed.v1@system";

  if (!drugName) {
    throw new Error("Drug name is required.");
  }

  const nowIso = new Date().toISOString();

  if (movementType === MOVEMENT_TYPES.TRANSFER_OUT || movementType === MOVEMENT_TYPES.TRANSFER_IN) {
    validateTransfer(fromPharmacyId, toPharmacyId);

    if (!fromPharmacyName || !toPharmacyName) {
      throw new Error("Valid source and destination pharmacy names are required.");
    }

    const sourceBalance = await fetchInventoryBalance(fromPharmacyId, drugName);
    if (sourceBalance - quantity < 0) {
      throw new Error(
        `Insufficient stock at \"${fromPharmacyName}\": available ${sourceBalance}, requested ${quantity}.`
      );
    }

    const txRef = referenceNo || `TX-${Date.now()}`;

    const transferOutRow = await insertMovementRow({
      movement_type: MOVEMENT_TYPES.TRANSFER_OUT,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName,
      to_pharmacy: toPharmacyName,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: txRef,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    const transferInRow = await insertMovementRow({
      movement_type: MOVEMENT_TYPES.TRANSFER_IN,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName,
      to_pharmacy: toPharmacyName,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: txRef,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await applyInventoryDelta({
      pharmacyId: fromPharmacyId,
      pharmacyName: fromPharmacyName,
      drugName,
      quantity,
      direction: "subtract",
      batchNo,
      expiryDate,
    });

    await applyInventoryDelta({
      pharmacyId: toPharmacyId,
      pharmacyName: toPharmacyName,
      drugName,
      quantity,
      direction: "add",
      batchNo,
      expiryDate,
    });

    return {
      records: [transferOutRow, transferInRow],
      emittedPharmacyId: toPharmacyId,
    };
  }

  if (movementType === MOVEMENT_TYPES.RECEIVE) {
    if (!toPharmacyId || !toPharmacyName) {
      throw new Error("Destination pharmacy is required for Receive movements.");
    }

    const record = await insertMovementRow({
      movement_type: MOVEMENT_TYPES.RECEIVE,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName || null,
      to_pharmacy: toPharmacyName,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await applyInventoryDelta({
      pharmacyId: toPharmacyId,
      pharmacyName: toPharmacyName,
      drugName,
      quantity,
      direction: "add",
      batchNo,
      expiryDate,
    });

    return { records: [record], emittedPharmacyId: toPharmacyId };
  }

  if (movementType === MOVEMENT_TYPES.ISSUE) {
    if (!fromPharmacyId || !fromPharmacyName) {
      throw new Error("Source pharmacy is required for Issue movements.");
    }

    const sourceBalance = await fetchInventoryBalance(fromPharmacyId, drugName);
    if (sourceBalance - quantity < 0) {
      throw new Error(
        `Insufficient stock at \"${fromPharmacyName}\": available ${sourceBalance}, requested ${quantity}.`
      );
    }

    const record = await insertMovementRow({
      movement_type: MOVEMENT_TYPES.ISSUE,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName,
      to_pharmacy: toPharmacyName || null,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await applyInventoryDelta({
      pharmacyId: fromPharmacyId,
      pharmacyName: fromPharmacyName,
      drugName,
      quantity,
      direction: "subtract",
      batchNo,
      expiryDate,
    });

    return { records: [record], emittedPharmacyId: fromPharmacyId };
  }

  if (movementType === MOVEMENT_TYPES.ADJUSTMENT_PLUS || movementType === MOVEMENT_TYPES.RETURN) {
    const targetPharmacyId = toPharmacyId || fromPharmacyId;
    const targetPharmacyName = toPharmacyName || fromPharmacyName;

    if (!targetPharmacyId || !targetPharmacyName) {
      throw new Error("A pharmacy is required for positive adjustments and returns.");
    }

    const record = await insertMovementRow({
      movement_type: movementType,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName || null,
      to_pharmacy: toPharmacyName || targetPharmacyName,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await applyInventoryDelta({
      pharmacyId: targetPharmacyId,
      pharmacyName: targetPharmacyName,
      drugName,
      quantity,
      direction: "add",
      batchNo,
      expiryDate,
    });

    return { records: [record], emittedPharmacyId: targetPharmacyId };
  }

  if (movementType === MOVEMENT_TYPES.ADJUSTMENT_MINUS) {
    const sourcePharmacyId = fromPharmacyId || toPharmacyId;
    const sourcePharmacyName = fromPharmacyName || toPharmacyName;

    if (!sourcePharmacyId || !sourcePharmacyName) {
      throw new Error("A pharmacy is required for negative adjustments.");
    }

    const sourceBalance = await fetchInventoryBalance(sourcePharmacyId, drugName);
    if (sourceBalance - quantity < 0) {
      throw new Error(
        `Insufficient stock at \"${sourcePharmacyName}\": available ${sourceBalance}, requested ${quantity}.`
      );
    }

    const record = await insertMovementRow({
      movement_type: MOVEMENT_TYPES.ADJUSTMENT_MINUS,
      drug_name: drugName,
      quantity,
      from_pharmacy: fromPharmacyName || sourcePharmacyName,
      to_pharmacy: toPharmacyName || null,
      batch_no: batchNo,
      expiry_date: expiryDate,
      reference_no: referenceNo,
      notes,
      created_at: nowIso,
      created_by: createdBy,
    });

    await applyInventoryDelta({
      pharmacyId: sourcePharmacyId,
      pharmacyName: sourcePharmacyName,
      drugName,
      quantity,
      direction: "subtract",
      batchNo,
      expiryDate,
    });

    return { records: [record], emittedPharmacyId: sourcePharmacyId };
  }

  throw new Error("Unsupported movement type.");
}

export function getStockMovementTypes() {
  return Object.values(MOVEMENT_TYPES);
}
