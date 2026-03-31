import { resolvePharmacyUnitPrice } from "./drugPricing";

function toAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

function estimateImpact(drugName, quantity) {
  const unitPrice = resolvePharmacyUnitPrice(drugName);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return 0;
  return toAmount(unitPrice * Math.max(0, Number(quantity || 0)));
}

export function generateAiRecommendations({
  shortageRows = [],
  transferRows = [],
  expiryRows = [],
  maxRecommendations = 3,
}) {
  const items = [];

  const transferCandidate = transferRows.find((row) => Number(row?.suggestedTransferQuantity || 0) > 0);
  if (transferCandidate) {
    const qty = toAmount(transferCandidate.suggestedTransferQuantity);
    const impact = estimateImpact(transferCandidate.drugName, qty);

    items.push({
      kind: "transfer",
      badge: "ACTION",
      title: `Transfer ${qty} units of ${transferCandidate.drugName}`,
      action: `From: ${transferCandidate.fromBranch} | To: ${transferCandidate.toBranch}`,
      reason: transferCandidate.reason || "Demand imbalance detected across locations.",
      estimatedFinancialImpact: impact,
    });
  }

  const expiryCandidate = expiryRows.find(
    (row) =>
      String(row?.expiryRiskLevel || "").toLowerCase() === "high" &&
      Number(row?.estimatedAtRiskQuantity || 0) >= 1
  ) || expiryRows.find((row) => Number(row?.estimatedAtRiskQuantity || 0) >= 10);

  if (expiryCandidate) {
    const atRiskQty = toAmount(expiryCandidate.estimatedAtRiskQuantity || expiryCandidate.quantity || 0);
    const impact = estimateImpact(expiryCandidate.drugName, atRiskQty);

    items.push({
      kind: "expiry-prevention",
      badge: "WARNING",
      title: `Prevent expiry for ${expiryCandidate.drugName}`,
      action:
        expiryCandidate.daysToExpiry == null
          ? `Prioritize dispensing batch ${expiryCandidate.batchNumber || "-"}`
          : `Prioritize dispensing within ${expiryCandidate.daysToExpiry} days`,
      reason: "Near-expiry quantity exceeds safe threshold.",
      estimatedFinancialImpact: impact,
    });
  }

  const purchaseCandidate = shortageRows.find(
    (row) => Number(row?.daysLeft) > 0 && Number(row?.daysLeft) < 7
  ) || shortageRows.find((row) => String(row?.shortageRiskLevel || "").toLowerCase() === "high");

  if (purchaseCandidate) {
    const reorderQty = toAmount(purchaseCandidate.suggestedReorderQuantity);
    const impact = estimateImpact(purchaseCandidate.drugName, reorderQty);

    items.push({
      kind: "purchase",
      badge: "INFO",
      title: `Create purchase request for ${purchaseCandidate.drugName}`,
      action: `Recommended quantity: ${reorderQty} units`,
      reason:
        Number.isFinite(Number(purchaseCandidate.daysLeft))
          ? `Projected stock depletion in ${purchaseCandidate.daysLeft} days.`
          : "Projected stock depletion risk detected.",
      estimatedFinancialImpact: impact,
    });
  }

  return items.slice(0, Math.max(1, Number(maxRecommendations || 3)));
}
