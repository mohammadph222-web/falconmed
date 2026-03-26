import { resolvePharmacyUnitPrice } from "./drugPricing";

const DEFAULT_COVERAGE_DAYS = 30;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeDrugName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function isWithinDays(dateValue, days) {
  const date = toDate(dateValue);
  if (!date) return false;

  const now = new Date();
  const threshold = new Date(now);
  threshold.setDate(now.getDate() - days);
  return date >= threshold;
}

export function riskFromDaysLeft(daysLeft) {
  if (!Number.isFinite(daysLeft)) return "medium";
  if (daysLeft <= 7) return "high";
  if (daysLeft <= 21) return "medium";
  return "low";
}

export function calculateShortagePredictions({
  refills = [],
  shortages = [],
  expiryRecords = [],
  targetCoverageDays = DEFAULT_COVERAGE_DAYS,
}) {
  const byDrug = new Map();

  const getBucket = (rawName) => {
    const key = normalizeDrugName(rawName);
    if (!key) return null;

    if (!byDrug.has(key)) {
      byDrug.set(key, {
        key,
        drugName: String(rawName || "Unknown").trim() || "Unknown",
        stockFromExpiry: 0,
        recentDispensed: 0,
        recentShortageQty: 0,
        shortagePendingQty: 0,
        dailyUsageSamples: [],
      });
    }

    return byDrug.get(key);
  };

  for (const row of expiryRecords) {
    const bucket = getBucket(row.drug_name || row.drugName);
    if (!bucket) continue;

    const qty = Math.max(0, toNumber(row.quantity));
    bucket.stockFromExpiry += qty;
  }

  for (const row of refills) {
    const bucket = getBucket(row.drug_name || row.drugName);
    if (!bucket) continue;

    const usage = toNumber(row.daily_usage ?? row.dailyUsage);
    if (usage > 0) {
      bucket.dailyUsageSamples.push(usage);
    }

    const dispensed = Math.max(
      0,
      toNumber(row.dispensed ?? row.quantity_dispensed ?? row.quantity)
    );
    if (isWithinDays(row.request_date || row.dispense_date || row.created_at, 45)) {
      bucket.recentDispensed += dispensed;
    }
  }

  for (const row of shortages) {
    const bucket = getBucket(row.drug_name || row.drugName);
    if (!bucket) continue;

    const qty = Math.max(0, toNumber(row.quantity_requested ?? row.quantityRequested ?? row.quantity));
    const status = String(row.status || "").toLowerCase();

    if (isWithinDays(row.request_date || row.requestDate || row.created_at, 30)) {
      bucket.recentShortageQty += qty;
    }

    if (status === "pending" || status === "ordered") {
      bucket.shortagePendingQty += qty;
    }
  }

  const rows = Array.from(byDrug.values())
    .map((bucket) => {
      const usageFromRefills =
        bucket.dailyUsageSamples.length > 0
          ? bucket.dailyUsageSamples.reduce((sum, value) => sum + value, 0) /
            bucket.dailyUsageSamples.length
          : 0;

      const usageFallback = bucket.recentShortageQty > 0 ? bucket.recentShortageQty / 30 : 0;
      const averageDailyUsage = usageFromRefills > 0 ? usageFromRefills : usageFallback;

      const inferredStockFromFlow = Math.max(
        0,
        bucket.recentDispensed - bucket.recentShortageQty
      );

      const currentStock =
        bucket.stockFromExpiry > 0 ? bucket.stockFromExpiry : inferredStockFromFlow;

      const daysLeft =
        averageDailyUsage > 0 ? Number((currentStock / averageDailyUsage).toFixed(1)) : null;

      const riskLevel = riskFromDaysLeft(daysLeft);
      const coverageNeed = averageDailyUsage * targetCoverageDays;
      const reorderFromCoverage = Math.max(0, Math.ceil(coverageNeed - currentStock));
      const reorderToCoverPending = Math.max(0, Math.ceil(bucket.shortagePendingQty - currentStock));

      const suggestedReorderQuantity = Math.max(reorderFromCoverage, reorderToCoverPending);

      return {
        drugName: bucket.drugName,
        currentStock: Math.round(currentStock),
        averageDailyUsage: Number(averageDailyUsage.toFixed(2)),
        daysLeft,
        shortageRiskLevel: riskLevel,
        suggestedReorderQuantity,
      };
    })
    .filter((row) => row.currentStock > 0 || row.averageDailyUsage > 0 || row.suggestedReorderQuantity > 0)
    .sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      const byRisk = riskOrder[a.shortageRiskLevel] - riskOrder[b.shortageRiskLevel];
      if (byRisk !== 0) return byRisk;
      return b.suggestedReorderQuantity - a.suggestedReorderQuantity;
    });

  return rows;
}

