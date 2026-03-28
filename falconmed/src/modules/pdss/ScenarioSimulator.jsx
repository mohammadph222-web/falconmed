import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getDrugDisplayName, loadDrugMaster, searchDrugMaster } from "../../utils/drugMaster";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ScenarioSimulator() {
  const [allDrugs, setAllDrugs] = useState([]);
  const [showDrugDropdown, setShowDrugDropdown] = useState(false);
  const [form, setForm] = useState({
    drugName: "",
    currentStock: "",
    averageDailyUsage: "",
    supplierLeadTimeDays: "",
    demandIncreasePercent: "",
    transferQuantity: "",
  });
  const [result, setResult] = useState(null);
  const [creatingReorder, setCreatingReorder] = useState(false);
  const [reorderMsg, setReorderMsg] = useState("");

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setAllDrugs(rows || []);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAllDrugs([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const canRun = useMemo(() => {
    return (
      form.drugName.trim() &&
      form.currentStock !== "" &&
      form.averageDailyUsage !== "" &&
      form.supplierLeadTimeDays !== ""
    );
  }, [form]);

  const filteredDrugs = useMemo(() => {
    if (!showDrugDropdown) return [];
    return searchDrugMaster(allDrugs, form.drugName, 20);
  }, [allDrugs, form.drugName, showDrugDropdown]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateReorderRequest = async () => {
    if (!result) return;
    setCreatingReorder(true);
    setReorderMsg("");
    try {
      if (!supabase) throw new Error("Supabase not configured.");
      const { error } = await supabase.from("reorder_requests").insert([
        {
          drug_name: form.drugName,
          suggested_qty: Math.ceil(result.recommendedReorderQty),
          risk_level: result.shortageRisk,
          reason: result.decisionReason,
          status: "pending",
        },
      ]);
      if (error) throw error;
      setReorderMsg("Reorder request created successfully.");
    } catch (err) {
      setReorderMsg(`Error: ${err.message || "Failed to create reorder request."}`);
    } finally {
      setCreatingReorder(false);
    }
  };

  const handleRunSimulation = () => {
    const currentStock = Math.max(0, toNumber(form.currentStock));
    const dailyUsage = Math.max(0, toNumber(form.averageDailyUsage));
    const leadTimeDays = Math.max(0, toNumber(form.supplierLeadTimeDays));
    const demandIncrease = toNumber(form.demandIncreasePercent);
    const transferQty = Math.max(0, toNumber(form.transferQuantity));

    const adjustedUsage = dailyUsage * (1 + demandIncrease / 100);

    const projectedDaysLeft =
      adjustedUsage > 0 ? (currentStock + transferQty) / adjustedUsage : Number.POSITIVE_INFINITY;

    const reorderQuantity = adjustedUsage * leadTimeDays;

    const shortageRisk = projectedDaysLeft < leadTimeDays ? "HIGH" : "LOW";

    let bestAction = "MONITOR";
    let decisionReason = "Stock coverage exceeds supplier lead time.";

    if (projectedDaysLeft < leadTimeDays && transferQty < reorderQuantity) {
      bestAction = "REORDER NOW";
      decisionReason = "Remaining stock will not cover supplier lead time.";
    } else if (projectedDaysLeft >= leadTimeDays) {
      bestAction = "TRANSFER STOCK";
      decisionReason = "Transfer quantity removes immediate shortage risk.";
    }

    setResult({
      projectedDailyUsage: adjustedUsage,
      projectedDaysLeft,
      recommendedReorderQty: reorderQuantity,
      shortageRisk,
      bestAction,
      decisionReason,
    });
  };

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div style={eyebrow}>Digital Twin</div>
        <h2 style={title}>Scenario Simulator</h2>
        <p style={subtitle}>
          Simulate inventory behavior before making operational decisions.
        </p>
      </div>

      <div style={formCard}>
        <div style={formGrid}>
          <div style={drugSearchContainer}>
            <input
              style={input}
              placeholder="Drug Name"
              value={form.drugName}
              onChange={(e) => handleChange("drugName", e.target.value)}
              onFocus={() => setShowDrugDropdown(true)}
            />

            {showDrugDropdown && filteredDrugs.length > 0 ? (
              <div style={drugDropdown}>
                {filteredDrugs.map((drug) => (
                  <button
                    key={drug.drug_code || drug.display_name}
                    type="button"
                    style={drugOption}
                    onClick={() => {
                      handleChange("drugName", getDrugDisplayName(drug));
                      setShowDrugDropdown(false);
                    }}
                  >
                    {getDrugDisplayName(drug)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <input
            style={input}
            type="number"
            placeholder="Current Stock"
            value={form.currentStock}
            onChange={(e) => handleChange("currentStock", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Average Daily Usage"
            value={form.averageDailyUsage}
            onChange={(e) => handleChange("averageDailyUsage", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Supplier Lead Time Days"
            value={form.supplierLeadTimeDays}
            onChange={(e) => handleChange("supplierLeadTimeDays", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Demand Increase % (optional)"
            value={form.demandIncreasePercent}
            onChange={(e) => handleChange("demandIncreasePercent", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Transfer Quantity (optional)"
            value={form.transferQuantity}
            onChange={(e) => handleChange("transferQuantity", e.target.value)}
          />
        </div>

        <button type="button" style={runBtn} onClick={handleRunSimulation} disabled={!canRun}>
          Run Simulation
        </button>
      </div>

      {result ? (
        <>
          <div style={statsGrid}>
            <div style={statCard}>
              <div style={statLabel}>Projected Daily Usage</div>
              <div style={statValue}>{result.projectedDailyUsage.toFixed(2)}</div>
            </div>
            <div style={statCard}>
              <div style={statLabel}>Projected Days Left</div>
              <div style={statValue}>
                {Number.isFinite(result.projectedDaysLeft)
                  ? result.projectedDaysLeft.toFixed(1)
                  : "Infinity"}
              </div>
            </div>
            <div style={statCard}>
              <div style={statLabel}>Recommended Reorder Qty</div>
              <div style={statValue}>{Math.ceil(result.recommendedReorderQty)}</div>
            </div>
            <div
              style={{
                ...statCard,
                borderTop:
                  result.shortageRisk === "HIGH" ? "3px solid #ef4444" : "3px solid #16a34a",
              }}
            >
              <div style={statLabel}>Shortage Risk</div>
              <div
                style={{
                  ...statValue,
                  color: result.shortageRisk === "HIGH" ? "#b91c1c" : "#166534",
                }}
              >
                {result.shortageRisk}
              </div>
            </div>
          </div>

          <div
            style={{
              ...statCard,
              borderTop:
                result.bestAction === "REORDER NOW"
                  ? "3px solid #ef4444"
                  : result.bestAction === "TRANSFER STOCK"
                    ? "3px solid #2563eb"
                    : "3px solid #16a34a",
            }}
          >
            <div style={statLabel}>Best Operational Decision</div>
            <div
              style={{
                ...statValue,
                fontSize: "24px",
                color:
                  result.bestAction === "REORDER NOW"
                    ? "#b91c1c"
                    : result.bestAction === "TRANSFER STOCK"
                      ? "#1d4ed8"
                      : "#166534",
              }}
            >
              {result.bestAction}
            </div>
            <p style={decisionReasonText}>{result.decisionReason}</p>
            {result.bestAction === "REORDER NOW" ? (
              <div style={decisionHint}>Suggested Reorder Qty: {Math.ceil(result.recommendedReorderQty)}</div>
            ) : null}

            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <button
                type="button"
                style={reorderBtn}
                onClick={handleCreateReorderRequest}
                disabled={creatingReorder}
              >
                {creatingReorder ? "Creating..." : "Create Reorder Request"}
              </button>
              {reorderMsg ? (
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: reorderMsg.startsWith("Error") ? "#b91c1c" : "#166534",
                  }}
                >
                  {reorderMsg}
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const wrap = {
  display: "grid",
  gap: "16px",
};

const heroCard = {
  background: "linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)",
  borderRadius: "18px",
  padding: "22px",
  border: "1px solid #dbe7f5",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
};

const eyebrow = {
  display: "inline-flex",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#e0ecff",
  color: "#1d4ed8",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "12px",
};

const title = {
  margin: 0,
  color: "#0f172a",
};

const subtitle = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#475569",
  maxWidth: "760px",
  lineHeight: 1.6,
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "9px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const drugSearchContainer = {
  position: "relative",
};

const drugDropdown = {
  position: "absolute",
  top: "44px",
  left: 0,
  right: 0,
  background: "white",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
  zIndex: 20,
  maxHeight: "220px",
  overflowY: "auto",
};

const drugOption = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid #f1f5f9",
  background: "white",
  color: "#0f172a",
  fontSize: "13px",
  cursor: "pointer",
};

const runBtn = {
  marginTop: "12px",
  padding: "10px 14px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
};

const statLabel = {
  color: "#64748b",
  fontSize: "13px",
};

const statValue = {
  marginTop: "10px",
  color: "#0f172a",
  fontSize: "28px",
  fontWeight: 700,
};

const decisionReasonText = {
  marginTop: "10px",
  marginBottom: 0,
  color: "#475569",
  lineHeight: 1.6,
  fontSize: "14px",
};

const decisionHint = {
  marginTop: "10px",
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: 700,
};

const reorderBtn = {
  padding: "10px 18px",
  background: "#0f172a",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "14px",
  fontWeight: 700,
  cursor: "pointer",
};
