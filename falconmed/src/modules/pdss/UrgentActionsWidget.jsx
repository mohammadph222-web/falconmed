import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  buildPdssActionItems,
  calculateExpiryIntelligence,
  calculateShortagePredictions,
  calculateSmartTransferRecommendations,
  topUrgentActions,
} from "../../utils/pdss";

async function safeFetch(table, columns) {
  if (!supabase) return { data: [], error: null };

  try {
    const { data, error } = await supabase.from(table).select(columns).limit(2500);
    if (error) return { data: [], error };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: [], error };
  }
}

function loadLocalArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

const priorityStyles = {
  high: { background: "#fee2e2", color: "#991b1b" },
  medium: { background: "#fef3c7", color: "#92400e" },
  low: { background: "#dcfce7", color: "#166534" },
};

export default function UrgentActionsWidget({ onViewAll }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const [shortageRes, refillRes, expiryRes] = await Promise.all([
        safeFetch(
          "shortage_requests",
          "drug_name,quantity_requested,status,request_date,created_at"
        ),
        safeFetch(
          "refill_requests",
          "drug_name,daily_usage,dispensed,quantity,request_date,created_at"
        ),
        safeFetch(
          "expiry_records",
          "id,drug_name,batch_no,expiry_date,quantity,notes,created_at"
        ),
      ]);

      const shortages = [
        ...(shortageRes.data || []),
        ...loadLocalArray("falconmed_shortages"),
      ];
      const refills = [
        ...(refillRes.data || []),
        ...loadLocalArray("falconmed_refills"),
      ];
      const expiryRecords = expiryRes.data || [];

      const shortageRows = calculateShortagePredictions({
        shortages,
        refills,
        expiryRecords,
      });
      const expiryRows = calculateExpiryIntelligence({ expiryRecords, refills });
      const transferRows = calculateSmartTransferRecommendations({
        shortages,
        refills,
        expiryRecords,
      });

      const normalized = buildPdssActionItems({
        shortageRows,
        expiryRows,
        transferRows,
      });

      setActions(topUrgentActions(normalized, 5));
      setLoading(false);
    };

    void load();
  }, []);

  const top = useMemo(() => actions.slice(0, 5), [actions]);

  return (
    <div>
      <div style={headRow}>
        <h3 style={title}>Urgent Actions</h3>
        <button type="button" style={viewAllBtn} onClick={onViewAll}>
          View All Actions
        </button>
      </div>

      {loading ? (
        <div style={empty}>Loading urgent actions...</div>
      ) : top.length === 0 ? (
        <div style={empty}>No urgent actions right now.</div>
      ) : (
        <div style={listWrap}>
          {top.map((item) => (
            <div key={item.id} style={itemRow}>
              <span style={{ ...badge, ...(priorityStyles[item.priority] || priorityStyles.medium) }}>
                {String(item.priority || "medium").toUpperCase()}
              </span>
              <div style={itemBody}>
                <div style={itemTitle}>{item.action} - {item.drugName}</div>
                <div style={itemDetails}>{item.details}</div>
              </div>
              <div style={itemQty}>{item.suggestedQuantity || 0}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const headRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "12px",
};
const title = { margin: 0, color: "#0f172a" };
const viewAllBtn = {
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  borderRadius: "10px",
  padding: "8px 12px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};
const listWrap = { display: "grid", gap: "10px" };
const itemRow = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "10px",
  padding: "10px",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  background: "#f8fafc",
};
const itemBody = { minWidth: 0 };
const itemTitle = { fontWeight: 600, color: "#0f172a" };
const itemDetails = { fontSize: "13px", color: "#64748b", marginTop: "4px" };
const itemQty = { fontWeight: 700, color: "#0f172a", minWidth: "36px", textAlign: "right" };
const badge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "4px 8px",
};
const empty = { color: "#64748b", padding: "6px 0" };
