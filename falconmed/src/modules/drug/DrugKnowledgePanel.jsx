import { useMemo } from "react";

const KNOWLEDGE_BASE = {
  amoxicillin: {
    typicalAdultDose: "500 mg every 8 hours",
    commonIndication: "Bacterial infections",
    warnings: ["Take with food", "Finish full course"],
    labels: ["Take with food", "Finish full course", "Do not skip doses"],
  },
  metformin: {
    typicalAdultDose: "500 mg once to twice daily with meals",
    commonIndication: "Type 2 diabetes",
    warnings: ["Take with meals", "Monitor blood glucose"],
    labels: ["Take with food", "Monitor blood glucose", "Avoid missed doses"],
  },
  enoxaparin: {
    typicalAdultDose: "40 mg once daily (prophylaxis)",
    commonIndication: "DVT prophylaxis and anticoagulation",
    warnings: ["Use injection technique carefully", "Watch for bleeding signs"],
    labels: ["Use as directed", "Monitor for bleeding", "Do not double dose"],
  },
  paracetamol: {
    typicalAdultDose: "500-1000 mg every 6-8 hours as needed",
    commonIndication: "Pain and fever",
    warnings: ["Do not exceed maximum daily dose", "Avoid duplicate acetaminophen products"],
    labels: ["Do not exceed recommended dose", "Avoid alcohol", "Use as needed"],
  },
};

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function inferKnowledge(drug) {
  const brand = normalize(drug?.brand || drug?.drugName);
  const generic = normalize(drug?.generic || "");
  const key = Object.keys(KNOWLEDGE_BASE).find(
    (entry) => brand.includes(entry) || generic.includes(entry)
  );

  const match = key ? KNOWLEDGE_BASE[key] : null;

  const dosageForm = String(drug?.dosage_form || drug?.dosageForm || "").trim();
  const defaultWarnings = [
    "Use as directed",
    "Store below recommended temperature",
  ];
  if (/suspension|syrup|solution/i.test(dosageForm)) {
    defaultWarnings.push("Shake well before use");
  }

  return {
    genericName: String(drug?.generic || drug?.drugName || "-") || "-",
    typicalAdultDose: match?.typicalAdultDose || "Consult local protocol",
    commonIndication: match?.commonIndication || "See prescribing guidance",
    warnings: match?.warnings || defaultWarnings,
    labels: match?.labels || ["Use as directed", "Read label before use", "Keep out of reach of children"],
  };
}

export default function DrugKnowledgePanel({ drug }) {
  const knowledge = useMemo(() => inferKnowledge(drug), [drug]);

  if (!drug) {
    return (
      <div style={card}>
        <h3 style={title}>Drug Knowledge</h3>
        <p style={emptyText}>Select or enter a drug to view quick pharmacist guidance.</p>
      </div>
    );
  }

  return (
    <div style={card}>
      <h3 style={title}>Drug Knowledge</h3>

      <div style={section}>
        <div style={label}>Generic</div>
        <div style={value}>{knowledge.genericName}</div>
      </div>

      <div style={section}>
        <div style={label}>Typical Dose</div>
        <div style={value}>{knowledge.typicalAdultDose}</div>
      </div>

      <div style={section}>
        <div style={label}>Common Use</div>
        <div style={value}>{knowledge.commonIndication}</div>
      </div>

      <div style={section}>
        <div style={label}>Warnings</div>
        <ul style={list}>
          {knowledge.warnings.map((item) => (
            <li key={item} style={listItem}>{item}</li>
          ))}
        </ul>
      </div>

      <div style={section}>
        <div style={label}>Label Suggestions</div>
        <ul style={list}>
          {knowledge.labels.map((item) => (
            <li key={item} style={listItem}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const card = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  border: "1px solid #eef2f7",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.04)",
};

const title = {
  marginTop: 0,
  marginBottom: "14px",
  fontSize: "20px",
  fontWeight: 600,
  color: "#0f172a",
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "10px",
};

const section = {
  marginBottom: "12px",
};

const label = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#64748b",
  marginBottom: "4px",
};

const value = {
  color: "#0f172a",
  fontSize: "14px",
  lineHeight: 1.5,
};

const list = {
  margin: "0",
  paddingLeft: "18px",
};

const listItem = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: 1.45,
  marginBottom: "4px",
};

const emptyText = {
  margin: 0,
  color: "#64748b",
  fontSize: "14px",
};
