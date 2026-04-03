const PLAN_ORDER = ["starter", "professional", "enterprise"];

export const PLAN_LABELS = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const PAGE_ACCESS = {
  dashboard: { minimumPlan: "starter", label: "Dashboard" },
  "inventory-overview": { minimumPlan: "starter", label: "Inventory Overview" },
  "subscription-center": { minimumPlan: "starter", label: "Subscription Center" },
  drugsearch: { minimumPlan: "starter", label: "Drug Intelligence" },
  expiry: { minimumPlan: "starter", label: "Expiry Tracker" },
  shortage: { minimumPlan: "starter", label: "Shortage Tracker" },
  labels: { minimumPlan: "starter", label: "Labeling Suite" },
  billing: { minimumPlan: "starter", label: "Billing" },
  reports: { minimumPlan: "starter", label: "Analytics" },
  "stock-movement": { minimumPlan: "starter", label: "Stock Movement" },
  "stock-movement-v1": { minimumPlan: "starter", label: "Stock Movement V1" },
  stocktaking: { minimumPlan: "starter", label: "Stocktaking" },
  pdss: { minimumPlan: "starter", label: "PDSS" },
  purchases: { minimumPlan: "starter", label: "Purchase Requests" },
  refill: { minimumPlan: "starter", label: "Refill Tracker" },
  network: { minimumPlan: "starter", label: "Network Intelligence" },
  "pharmacy-network": { minimumPlan: "starter", label: "Pharmacy Network" },
  "inventory-management": { minimumPlan: "starter", label: "Inventory Management" },
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
