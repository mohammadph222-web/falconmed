export const LABEL_TYPES = [
  { id: "patient", name: "Patient Medication Label" },
  { id: "shelf", name: "Shelf Label" },
  { id: "drawer", name: "Drawer Label" },
  { id: "refrigerator", name: "Refrigerator Label" },
  { id: "auxiliary", name: "Auxiliary Warning Label" },
];

function text(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function buildQrPayload(form) {
  return {
    drug_name: text(form.drugName, ""),
    dose: text(form.doseInstructions, ""),
    rx_number: text(form.rxNumber, ""),
    timestamp: new Date().toISOString(),
  };
}

export function buildLabelPreview(form, labelType) {
  const title = `${text(form.drugName, "Medication")} ${text(form.strength, "")}`.trim();
  const dosageForm = text(form.dosageForm, "");
  const instructions = text(form.doseInstructions, "Use as directed");
  const daysSupply = text(form.daysSupply, "-");
  const rx = text(form.rxNumber, "");

  if (labelType === "patient") {
    return {
      header: "Patient Medication Label",
      lines: [title, dosageForm, "", instructions, `Days Supply: ${daysSupply}`],
      footer: rx !== "-" ? `RX: ${rx}` : "",
    };
  }

  if (labelType === "shelf") {
    return {
      header: "Shelf Label",
      lines: [title, dosageForm, `Stocking Guidance: ${instructions}`],
      footer: rx !== "-" ? `Ref: ${rx}` : "",
    };
  }

  if (labelType === "drawer") {
    return {
      header: "Drawer Label",
      lines: [title, dosageForm, `Dispense Note: ${instructions}`],
      footer: rx !== "-" ? `Ref: ${rx}` : "",
    };
  }

  if (labelType === "refrigerator") {
    return {
      header: "Refrigerator Label",
      lines: [title, dosageForm, "Storage: Refrigerate", instructions],
      footer: rx !== "-" ? `Ref: ${rx}` : "",
    };
  }

  return {
    header: "Auxiliary Warning Label",
    lines: [title, dosageForm, "Warning", instructions],
    footer: rx !== "-" ? `Ref: ${rx}` : "",
  };
}