export function buildPdssSummary(rows) {
  return {
    total: rows.length,
    high: rows.filter((row) => row.shortageRiskLevel === "high").length,
    medium: rows.filter((row) => row.shortageRiskLevel === "medium").length,
    low: rows.filter((row) => row.shortageRiskLevel === "low").length,
  };
}

export function calculateSmartTransferRecommendations({
  refills = [],
  shortages = [],
  expiryRecords = [],
}) {
  const usageByDrug = new Map();
  const stockByDrugBranch = new Map();

  const getUsageBucket = (rawName) => {
    const key = normalizeDrugName(rawName);
    if (!key) return null;

    if (!usageByDrug.has(key)) {
      usageByDrug.set(key, {
        key,
        drugName: String(rawName || "Unknown").trim() || "Unknown",
        dailyUsageSamples: [],
        recentShortageQty: 0,
      });
    }

    return usageByDrug.get(key);
  };

  const getStockBucket = (rawName, rawBranch) => {
    const drugKey = normalizeDrugName(rawName);
    const branchName = String(rawBranch || "").trim();
    if (!drugKey || !branchName || branchName === "-") return null;

    const key = `${drugKey}::${branchName.toLowerCase()}`;
    if (!stockByDrugBranch.has(key)) {
      stockByDrugBranch.set(key, {
        key,
        drugKey,
        drugName: String(rawName || "Unknown").trim() || "Unknown",
        branchName,
        stock: 0,
      });
    }

    return stockByDrugBranch.get(key);
  };

  for (const row of refills) {
    const bucket = getUsageBucket(row.drug_name || row.drugName);
    if (!bucket) continue;

    const usage = toNumber(row.daily_usage ?? row.dailyUsage);
    if (usage > 0) {
      bucket.dailyUsageSamples.push(usage);
    }
  }

  for (const row of shortages) {
    const bucket = getUsageBucket(row.drug_name || row.drugName);
    if (!bucket) continue;

    const qty = Math.max(
      0,
      toNumber(row.quantity_requested ?? row.quantityRequested ?? row.quantity)
    );

    if (isWithinDays(row.request_date || row.requestDate || row.created_at, 30)) {
      bucket.recentShortageQty += qty;
    }
  }

  for (const row of expiryRecords) {
    const bucket = getStockBucket(row.drug_name || row.drugName, row.location || row.branch);
    if (!bucket) continue;

    bucket.stock += Math.max(0, toNumber(row.quantity));
  }

  const branchesByDrug = new Map();
  for (const branchBucket of stockByDrugBranch.values()) {
    if (!branchesByDrug.has(branchBucket.drugKey)) {
      branchesByDrug.set(branchBucket.drugKey, []);
    }
    branchesByDrug.get(branchBucket.drugKey).push(branchBucket);
  }

  const recommendations = [];

  for (const [drugKey, branches] of branchesByDrug.entries()) {
    if (branches.length < 2) continue;

    const usageBucket = usageByDrug.get(drugKey);
    const usageFromRefills =
      usageBucket && usageBucket.dailyUsageSamples.length > 0
        ? usageBucket.dailyUsageSamples.reduce((sum, value) => sum + value, 0) /
          usageBucket.dailyUsageSamples.length
        : 0;
    const usageFallback = usageBucket?.recentShortageQty > 0 ? usageBucket.recentShortageQty / 30 : 0;
    const globalDailyUsage = usageFromRefills > 0 ? usageFromRefills : usageFallback;

    if (globalDailyUsage <= 0) continue;

    const perBranchDailyUsage = globalDailyUsage / branches.length;
    if (perBranchDailyUsage <= 0) continue;

    const enriched = branches.map((branch) => {
      const daysLeft = Number((branch.stock / perBranchDailyUsage).toFixed(1));
      const safeThresholdStock = Math.ceil(perBranchDailyUsage * 30);
      const targetReceiverStock = Math.ceil(perBranchDailyUsage * 14);

      return {
        ...branch,
        dailyUsage: perBranchDailyUsage,
        daysLeft,
        safeThresholdStock,
        targetReceiverStock,
      };
    });

    const receivers = enriched.filter((branch) => branch.daysLeft < 7);
    const senders = enriched.filter((branch) => branch.daysLeft > 30);

    for (const receiver of receivers) {
      let remainingNeed = Math.max(0, receiver.targetReceiverStock - receiver.stock);
      if (remainingNeed <= 0) continue;

      const eligibleSenders = senders
        .filter((sender) => sender.branchName !== receiver.branchName)
        .map((sender) => ({
          ...sender,
          availableToTransfer: Math.max(0, sender.stock - sender.safeThresholdStock),
        }))
        .filter((sender) => sender.availableToTransfer > 0)
        .sort((a, b) => b.availableToTransfer - a.availableToTransfer);

      for (const sender of eligibleSenders) {
        if (remainingNeed <= 0) break;

        const suggestedTransferQuantity = Math.min(sender.availableToTransfer, Math.ceil(remainingNeed));
        if (suggestedTransferQuantity <= 0) continue;

        const priority = receiver.daysLeft < 3 ? "high" : "medium";
        const reason = `${receiver.branchName} is below 7 days of cover while ${sender.branchName} remains above the 30-day safe threshold.`;

        recommendations.push({
          drugName: receiver.drugName,
          fromBranch: sender.branchName,
          toBranch: receiver.branchName,
          senderStock: Math.round(sender.stock),
          senderDaysLeft: sender.daysLeft,
          receiverStock: Math.round(receiver.stock),
          receiverDaysLeft: receiver.daysLeft,
          suggestedTransferQuantity,
          priority,
          reason,
        });

        remainingNeed -= suggestedTransferQuantity;
      }
    }
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (byPriority !== 0) return byPriority;
    return b.suggestedTransferQuantity - a.suggestedTransferQuantity;
  });
}

