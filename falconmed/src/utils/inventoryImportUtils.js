function normalizeText(value) {
  return String(value || "").trim();
}

export function parseUnitCost(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeExpiryDate(value) {
  const text = normalizeText(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function buildInventoryPayload({
  pharmacyId,
  autofill,
  quantity,
  expiryDate,
  batchNo,
  lookupValue = "",
}) {
  const resolvedDrugName =
    normalizeText(autofill?.drug_name) ||
    normalizeText(autofill?.brand_name) ||
    normalizeText(autofill?.generic_name) ||
    normalizeText(lookupValue);

  const resolvedUnitCost = parseUnitCost(autofill?.unit_cost);
  const resolvedSalesPrice = parseUnitCost(autofill?.sales_price);
  const resolvedUnit = normalizeText(autofill?.unit);

  return {
    payload: {
      pharmacy_id: pharmacyId,
      drug_name: resolvedDrugName,
      barcode: normalizeText(autofill?.barcode) || null,
      quantity,
      unit_cost: resolvedUnitCost,
      sales_price: resolvedSalesPrice,
      unit: resolvedUnit || null,
      expiry_date: expiryDate,
      batch_no: batchNo,
      brand_name: normalizeText(autofill?.brand_name) || null,
      generic_name: normalizeText(autofill?.generic_name) || null,
    },
    resolvedDrugName,
    resolvedUnitCost,
    resolvedSalesPrice,
    resolvedUnit,
  };
}

export function getInventoryCsvTemplateText() {
  return [
    "drug_code,quantity,batch_no,expiry_date",
    "H03-4489-00178-02,25,BATCH001,2027-12-31",
    "N05-5258-05575-01,337,BATCH002,2027-12-31",
  ].join("\n");
}

export function validateInventoryImportHeaders(
  headers,
  requiredHeaders = ["drug_code", "quantity", "batch_no", "expiry_date"]
) {
  const list = Array.isArray(headers) ? headers : [];
  return requiredHeaders.filter((header) => !list.includes(header));
}
