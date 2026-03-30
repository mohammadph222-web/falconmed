const PLAN_ORDER = ["starter", "professional", "enterprise"];

export const PLAN_LABELS = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const PAGE_ACCESS = {
  dashboard: { minimumPlan: "starter", label: "Dashboard" },
  drugsearch: { minimumPlan: "starter", label: "Drug Intelligence" },
  expiry: { minimumPlan: "starter", label: "Expiry Tracker" },
  shortage: { minimumPlan: "starter", label: "Shortage Tracker" },
  labels: { minimumPlan: "starter", label: "Labeling Suite" },
  billing: { minimumPlan: "starter", label: "Billing" },
  reports: { minimumPlan: "professional", label: "Analytics" },
  "stock-movement": { minimumPlan: "professional", label: "Stock Movement" },
  stocktaking: { minimumPlan: "professional", label: "Stocktaking" },
  pdss: { minimumPlan: "professional", label: "PDSS" },
  purchases: { minimumPlan: "professional", label: "Purchase Requests" },
  refill: { minimumPlan: "enterprise", label: "Refill Tracker" },
  network: { minimumPlan: "enterprise", label: "Network Intelligence" },
  "pharmacy-network": { minimumPlan: "enterprise", label: "Pharmacy Network" },
  "inventory-management": { minimumPlan: "enterprise", label: "Inventory Management" },
};

export function normalizePlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  return PLAN_ORDER.includes(normalized) ? normalized : "starter";
}

export function getRequiredPlan(page) {
  return PAGE_ACCESS[page]?.minimumPlan || "starter";
}

export function getFeatureLabel(page) {
  return PAGE_ACCESS[page]?.label || "Feature";
}

export function hasPlanAccess(plan, requiredPlan) {
  return PLAN_ORDER.indexOf(normalizePlan(plan)) >= PLAN_ORDER.indexOf(normalizePlan(requiredPlan));
}

export function canAccessPage(plan, page) {
  return hasPlanAccess(plan, getRequiredPlan(page));
}

export function getUpgradeMessage(page) {
  return `This feature is available on the ${PLAN_LABELS[getRequiredPlan(page)]} plan.`;
}