export function buildExecutiveMetrics(shortageRows = [], transferRows = []) {
  const shortageSummary = buildPdssSummary(shortageRows);
  const totalSuggestedTransferQuantity = transferRows.reduce(
    (sum, row) => sum + Number(row.suggestedTransferQuantity || 0),
    0
  );

  return {
    trackedDrugs: shortageSummary.total,
    highRiskShortages: shortageSummary.high,
    mediumRiskShortages: shortageSummary.medium,
    lowRiskShortages: shortageSummary.low,
    transferOpportunities: transferRows.length,
    totalSuggestedTransferQuantity,
  };
}

export function buildExecutiveNarrative(metrics) {
  const {
    trackedDrugs = 0,
    highRiskShortages = 0,
    mediumRiskShortages = 0,
    transferOpportunities = 0,
    totalSuggestedTransferQuantity = 0,
  } = metrics || {};

  if (trackedDrugs === 0) {
    return "Executive visibility is limited because there is not enough operational history yet. As refill, shortage, and branch stock records accumulate, this dashboard will surface shortage pressure and internal balancing opportunities automatically.";
  }

  if (highRiskShortages > 0 && transferOpportunities > 0) {
    return `FalconMed is currently tracking ${trackedDrugs} active drugs, with ${highRiskShortages} high-risk shortages requiring immediate attention. The system has identified ${transferOpportunities} internal transfer opportunities covering ${totalSuggestedTransferQuantity} units, which can reduce urgent supply pressure before external procurement is needed.`;
  }

  if (highRiskShortages > 0) {
    return `FalconMed is currently tracking ${trackedDrugs} active drugs, including ${highRiskShortages} high-risk shortages and ${mediumRiskShortages} medium-risk items. Executive focus should remain on replenishment speed and inventory visibility because internal balancing options are limited at the moment.`;
  }

  if (transferOpportunities > 0) {
    return `Current shortage pressure is relatively controlled across ${trackedDrugs} tracked drugs. The main operational opportunity is proactive redistribution: ${transferOpportunities} transfer suggestions are available, representing ${totalSuggestedTransferQuantity} units that can be repositioned to protect continuity of care.`;
  }

  return `Current portfolio risk is stable across ${trackedDrugs} tracked drugs, with no immediate internal transfer recommendations. Executive attention can remain focused on maintaining data quality and monitoring emerging medium-risk items before they escalate.`;
}

