import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const riskStyles = {
  high: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" },
  medium: { background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" },
  low: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
};

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysUntil(date) {
  if (!date) return null;
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pickSiteName(row) {
  return (
    row.site_name ||
    row.site ||
    row.location ||
    row.branch ||
    row.from_branch ||
    row.to_branch ||
    "Network Site"
  );
}

function pickDrugName(row) {
  return row.drug_name || row.drugName || "Unknown Drug";
}

async function safeFetch(table, columns) {
  if (!supabase) return { data: [], error: null };
  try {
    const { data, error } = await supabase.from(table).select(columns).limit(5000);
    if (error) return { data: [], error };
    return { data: data || [], error: null };
  } catch (error) {
    return { data: [], error };
  }
}

export default function NetworkIntelligence() {
  const [shortages, setShortages] = useState([]);
  const [refills, setRefills] = useState([]);
  const [expiryRows, setExpiryRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMessage("");

      const [shortageRes, refillRes, expiryRes] = await Promise.all([
        safeFetch("shortage_requests", "drug_name,site_name,site,location,branch,created_at"),
        safeFetch("refill_requests", "drug_name,site_name,site,location,branch,created_at"),
        safeFetch("expiry_records", "drug_name,site_name,site,location,branch,expiry_date,quantity,created_at"),
      ]);

      setShortages(shortageRes.data || []);
      setRefills(refillRes.data || []);
      setExpiryRows(expiryRes.data || []);

      const queryErrors = [shortageRes.error, refillRes.error, expiryRes.error].filter(Boolean);
      if (queryErrors.length > 0) {
        setMessage(
          "Some network data sources are unavailable. Insights are shown using available records."
        );
      }

      setLoading(false);
    };

    void load();
  }, []);

  const siteRows = useMemo(() => {
    const bySite = new Map();

    const ensureSite = (siteNameRaw) => {
      const siteName = String(siteNameRaw || "Network Site").trim() || "Network Site";
      if (!bySite.has(siteName)) {
        bySite.set(siteName, {
          site: siteName,
          shortages: 0,
          nearExpiry: 0,
          refills: 0,
        });
      }
      return bySite.get(siteName);
    };

    shortages.forEach((row) => {
      const site = ensureSite(pickSiteName(row));
      site.shortages += 1;
    });

    refills.forEach((row) => {
      const site = ensureSite(pickSiteName(row));
      site.refills += 1;
    });

    expiryRows.forEach((row) => {
      const site = ensureSite(pickSiteName(row));
      const dte = daysUntil(toDate(row.expiry_date));
      if (dte != null && dte >= 0 && dte <= 60) {
        site.nearExpiry += 1;
      }
    });

    const rows = Array.from(bySite.values()).map((row) => {
      const score = row.shortages * 2 + row.nearExpiry;
      const riskLevel = score >= 10 ? "high" : score >= 4 ? "medium" : "low";
      return {
        ...row,
        riskLevel,
      };
    });

    return rows.sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return (rank[b.riskLevel] || 0) - (rank[a.riskLevel] || 0);
    });
  }, [shortages, refills, expiryRows]);

  const transferRows = useMemo(() => {
    const shortageByDrugSite = new Map();
    const refillByDrugSite = new Map();

    shortages.forEach((row) => {
      const drug = pickDrugName(row);
      const site = pickSiteName(row);
      const key = `${normalizeKey(drug)}::${normalizeKey(site)}`;
      shortageByDrugSite.set(key, (shortageByDrugSite.get(key) || 0) + 1);
    });

    refills.forEach((row) => {
      const drug = pickDrugName(row);
      const site = pickSiteName(row);
      const key = `${normalizeKey(drug)}::${normalizeKey(site)}`;
      refillByDrugSite.set(key, (refillByDrugSite.get(key) || 0) + 1);
    });

    const drugs = new Set([
      ...shortages.map((r) => normalizeKey(pickDrugName(r))),
      ...refills.map((r) => normalizeKey(pickDrugName(r))),
    ]);

    const sites = new Set([
      ...shortages.map((r) => normalizeKey(pickSiteName(r))),
      ...refills.map((r) => normalizeKey(pickSiteName(r))),
      ...expiryRows.map((r) => normalizeKey(pickSiteName(r))),
    ]);

    const originalDrugLabel = {};
    shortages.forEach((r) => {
      const k = normalizeKey(pickDrugName(r));
      if (!originalDrugLabel[k]) originalDrugLabel[k] = pickDrugName(r);
    });
    refills.forEach((r) => {
      const k = normalizeKey(pickDrugName(r));
      if (!originalDrugLabel[k]) originalDrugLabel[k] = pickDrugName(r);
    });

    const originalSiteLabel = {};
    shortages.forEach((r) => {
      const k = normalizeKey(pickSiteName(r));
      if (!originalSiteLabel[k]) originalSiteLabel[k] = pickSiteName(r);
    });
    refills.forEach((r) => {
      const k = normalizeKey(pickSiteName(r));
      if (!originalSiteLabel[k]) originalSiteLabel[k] = pickSiteName(r);
    });
    expiryRows.forEach((r) => {
      const k = normalizeKey(pickSiteName(r));
      if (!originalSiteLabel[k]) originalSiteLabel[k] = pickSiteName(r);
    });

    const suggestions = [];

    drugs.forEach((drugKey) => {
      const shortageSites = [];
      const donorSites = [];

      sites.forEach((siteKey) => {
        const key = `${drugKey}::${siteKey}`;
        const shortageCount = shortageByDrugSite.get(key) || 0;
        const refillCount = refillByDrugSite.get(key) || 0;

        if (shortageCount > 0) shortageSites.push({ siteKey, shortageCount });
        if (shortageCount === 0 && refillCount > 0) donorSites.push({ siteKey, refillCount });
      });

      shortageSites.forEach((target) => {
        donorSites.forEach((donor) => {
          const qty = Math.max(5, Math.min(40, donor.refillCount * 5));
          suggestions.push({
            drugName: originalDrugLabel[drugKey] || "Unknown Drug",
            fromSite: originalSiteLabel[donor.siteKey] || "Network Site",
            toSite: originalSiteLabel[target.siteKey] || "Network Site",
            quantity: qty,
          });
        });
      });
    });

    return suggestions.slice(0, 30);
  }, [shortages, refills, expiryRows]);

  const topNetworkRisks = useMemo(() => {
    const byDrug = new Map();

    shortages.forEach((row) => {
      const drug = pickDrugName(row);
      const key = normalizeKey(drug);
      if (!byDrug.has(key)) {
        byDrug.set(key, { drugName: drug, shortageCount: 0, nearExpiryCount: 0 });
      }
      byDrug.get(key).shortageCount += 1;
    });

    expiryRows.forEach((row) => {
      const dte = daysUntil(toDate(row.expiry_date));
      if (dte == null || dte < 0 || dte > 60) return;
      const drug = pickDrugName(row);
      const key = normalizeKey(drug);
      if (!byDrug.has(key)) {
        byDrug.set(key, { drugName: drug, shortageCount: 0, nearExpiryCount: 0 });
      }
      byDrug.get(key).nearExpiryCount += 1;
    });

    const risks = Array.from(byDrug.values())
      .map((row) => ({
        ...row,
        riskScore: row.shortageCount * 2 + row.nearExpiryCount,
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 8);

    return risks;
  }, [shortages, expiryRows]);

  const summary = useMemo(() => {
    const totalSites = siteRows.length;
    const totalShortageEvents = shortages.length;
    const totalNearExpiryItems = expiryRows.reduce((sum, row) => {
      const dte = daysUntil(toDate(row.expiry_date));
      return dte != null && dte >= 0 && dte <= 60 ? sum + 1 : sum;
    }, 0);

    return {
      totalSites,
      totalShortageEvents,
      totalNearExpiryItems,
      potentialTransferOpportunities: transferRows.length,
    };
  }, [siteRows, shortages, expiryRows, transferRows]);

  return (
    <div style={wrap}>
      <div style={heroCard}>
        <div style={eyebrow}>Operational Intelligence</div>
        <h2 style={title}>Network Intelligence</h2>
        <p style={subtitle}>
          Cross-site view of pharmacy risk, near-expiry pressure, and transfer balancing opportunities.
        </p>
      </div>

      {message ? <div style={messageBox}>{message}</div> : null}

      <div style={statsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Total Sites</div>
          <div style={statValue}>{summary.totalSites}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Total Shortage Events</div>
          <div style={statValue}>{summary.totalShortageEvents}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Total Near Expiry Items</div>
          <div style={statValue}>{summary.totalNearExpiryItems}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Potential Transfers</div>
          <div style={statValue}>{summary.potentialTransferOpportunities}</div>
        </div>
      </div>

      <div style={tableCard}>
        <div style={tableHead}>
          <h3 style={sectionTitleLeft}>Site Comparison</h3>
        </div>
        {loading ? (
          <div style={emptyState}>Loading site network data...</div>
        ) : siteRows.length === 0 ? (
          <div style={emptyState}>No site-level records available.</div>
        ) : (
          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Site Name</th>
                  <th style={th}>Total Shortages</th>
                  <th style={th}>Near Expiry Items</th>
                  <th style={th}>Refill Requests</th>
                  <th style={th}>Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {siteRows.map((row) => (
                  <tr key={row.site}>
                    <td style={tdDrug}>{row.site}</td>
                    <td style={td}>{row.shortages}</td>
                    <td style={td}>{row.nearExpiry}</td>
                    <td style={td}>{row.refills}</td>
                    <td style={td}>
                      <span
                        style={{
                          ...badge,
                          ...(riskStyles[row.riskLevel] || riskStyles.medium),
                        }}
                      >
                        {row.riskLevel.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={tablesGrid}>
        <div style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Transfer Opportunities</h3>
          </div>
          {loading ? (
            <div style={emptyState}>Evaluating transfer opportunities...</div>
          ) : transferRows.length === 0 ? (
            <div style={emptyState}>No transfer opportunities detected.</div>
          ) : (
            <div style={listWrap}>
              {transferRows.map((row, index) => (
                <div key={`${row.drugName}-${row.fromSite}-${row.toSite}-${index}`} style={insightRow}>
                  Transfer {row.quantity} units of {row.drugName} from {row.fromSite} to {row.toSite}.
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={tableCard}>
          <div style={tableHead}>
            <h3 style={sectionTitleLeft}>Top Network Risks</h3>
          </div>
          {loading ? (
            <div style={emptyState}>Analyzing top network risks...</div>
          ) : topNetworkRisks.length === 0 ? (
            <div style={emptyState}>No network risks detected from current records.</div>
          ) : (
            <div style={tableWrap}>
              <table style={tableCompact}>
                <thead>
                  <tr>
                    <th style={th}>Drug Name</th>
                    <th style={th}>Shortages</th>
                    <th style={th}>Near Expiry</th>
                    <th style={th}>Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {topNetworkRisks.map((row) => (
                    <tr key={row.drugName}>
                      <td style={tdDrug}>{row.drugName}</td>
                      <td style={td}>{safeNumber(row.shortageCount)}</td>
                      <td style={td}>{safeNumber(row.nearExpiryCount)}</td>
                      <td style={td}>{safeNumber(row.riskScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
  maxWidth: "860px",
  lineHeight: 1.6,
};

const messageBox = {
  background: "#eff6ff",
  color: "#1d4ed8",
  borderRadius: "12px",
  padding: "12px 14px",
  border: "1px solid #bfdbfe",
  fontSize: "14px",
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  borderTop: "3px solid #e2e8f0",
};

const statLabel = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "8px",
};

const statValue = {
  marginTop: "10px",
  color: "#0f172a",
  fontSize: "30px",
  fontWeight: 700,
};

const tablesGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: "16px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
  overflow: "hidden",
};

const tableHead = {
  padding: "18px 18px 0 18px",
};

const sectionTitleLeft = {
  margin: 0,
  color: "#0f172a",
};

const tableWrap = {
  width: "100%",
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "720px",
};

const tableCompact = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "560px",
};

const th = {
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
  background: "#f8fafc",
  borderBottom: "2px solid #e2e8f0",
  padding: "12px 14px",
};

const td = {
  color: "#334155",
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "14px",
};

const tdDrug = {
  ...td,
  fontWeight: 600,
  color: "#0f172a",
};

const badge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "5px 10px",
};

const listWrap = {
  display: "grid",
  gap: "10px",
  padding: "16px 18px 18px 18px",
};

const insightRow = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  padding: "12px",
  color: "#334155",
  fontSize: "14px",
  lineHeight: 1.6,
};

const emptyState = {
  padding: "24px 18px",
  color: "#64748b",
};
