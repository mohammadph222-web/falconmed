import { useEffect, useMemo, useState } from "react";
import {
  getDrugDisplayName,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMasterLoader";

function toMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export default function DrugSearch() {
  const [drugs, setDrugs] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (mounted) setDrugs(rows || []);
      })
      .catch((error) => {
        console.error("Failed to load drug master:", error);
        if (mounted) setDrugs([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const results = useMemo(() => {
    return searchDrugMaster(drugs, query, 50);
  }, [drugs, query]);

  const totalDrugs = drugs.length;
  const resultsLabel = `${results.length} results`;

  return (
    <div style={page}>
      <section style={heroCard}>
        <div style={heroEyebrow}>Catalog Intelligence</div>
        <h1 style={title}>Drug Search</h1>
        <p style={subtitle}>
          FalconMed Drug Master - Search by brand, generic, strength, or dosage form
        </p>
      </section>

      <section style={panelCard}>
        <div style={panelHeaderRow}>
          <h2 style={panelTitle}>Search</h2>
          <span style={resultCount}>{resultsLabel}</span>
        </div>

        <div style={searchGrid}>
          <label style={fieldGroup}>
            <span style={fieldLabel}>Drug Query</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type drug name, generic, strength, or form..."
              style={searchInput}
            />
          </label>
        </div>
      </section>

      <section style={summaryGrid}>
        <article style={summaryCard}>
          <span style={summaryLabel}>Total catalog items</span>
          <strong style={summaryValue}>{totalDrugs}</strong>
        </article>
        <article style={summaryCard}>
          <span style={summaryLabel}>Current matches</span>
          <strong style={summaryValue}>{results.length}</strong>
        </article>
      </section>

      {loading ? (
        <section style={stateCard}>
          <div style={stateText}>Loading drug master...</div>
        </section>
      ) : null}

      {!loading && results.length === 0 ? (
        <section style={stateCard}>
          <div style={stateText}>No matching medicines found.</div>
        </section>
      ) : null}

      {!loading && results.length > 0 ? (
        <section style={panelCard}>
          <div style={panelHeaderRow}>
            <h2 style={panelTitle}>Results</h2>
            <span style={resultCount}>{resultsLabel}</span>
          </div>

          <div style={tableWrap}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Drug Name</th>
                  <th style={th}>Form</th>
                  <th style={th}>Package</th>
                  <th style={th}>Pack Size</th>
                  <th style={th}>Public Pack Price</th>
                  <th style={th}>Pharmacy Pack Price</th>
                  <th style={th}>Public Unit Price</th>
                  <th style={th}>Pharmacy Unit Price</th>
                </tr>
              </thead>

              <tbody>
                {results.map((drug) => (
                  <tr key={drug.id} style={tr}>
                    <td style={tdDrug}>
                      <div style={drugName}>{getDrugDisplayName(drug)}</div>
                      <div style={drugMeta}>{drug.drug_code || "-"}</div>
                    </td>

                    <td style={td}>{drug.dosage_form || "-"}</td>

                    <td style={td}>{drug.package_size_raw || "-"}</td>

                    <td style={td}>{drug.normalized_pack_size}</td>

                    <td style={td}>AED {toMoney(drug.public_pack_price)}</td>

                    <td style={td}>AED {toMoney(drug.pharmacy_pack_price)}</td>

                    <td style={td}>AED {toMoney(drug.public_unit_price)}</td>

                    <td style={td}>AED {toMoney(drug.pharmacy_unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const tokens = {
  bg: "#f3f6fb",
  card: "#ffffff",
  border: "#e6ecf4",
  borderSoft: "#eef3f8",
  text: "#0f172a",
  textMuted: "#4b5563",
  textSubtle: "#6b7280",
  primary: "#2563eb",
};

const page = {
  minHeight: "100%",
  padding: "30px",
  display: "grid",
  gap: "20px",
  background: tokens.bg,
};

const heroCard = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: "20px",
  padding: "24px 24px",
  boxShadow: "0 18px 34px rgba(15, 23, 42, 0.065)",
  backgroundImage:
    "radial-gradient(circle at 100% 0%, rgba(37, 99, 235, 0.08), transparent 44%)",
};

const heroEyebrow = {
  marginBottom: "8px",
  fontSize: "10.5px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "#61728a",
};

const title = {
  margin: 0,
  fontSize: "34px",
  lineHeight: 1.2,
  letterSpacing: "-0.02em",
  color: tokens.text,
  fontWeight: 700,
};

const subtitle = {
  margin: "11px 0 0",
  color: tokens.textMuted,
  fontSize: "14px",
  lineHeight: 1.62,
};

const panelCard = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: "18px",
  padding: "20px 20px 16px",
  display: "grid",
  gap: "14px",
  boxShadow: "0 14px 28px rgba(15, 23, 42, 0.055)",
};

const panelHeaderRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const panelTitle = {
  margin: 0,
  fontSize: "18px",
  color: tokens.text,
  fontWeight: 700,
};

const searchGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 1fr)",
  gap: "14px",
};

const fieldGroup = {
  display: "grid",
  gap: "8px",
};

const fieldLabel = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: tokens.textSubtle,
  fontWeight: 600,
};

const searchInput = {
  width: "100%",
  border: `1px solid #d8e2f0`,
  borderRadius: "12px",
  padding: "13px 14px",
  fontSize: "14px",
  color: tokens.text,
  outline: "none",
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const summaryCard = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: "14px",
  padding: "15px 16px",
  display: "grid",
  gap: "7px",
  boxShadow: "0 10px 20px rgba(15, 23, 42, 0.045)",
};

const stateCard = {
  border: `1px dashed #d8e2f0`,
  borderRadius: "14px",
  background: "linear-gradient(180deg, #ffffff 0%, #f9fcff 100%)",
  padding: "16px 18px",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.035)",
};

const summaryLabel = {
  fontSize: "12px",
  color: tokens.textSubtle,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 600,
};

const summaryValue = {
  fontSize: "22px",
  lineHeight: 1.2,
  color: tokens.text,
};

const resultCount = {
  fontSize: "12px",
  color: tokens.primary,
  fontWeight: 600,
  background: "#eff6ff",
  border: "1px solid #dbeafe",
  borderRadius: "999px",
  padding: "5px 10px",
};

const stateText = {
  color: tokens.textMuted,
  fontSize: "14px",
  padding: "2px 2px",
};

const tableWrap = {
  border: `1px solid ${tokens.borderSoft}`,
  borderRadius: "14px",
  overflowX: "auto",
  background: "#ffffff",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
};

const table = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: "1200px",
};

const th = {
  padding: "13px 14px",
  textAlign: "left",
  borderBottom: `1px solid ${tokens.border}`,
  fontSize: "12px",
  color: tokens.textSubtle,
  background: "#f9fbfe",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 650,
  whiteSpace: "nowrap",
};

const tr = {
  background: "#ffffff",
};

const td = {
  padding: "14px",
  borderBottom: `1px solid ${tokens.borderSoft}`,
  fontSize: "13px",
  color: tokens.text,
  lineHeight: 1.45,
  verticalAlign: "top",
};

const tdDrug = {
  padding: "14px",
  borderBottom: `1px solid ${tokens.borderSoft}`,
  fontSize: "13px",
  color: tokens.text,
  minWidth: "340px",
  maxWidth: "440px",
  lineHeight: 1.45,
  verticalAlign: "top",
};

const drugName = {
  fontWeight: 650,
  fontSize: "14px",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

const drugMeta = {
  marginTop: "5px",
  color: tokens.textSubtle,
  fontSize: "12px",
};