function daysUntil(dateValue) {
  const date = toDate(dateValue);
  if (!date) return null;

  const now = new Date();
  const ms = date.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function averageUsageByDrug(refills = []) {
  const usageMap = new Map();

  for (const row of refills) {
    const key = normalizeDrugName(row.drug_name || row.drugName);
    if (!key) continue;

    const usage = toNumber(row.daily_usage ?? row.dailyUsage);
    if (usage <= 0) continue;

    if (!usageMap.has(key)) {
      usageMap.set(key, {
        total: 0,
        count: 0,
      });
    }

    const bucket = usageMap.get(key);
    bucket.total += usage;
    bucket.count += 1;
  }

  const result = new Map();
  for (const [key, bucket] of usageMap.entries()) {
    result.set(key, bucket.count > 0 ? bucket.total / bucket.count : 0);
  }

  return result;
}

function expiryRiskFromCoverage({ daysToExpiry, daysNeededToConsume, averageDailyUsage }) {
  if (daysToExpiry == null) return "medium";
  if (daysToExpiry <= 0) return "high";

  if (averageDailyUsage <= 0) {
    if (daysToExpiry <= 60) return "high";
    if (daysToExpiry <= 120) return "medium";
    return "low";
  }

  if (daysNeededToConsume > daysToExpiry) return "high";
  if (daysNeededToConsume > daysToExpiry * 0.7) return "medium";
  return "low";
}

function suggestedExpiryAction({ riskLevel, daysToExpiry, averageDailyUsage }) {
  if (riskLevel === "high") {
    if (daysToExpiry != null && daysToExpiry <= 30) return "Use Immediately";
    return "Prioritize Dispensing";
  }

  if (riskLevel === "medium") {
    if (averageDailyUsage <= 0) return "Monitor Closely";
    return "Prioritize Dispensing";
  }

  if (daysToExpiry != null && daysToExpiry > 180) return "Reduce Next Order";
  return "Monitor Closely";
}

export function calculateExpiryIntelligence({ expiryRecords = [], refills = [] }) {
  const usageMap = averageUsageByDrug(refills);

  return (expiryRecords || [])
    .map((row, index) => {
      const drugName = String(row.drug_name || row.drugName || "Unknown").trim() || "Unknown";
      const batchNumber = String(row.batch_no || row.batchNo || "-").trim() || "-";
      const quantity = Math.max(0, toNumber(row.quantity));
      const expiryDate = row.expiry_date || row.expiryDate || "";
      const daysToExpiry = daysUntil(expiryDate);

      const usageKey = normalizeDrugName(drugName);
      const averageDailyUsage = Number((usageMap.get(usageKey) || 0).toFixed(2));
      const daysNeededToConsume =
        averageDailyUsage > 0 ? Number((quantity / averageDailyUsage).toFixed(1)) : null;

      const riskLevel = expiryRiskFromCoverage({
        daysToExpiry,
        daysNeededToConsume,
        averageDailyUsage,
      });

      const suggestedAction = suggestedExpiryAction({
        riskLevel,
        daysToExpiry,
        averageDailyUsage,
      });

      const estimatedAtRiskQuantity = (() => {
        if (quantity <= 0) return 0;
        if (daysToExpiry == null) return Math.ceil(quantity * 0.25);
        if (daysToExpiry <= 0) return Math.ceil(quantity);
        if (averageDailyUsage <= 0) return riskLevel === "high" ? Math.ceil(quantity) : Math.ceil(quantity * 0.3);

        const expectedConsumption = averageDailyUsage * daysToExpiry;
        return Math.max(0, Math.ceil(quantity - expectedConsumption));
      })();

      return {
        id: row.id || `${drugName}-${batchNumber}-${index}`,
        drugName,
        batchNumber,
        quantity: Math.round(quantity),
        expiryDate,
        daysToExpiry,
        averageDailyUsage,
        daysNeededToConsume,
        expiryRiskLevel: riskLevel,
        estimatedAtRiskQuantity,
        suggestedAction,
      };
    })
    .filter((row) => row.quantity > 0)
    .sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      const byRisk = riskOrder[a.expiryRiskLevel] - riskOrder[b.expiryRiskLevel];
      if (byRisk !== 0) return byRisk;

      const aDays = a.daysToExpiry == null ? Number.POSITIVE_INFINITY : a.daysToExpiry;
      const bDays = b.daysToExpiry == null ? Number.POSITIVE_INFINITY : b.daysToExpiry;
      return aDays - bDays;
    });
}

