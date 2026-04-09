import { supabase } from "../lib/supabaseClient";
import { normalizeInventoryRow } from "../utils/pharmacyData";

function isSchemaMismatchError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

function getNoDatabaseResult() {
  return { error: new Error("Database is not configured.") };
}

export function isInventoryDatabaseConfigured() {
  return Boolean(supabase);
}

export async function fetchInventoryByPharmacy(pharmacyId) {
  if (!supabase) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("pharmacy_inventory")
    .select("*")
    .eq("pharmacy_id", pharmacyId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error };
  }

  return { data: (data || []).map(normalizeInventoryRow), error: null };
}

export async function fetchRecentInventoryTransactions(limit = 10) {
  if (!supabase) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase
    .from("stock_movements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  return { data: data || [], error };
}

export async function saveInventoryRecord(input, attemptName = "inventory_insert") {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  try {
    const insertBody = {
      ...input,
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
      payload: input,
      error: mutationException,
    });
    return { error: mutationException };
  }
}

export async function updateInventoryRecord(id, input, attemptName = "inventory_update") {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  try {
    const result = await supabase.from("pharmacy_inventory").update(input).eq("id", id);

    if (result.error) {
      console.error("Inventory update attempt failed:", {
        attempt: attemptName,
        payload: input,
        error: result.error,
      });
    }

    return result;
  } catch (mutationException) {
    console.error("Inventory mutation threw exception:", {
      attempt: attemptName,
      payload: input,
      error: mutationException,
    });
    return { error: mutationException };
  }
}

export async function runInventoryMutation({ editingRowId, payloadAttempts = [] }) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  for (const attempt of payloadAttempts) {
    const body = attempt?.payload || {};
    const attemptName = attempt?.name || "inventory_mutation";

    const mutation = editingRowId
      ? await updateInventoryRecord(editingRowId, body, attemptName)
      : await saveInventoryRecord(body, attemptName);

    if (!mutation.error) {
      return mutation;
    }

    if (!isSchemaMismatchError(mutation.error)) {
      return mutation;
    }
  }

  return { error: new Error("Inventory save failed after all schema-safe attempts.") };
}

export async function fetchInventoryRecordById(id) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  return supabase.from("pharmacy_inventory").select("*").eq("id", id).single();
}

export async function deleteInventoryRecord(id) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  return supabase.from("pharmacy_inventory").delete().eq("id", id);
}

export async function insertInventoryActivityLog(input) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  return supabase.from("activity_log").insert([input]);
}

export async function insertInventoryStockMovement(input) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  const attemptList = Array.isArray(input?.attempts)
    ? input.attempts
    : [{ payload: input, fallbackOn: "none" }];

  let lastResult = null;

  for (let index = 0; index < attemptList.length; index += 1) {
    const attempt = attemptList[index] || {};
    const payload = attempt.payload || {};
    const fallbackOn = attempt.fallbackOn || "none";

    const result = await supabase.from("stock_movements").insert([payload]);
    lastResult = result;

    if (!result.error) {
      return result;
    }

    const hasNext = index < attemptList.length - 1;
    if (!hasNext) {
      return result;
    }

    if (fallbackOn === "any") {
      continue;
    }

    if (fallbackOn === "schema" && isSchemaMismatchError(result.error)) {
      continue;
    }

    return result;
  }

  return lastResult || { error: new Error("Stock movement insert failed.") };
}

export async function confirmInventoryImportRows(rows) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  return supabase.from("pharmacy_inventory").insert(rows);
}

export async function undoInventoryImportBatch(batchId, pharmacyId) {
  if (!supabase) {
    return getNoDatabaseResult();
  }

  return supabase
    .from("pharmacy_inventory")
    .delete()
    .eq("import_batch_id", batchId)
    .eq("pharmacy_id", pharmacyId);
}
