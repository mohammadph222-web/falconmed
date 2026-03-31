import { useMemo, useState } from "react";
import {
  canAccessPage,
  PAGE_ACCESS,
  PLAN_LABELS,
  normalizePlan,
} from "./config/featureAccess";

const PLAN_KEYS = ["starter", "professional", "enterprise"];

function getAccessMode(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "preview") {
    return "Executive Preview";
  }
  if (normalized === "active" || normalized === "trial" || normalized === "trialing") {
    return "Standard";
  }
  return "Limited";
}

function getEntitlementNote(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "preview") {
    return "Enterprise preview is active. Module visibility is expanded for presentation mode while subscription controls remain view-only.";
  }
  if (normalized === "active") {
    return "Your subscription is active and access is granted by your current plan.";
  }
  if (normalized === "trial" || normalized === "trialing") {
    return "Trial access is active. Plan entitlement applies while trial is valid.";
  }
  if (normalized === "unavailable") {
    return "Subscription unavailable. Limited access mode is currently enforced.";
  }
  return "Starter access is active until a subscription is assigned.";
}

function getStatusLabel(status) {
  if (!status) return "Inactive";

  return String(status)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function SubscriptionCenter({ plan, status, isDemoMode = false }) {
  const effectivePlan = normalizePlan(plan);
  const [selectedPlan, setSelectedPlan] = useState("");

  const handlePlanAction = (planKey) => {
    if (isDemoMode) return;
    setSelectedPlan(planKey);
  };

  const moduleRows = useMemo(
    () =>
      Object.entries(PAGE_ACCESS)
        .map(([pageKey, config]) => ({
          pageKey,
          label: config.label,
          minimumPlan: config.minimumPlan,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    []
  );

  const modulesByPlan = useMemo(() => {
    const next = {
      starter: [],
      professional: [],
      enterprise: [],
    };

    for (const planKey of PLAN_KEYS) {
      next[planKey] = moduleRows
        .filter((row) => canAccessPage(planKey, row.pageKey))
        .map((row) => row.label);
    }

    return next;
  }, [moduleRows]);

  return (
    <div style={wrap}>
      <div style={headerCard}>
        <div style={eyebrow}>Subscription Center</div>
        <h2 style={title}>Plans and Access</h2>
        <p style={subtitle}>
          Manage current entitlement visibility and prepare upgrade workflows.
        </p>
        {isDemoMode ? <div style={previewNote}>Executive preview mode. Subscription actions are view-only in this session.</div> : null}
      </div>

      <div style={gridTwoCols}>
        <div style={card}>
          <div style={cardTitle}>Current Plan</div>
          <div style={currentPlanName}>{PLAN_LABELS[effectivePlan]}</div>

          <div style={metaGrid}>
            <div style={metaItem}>
              <div style={metaLabel}>Status</div>
              <div style={metaValue}>{getStatusLabel(status)}</div>
            </div>
            <div style={metaItem}>
              <div style={metaLabel}>Access Mode</div>
              <div style={metaValue}>{getAccessMode(status)}</div>
            </div>
            <div style={metaItem}>
              <div style={metaLabel}>Seats</div>
              <div style={metaValue}>1 current user</div>
            </div>
            <div style={metaItem}>
              <div style={metaLabel}>Billing</div>
              <div style={metaValue}>Contact sales</div>
            </div>
          </div>

          <div style={noteBox}>{getEntitlementNote(status)}</div>
        </div>

        <div style={card}>
          <div style={cardTitle}>Seats and Users</div>
          <div style={seatValue}>1 current user</div>
          <div style={seatList}>
            <div style={seatRow}>Seat model: Coming soon</div>
            <div style={seatRow}>User management: Planned</div>
            <div style={seatRow}>Team provisioning: Future phase</div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={cardTitle}>Available Plans</div>
        <div style={plansGrid}>
          {PLAN_KEYS.map((planKey) => {
            const isCurrent = planKey === effectivePlan;

            return (
              <div key={planKey} style={{ ...planCard, ...(isCurrent ? currentPlanCard : null) }}>
                <div style={planHeaderRow}>
                  <div style={planName}>{PLAN_LABELS[planKey]}</div>
                  {isCurrent ? <span style={currentBadge}>Current</span> : null}
                </div>
                <div style={priceText}>
                  {planKey === "starter"
                    ? "Pricing available on request"
                    : planKey === "professional"
                      ? "Contact sales"
                      : "Custom quote"}
                </div>
                <div style={moduleListTitle}>Included modules</div>
                <div style={moduleList}>
                  {modulesByPlan[planKey].map((label) => (
                    <div key={`${planKey}-${label}`} style={modulePill}>{label}</div>
                  ))}
                </div>
                <button
                  style={{
                    ...upgradeButton,
                    ...(isCurrent ? currentButton : null),
                    ...(isDemoMode ? previewOnlyButton : null),
                  }}
                  onClick={() => handlePlanAction(planKey)}
                  disabled={isDemoMode}
                >
                  {isDemoMode ? "Preview Only" : isCurrent ? "Manage Plan" : "Request Upgrade"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={card}>
        <div style={cardTitle}>Feature Comparison</div>
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={thLeft}>Module</th>
                <th style={th}>Starter</th>
                <th style={th}>Professional</th>
                <th style={th}>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {moduleRows.map((row) => (
                <tr key={row.pageKey}>
                  <td style={tdLeft}>{row.label}</td>
                  {PLAN_KEYS.map((planKey) => (
                    <td key={`${row.pageKey}-${planKey}`} style={tdCenter}>
                      {canAccessPage(planKey, row.pageKey) ? <span style={check}>Included</span> : <span style={dash}>-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPlan ? (
        <div style={overlay} onClick={() => setSelectedPlan("")}>
          <div style={modal} onClick={(event) => event.stopPropagation()}>
            <div style={modalTitle}>Upgrade Plan</div>
            <div style={modalText}>
              Upgrade workflow coming soon. Contact FalconMed sales to activate the {PLAN_LABELS[selectedPlan]} plan.
            </div>
            <div style={modalActions}>
              <button style={modalButton} onClick={() => setSelectedPlan("")}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const wrap = {
  display: "grid",
  gap: "16px",
};

const headerCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  padding: "18px",
  boxShadow: "0 12px 30px rgba(15,23,42,0.06)",
};

const eyebrow = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#1d4ed8",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const title = {
  marginTop: "8px",
  marginBottom: "6px",
  fontSize: "30px",
  color: "#0f172a",
  letterSpacing: "-0.03em",
};

const subtitle = {
  margin: 0,
  color: "#64748b",
  fontSize: "14px",
  lineHeight: 1.7,
};

const previewNote = {
  marginTop: "14px",
  padding: "10px 12px",
  borderRadius: "12px",
  background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
  fontSize: "13px",
  fontWeight: 600,
};

const gridTwoCols = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "16px",
};

const card = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  padding: "18px",
  boxShadow: "0 12px 30px rgba(15,23,42,0.06)",
};

const cardTitle = {
  marginTop: 0,
  marginBottom: "12px",
  fontSize: "13px",
  color: "#475569",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const currentPlanName = {
  fontSize: "30px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.03em",
  marginBottom: "14px",
};

const metaGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: "10px",
};

const metaItem = {
  borderRadius: "12px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  padding: "10px",
};

const metaLabel = {
  fontSize: "11px",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "4px",
};

const metaValue = {
  fontSize: "14px",
  color: "#0f172a",
  fontWeight: 700,
};

const noteBox = {
  marginTop: "12px",
  borderRadius: "12px",
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#1e3a8a",
  padding: "10px 12px",
  fontSize: "13px",
  lineHeight: 1.6,
};

const seatValue = {
  fontSize: "28px",
  color: "#0f172a",
  fontWeight: 800,
  marginBottom: "10px",
  letterSpacing: "-0.02em",
};

const seatList = {
  display: "grid",
  gap: "8px",
};

const seatRow = {
  borderRadius: "10px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  padding: "9px 10px",
  fontSize: "13px",
  color: "#334155",
};

const plansGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "12px",
};

const planCard = {
  borderRadius: "14px",
  border: "1px solid #e2e8f0",
  background: "#ffffff",
  padding: "14px",
  display: "grid",
  gap: "10px",
};

const currentPlanCard = {
  border: "1px solid #93c5fd",
  boxShadow: "0 0 0 3px rgba(59,130,246,0.12)",
};

const planHeaderRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const planName = {
  fontSize: "22px",
  fontWeight: 800,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const currentBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#dbeafe",
  color: "#1d4ed8",
  border: "1px solid #93c5fd",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const priceText = {
  fontSize: "13px",
  color: "#475569",
};

const moduleListTitle = {
  fontSize: "11px",
  color: "#64748b",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const moduleList = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
  maxHeight: "128px",
  overflowY: "auto",
};

const modulePill = {
  fontSize: "11px",
  color: "#1f2937",
  borderRadius: "999px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  padding: "4px 8px",
};

const upgradeButton = {
  border: "none",
  borderRadius: "10px",
  background: "#1d4ed8",
  color: "white",
  fontSize: "13px",
  fontWeight: 700,
  padding: "9px 12px",
  cursor: "pointer",
};

const currentButton = {
  background: "#0f172a",
};

const previewOnlyButton = {
  background: "#e2e8f0",
  color: "#475569",
  borderColor: "#cbd5e1",
  cursor: "not-allowed",
};

const tableWrap = {
  overflowX: "auto",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "620px",
};

const th = {
  textAlign: "center",
  padding: "10px 8px",
  background: "#f8fafc",
  color: "#475569",
  borderBottom: "1px solid #e2e8f0",
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const thLeft = {
  ...th,
  textAlign: "left",
  paddingLeft: "12px",
};

const tdLeft = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontSize: "13px",
  fontWeight: 600,
};

const tdCenter = {
  padding: "10px 8px",
  borderBottom: "1px solid #f1f5f9",
  textAlign: "center",
};

const check = {
  color: "#166534",
  background: "#dcfce7",
  border: "1px solid #bbf7d0",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  padding: "3px 8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const dash = {
  color: "#94a3b8",
  fontSize: "13px",
  fontWeight: 700,
};

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.40)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 1000,
};

const modal = {
  width: "min(520px, 100%)",
  borderRadius: "16px",
  background: "white",
  border: "1px solid #e2e8f0",
  boxShadow: "0 25px 60px rgba(15, 23, 42, 0.32)",
  padding: "20px",
};

const modalTitle = {
  marginTop: 0,
  marginBottom: "8px",
  fontSize: "26px",
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const modalText = {
  margin: 0,
  color: "#475569",
  fontSize: "15px",
  lineHeight: 1.7,
};

const modalActions = {
  marginTop: "16px",
  display: "flex",
  justifyContent: "flex-end",
};

const modalButton = {
  border: "none",
  borderRadius: "10px",
  background: "#1d4ed8",
  color: "white",
  fontWeight: 700,
  padding: "9px 14px",
  cursor: "pointer",
};