export function buildExpiryMetrics(rows = []) {
  return {
    nearExpiryBatches: rows.filter((row) => row.daysToExpiry != null && row.daysToExpiry <= 90).length,
    highExpiryRisk: rows.filter((row) => row.expiryRiskLevel === "high").length,
    mediumExpiryRisk: rows.filter((row) => row.expiryRiskLevel === "medium").length,
    lowExpiryRisk: rows.filter((row) => row.expiryRiskLevel === "low").length,
    estimatedAtRiskQuantity: rows.reduce(
      (sum, row) => sum + Number(row.estimatedAtRiskQuantity || 0),
      0
    ),
  };
}

export function buildExpiryNarrative(metrics) {
  const {
    nearExpiryBatches = 0,
    highExpiryRisk = 0,
    mediumExpiryRisk = 0,
    estimatedAtRiskQuantity = 0,
  } = metrics || {};

  if (nearExpiryBatches === 0) {
    return "No near-expiry pressure is currently detected in the available inventory records. Continue routine monitoring and maintain refill usage quality to preserve forecasting confidence.";
  }

  if (highExpiryRisk > 0) {
    return `The system has identified ${nearExpiryBatches} near-expiry batches, including ${highExpiryRisk} high-risk batches. Approximately ${estimatedAtRiskQuantity} units are exposed to expiry risk, so immediate dispensing prioritization is recommended for vulnerable items.`;
  }

  return `Expiry exposure is currently moderate with ${nearExpiryBatches} near-expiry batches and ${mediumExpiryRisk} medium-risk batches. Focus on controlled dispensing acceleration and procurement adjustment to reduce potential write-off volume.`;
}

export function priorityRank(priority) {
  const rank = { high: 0, medium: 1, low: 2 };
  return rank[String(priority || "").toLowerCase()] ?? 3;
}

function normalizeActionType(actionType) {
  const value = String(actionType || "").toLowerCase();
  if (value.includes("reorder")) return "Reorder";
  if (value.includes("transfer")) return "Transfer";
  if (value.includes("immediate")) return "Use Immediately";
  if (value.includes("prioritize")) return "Prioritize Dispensing";
  return "Monitor";
}

function shortageActions(shortageRows = []) {
  return shortageRows
    .map((row, index) => {
      const risk = String(row.shortageRiskLevel || "low").toLowerCase();
      const priority = risk === "high" ? "high" : risk === "medium" ? "medium" : "low";

      const type = risk === "low" ? "Monitor" : "Reorder";
      const action =
        risk === "high"
          ? "Create urgent reorder"
          : risk === "medium"
            ? "Plan reorder"
            : "Monitor usage trend";

      const details =
        row.daysLeft == null
          ? "Consumption data is limited; monitor demand and stock trend."
          : `${row.daysLeft} days left at current usage.`;

      return {
        id: `shortage-${row.drugName}-${index}`,
        source: "shortage",
        priority,
        type,
        action,
        drugName: row.drugName,
        details,
        suggestedQuantity: Number(row.suggestedReorderQuantity || 0),
      };
    })
    .filter((row) => row.priority !== "low" || row.suggestedQuantity > 0);
}

function expiryActions(expiryRows = []) {
  return expiryRows.map((row, index) => {
    const risk = String(row.expiryRiskLevel || "medium").toLowerCase();
    const priority = risk === "high" ? "high" : risk === "medium" ? "medium" : "low";

    const type = normalizeActionType(row.suggestedAction);
    const details =
      row.daysToExpiry == null
        ? "Expiry date unavailable. Review batch record."
        : `${row.daysToExpiry} days to expiry, batch ${row.batchNumber || "-"}.`;

    return {
      id: `expiry-${row.id || `${row.drugName}-${index}`}`,
      source: "expiry",
      priority,
      type,
      action: row.suggestedAction || "Monitor Closely",
      drugName: row.drugName,
      details,
      suggestedQuantity: Number(row.estimatedAtRiskQuantity || 0),
    };
  });
}

