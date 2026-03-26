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