function transferActions(transferRows = []) {
  return transferRows.map((row, index) => ({
    id: `transfer-${row.drugName}-${row.fromBranch}-${row.toBranch}-${index}`,
    source: "transfer",
    priority: String(row.priority || "medium").toLowerCase(),
    type: "Transfer",
    action: "Review transfer suggestion",
    drugName: row.drugName,
    details: `${row.fromBranch} -> ${row.toBranch}`,
    suggestedQuantity: Number(row.suggestedTransferQuantity || 0),
  }));
}

export function buildPdssActionItems({
  shortageRows = [],
  expiryRows = [],
  transferRows = [],
}) {
  const all = [
    ...shortageActions(shortageRows),
    ...expiryActions(expiryRows),
    ...transferActions(transferRows),
  ];

  return all.sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    if (byPriority !== 0) return byPriority;
    return Number(b.suggestedQuantity || 0) - Number(a.suggestedQuantity || 0);
  });
}

export function buildActionSummary(actions = []) {
  return {
    total: actions.length,
    high: actions.filter((x) => x.priority === "high").length,
    medium: actions.filter((x) => x.priority === "medium").length,
    low: actions.filter((x) => x.priority === "low").length,
  };
}

export function filterActionItems(actions = [], filterKey = "all") {
  switch (filterKey) {
    case "shortage":
    case "expiry":
    case "transfer":
      return actions.filter((x) => x.source === filterKey);
    case "high-priority":
      return actions.filter((x) => x.priority === "high");
    default:
      return actions;
  }
}

export function topUrgentActions(actions = [], limit = 5) {
  return [...actions]
    .sort((a, b) => {
      const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
      if (byPriority !== 0) return byPriority;
      return Number(b.suggestedQuantity || 0) - Number(a.suggestedQuantity || 0);
    })
    .slice(0, limit);
}

// ─── Financial Intelligence v1 ───────────────────────────────────────────────

function lookupPriceFromMap(drugName, priceMap) {
  if (!priceMap) return null;
  return resolvePharmacyUnitPrice(drugName);
}

/**
 * Calculate the three Financial Intelligence KPIs.
 *   estimatedExpiryLoss       — at-risk units × pharmacy unit price
 *   atRiskInventoryValue      — total quantity of high/medium expiry rows × pharmacy unit price
 *   highRiskShortageExposure  — suggested reorder qty for high-risk shortage rows × pharmacy unit price
 *
 * Items whose drug name cannot be matched in the price map are silently skipped
 * so a missing price entry never breaks the UI (Req D).
 *
 * @param {Object} params
 * @param {Array}  params.expiryRows   — output of calculateExpiryIntelligence()
 * @param {Array}  params.shortageRows — output of calculateShortagePredictions()
 * @param {Map}    params.drugPriceMap — output of buildDrugPriceMap() from drugPricing.js
 * @returns {{ estimatedExpiryLoss: number, atRiskInventoryValue: number, highRiskShortageExposure: number }}
 */
export function calculateFinancialKpis({
  expiryRows = [],
  shortageRows = [],
  drugPriceMap,
}) {
  let estimatedExpiryLoss = 0;
  let atRiskInventoryValue = 0;
  let highRiskShortageExposure = 0;

  for (const row of expiryRows) {
    const unitPrice = lookupPriceFromMap(row.drugName, drugPriceMap);
    if (unitPrice === null) continue;

    estimatedExpiryLoss += (row.estimatedAtRiskQuantity || 0) * unitPrice;

    if (row.expiryRiskLevel === "high" || row.expiryRiskLevel === "medium") {
      atRiskInventoryValue += (row.quantity || 0) * unitPrice;
    }
  }

  for (const row of shortageRows) {
    if (row.shortageRiskLevel !== "high") continue;
    const unitPrice = lookupPriceFromMap(row.drugName, drugPriceMap);
    if (unitPrice === null) continue;
    highRiskShortageExposure += (row.suggestedReorderQuantity || 0) * unitPrice;
  }

  return {
    estimatedExpiryLoss: Math.round(estimatedExpiryLoss),
    atRiskInventoryValue: Math.round(atRiskInventoryValue),
    highRiskShortageExposure: Math.round(highRiskShortageExposure),
  };
}
