import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { loadDrugMaster } from "./utils/drugMasterLoader";

function formatToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDisplayDate(dateValue) {
  if (!dateValue) return "";
  const parts = String(dateValue).split("-");
  if (parts.length !== 3) return dateValue;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function initialForm() {
  return {
    patientName: "",
    mrn: "",
    age: "",
    sex: "",
    rxNumber: "",
    doctorName: "",
    brandName: "",
    genericName: "",
    strength: "",
    dosageForm: "",
    directions: "",
    quantity: "",
    duration: "",
    route: "",
    frequency: "",
    dispenseDate: formatToday(),
    pharmacist: "",
    pharmacyName: "FalconMed Pharmacy",
    pharmacyPhone: "",
    pharmacyAddress: "",
    keepOutOfReach: true,
    storageInstruction: "Store below 25°C",
    auxiliaryWarning: "",
    showQr: true,
    labelSize: "62x40",
  };
}

function buildQrPayload(form) {
  return {
    patientName: form.patientName,
    mrn: form.mrn,
    age: form.age,
    sex: form.sex,
    rxNumber: form.rxNumber,
    doctorName: form.doctorName,
    brandName: form.brandName,
    genericName: form.genericName,
    strength: form.strength,
    dosageForm: form.dosageForm,
    directions: form.directions,
    quantity: form.quantity,
    duration: form.duration,
    route: form.route,
    frequency: form.frequency,
    dispenseDate: form.dispenseDate,
    pharmacist: form.pharmacist,
    pharmacyName: form.pharmacyName,
    pharmacyPhone: form.pharmacyPhone,
    pharmacyAddress: form.pharmacyAddress,
    keepOutOfReach: form.keepOutOfReach,
    storageInstruction: form.storageInstruction,
    auxiliaryWarning: form.auxiliaryWarning,
  };
}

const LABEL_SIZES = {
  "50x30": {
    key: "50x30",
    name: "Small Thermal 50 × 30 mm",
    widthPx: 236,
    minHeightPx: 142,
    printWidthMm: 50,
    printHeightMm: 30,
    qr: 54,
    titleSize: 11,
    drugSize: 14,
    bodySize: 8.5,
    smallSize: 7.5,
    padding: 7,
  },
  "62x40": {
    key: "62x40",
    name: "Standard Thermal 62 × 40 mm",
    widthPx: 292,
    minHeightPx: 188,
    printWidthMm: 62,
    printHeightMm: 40,
    qr: 72,
    titleSize: 13,
    drugSize: 18,
    bodySize: 10,
    smallSize: 8.5,
    padding: 9,
  },
  "70x50": {
    key: "70x50",
    name: "Large Thermal 70 × 50 mm",
    widthPx: 330,
    minHeightPx: 236,
    printWidthMm: 70,
    printHeightMm: 50,
    qr: 88,
    titleSize: 14,
    drugSize: 20,
    bodySize: 11,
    smallSize: 9,
    padding: 10,
  },
};

export default function LabelStudio() {
  const [form, setForm] = useState(initialForm);
  const [drugSearch, setDrugSearch] = useState("");
  const [selectedDrugKey, setSelectedDrugKey] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [drugDatabase, setDrugDatabase] = useState([]);
  const [loadingDrugs, setLoadingDrugs] = useState(true);

  const labelRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      setLoadingDrugs(true);
      try {
        const rows = await loadDrugMaster();
        if (!mounted) return;

        const normalized = (Array.isArray(rows) ? rows : [])
          .map((drug, index) => ({
            key: String(index),
            brand: text(drug.brand_name || drug.brand || drug.drug_name),
            generic: text(drug.generic_name || drug.generic),
            strength: text(drug.strength),
            form: text(drug.dosage_form || drug.form),
          }))
          .filter((drug) => drug.brand || drug.generic)
          .sort((a, b) =>
            `${a.brand} ${a.generic}`.localeCompare(`${b.brand} ${b.generic}`)
          );

        if (mounted) {
          setDrugDatabase(normalized);
        }
      } catch {
        if (mounted) {
          setDrugDatabase([]);
        }
      } finally {
        if (mounted) {
          setLoadingDrugs(false);
        }
      }
    };

    void run();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredDrugs = useMemo(() => {
    const q = drugSearch.trim().toLowerCase();

    if (!q) {
      return drugDatabase.slice(0, 50);
    }

    return drugDatabase
      .filter((drug) => {
        return (
          drug.brand.toLowerCase().includes(q) ||
          drug.generic.toLowerCase().includes(q) ||
          drug.strength.toLowerCase().includes(q) ||
          drug.form.toLowerCase().includes(q)
        );
      })
      .slice(0, 50);
  }, [drugSearch, drugDatabase]);

  const qrPayload = useMemo(() => buildQrPayload(form), [form]);

  const warningLines = useMemo(() => {
    const lines = [];
    if (form.keepOutOfReach) {
      lines.push("Keep out of reach of children");
    }
    if (text(form.storageInstruction)) {
      lines.push(text(form.storageInstruction));
    }
    if (text(form.auxiliaryWarning)) {
      lines.push(text(form.auxiliaryWarning));
    }
    return lines;
  }, [form.keepOutOfReach, form.storageInstruction, form.auxiliaryWarning]);

  const activeSize = LABEL_SIZES[form.labelSize] || LABEL_SIZES["62x40"];

  useEffect(() => {
    let active = true;

    async function generateQR() {
      try {
        const payload = JSON.stringify(qrPayload);
        const url = await QRCode.toDataURL(payload, {
          width: Math.max(activeSize.qr * 2, 120),
          margin: 1,
          errorCorrectionLevel: "M",
        });

        if (active) {
          setQrDataUrl(url);
        }
      } catch {
        if (active) {
          setQrDataUrl("");
        }
      }
    }

    if (form.showQr) {
      void generateQR();
    } else {
      setQrDataUrl("");
    }

    return () => {
      active = false;
    };
  }, [qrPayload, form.showQr, activeSize.qr]);

  function updateField(field, value) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function updateCheckbox(field, checked) {
    setForm((prev) => ({
      ...prev,
      [field]: checked,
    }));
  }

  function handleDrugSelect(optionValue) {
    setSelectedDrugKey(optionValue);
    if (!optionValue) return;

    const drug = drugDatabase.find((item) => item.key === optionValue);
    if (!drug) return;

    setForm((prev) => ({
      ...prev,
      brandName: drug.brand,
      genericName: drug.generic,
      strength: drug.strength,
      dosageForm: drug.form,
    }));
  }

  function buildPrintMarkup(labelHtml, size) {
    const width = size.printWidthMm;
    const height = size.printHeightMm;

    return `
      <!doctype html>
      <html>
        <head>
          <title>FalconMed Label</title>
          <meta charset="utf-8" />
          <style>
            @page {
              size: ${width}mm ${height}mm;
              margin: 0;
            }

            html, body {
              margin: 0;
              padding: 0;
              background: #ffffff;
              font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            body {
              width: ${width}mm;
              height: ${height}mm;
              overflow: hidden;
            }

            .print-shell {
              width: ${width}mm;
              height: ${height}mm;
              display: flex;
              align-items: stretch;
              justify-content: stretch;
            }

            .label-paper {
              width: ${width}mm !important;
              min-width: ${width}mm !important;
              max-width: ${width}mm !important;
              min-height: ${height}mm !important;
              height: ${height}mm !important;
              box-sizing: border-box !important;
              border: 1px solid #000 !important;
              border-radius: 0 !important;
              background: #fff !important;
              overflow: hidden !important;
              padding: 1.5mm !important;
              box-shadow: none !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            * {
              box-sizing: border-box;
            }

            .label-directions,
            .label-warnings,
            .label-qr-area {
              page-break-inside: avoid;
              break-inside: avoid;
            }

            .label-paper,
            .label-paper * {
              color: #000 !important;
              text-shadow: none !important;
            }

            img {
              image-rendering: crisp-edges;
            }

            @media print {
              html,
              body {
                margin: 0 !important;
                padding: 0 !important;
                width: ${width}mm;
                height: ${height}mm;
                overflow: hidden;
              }

              .print-shell {
                margin: 0 !important;
                padding: 0 !important;
              }

              .label-paper {
                margin: 0 !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-shell">${labelHtml}</div>
          <script>
            window.onload = function () {
              window.print();
              setTimeout(function () {
                window.close();
              }, 150);
            };
          </script>
        </body>
      </html>
    `;
  }

  function handlePrintLabel() {
    if (!labelRef.current) return;

    const labelHtml = labelRef.current.outerHTML;
    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) return;

    printWindow.document.write(buildPrintMarkup(labelHtml, activeSize));
    printWindow.document.close();
  }

  const previewPaperStyle = {
    ...labelPaper,
    width: `${activeSize.widthPx}px`,
    maxWidth: `${activeSize.widthPx}px`,
    minHeight: `${activeSize.minHeightPx}px`,
    padding: `${activeSize.padding}px`,
    borderRadius: "8px",
  };

  const pharmacyNameStyle = {
    ...pharmacyName,
    fontSize: `${activeSize.titleSize}px`,
  };

  const pharmacyLineStyle = {
    ...pharmacyLine,
    fontSize: `${activeSize.smallSize}px`,
  };

  const kvLineStyle = {
    ...kvLine,
    fontSize: `${activeSize.bodySize}px`,
  };

  const drugHeadlineStyle = {
    ...drugHeadline,
    fontSize: `${activeSize.drugSize + 1}px`,
  };

  const genericLineStyle = {
    ...genericLine,
    fontSize: `${activeSize.bodySize}px`,
  };

  const drugMetaRowStyle = {
    ...drugMetaRow,
    fontSize: `${activeSize.bodySize}px`,
  };

  const compactBadgeStyle = {
    ...compactBadge,
    fontSize: `${activeSize.smallSize}px`,
  };

  const warningTitleStyle = {
    ...warningTitle,
    fontSize: `${activeSize.smallSize}px`,
  };

  const warningItemStyle = {
    ...warningItem,
    fontSize: `${activeSize.smallSize}px`,
  };

  const qrImageStyle = {
    ...qrImage,
    width: `${activeSize.qr + 6}px`,
    height: `${activeSize.qr + 6}px`,
  };

  return (
    <div style={pageWrap}>
      <div style={headerCard}>
        <h2 style={title}>Pharmacy Label Generator</h2>
        <p style={subtitle}>
          Professional thermal label workflow for dispensing and patient safety.
        </p>
      </div>

      <div style={layoutGrid}>
        <div style={formCard}>
          <h3 style={sectionTitle}>Label Form</h3>

          <div style={groupBlock}>
            <div style={groupTitle}>Drug Search</div>

            <div style={fieldGroup}>
              <label style={label}>Search Drug</label>
              <input
                style={input}
                value={drugSearch}
                onChange={(e) => setDrugSearch(e.target.value)}
                placeholder="Type brand, generic, strength, or form"
              />
            </div>

            <div style={fieldGroup}>
              <label style={label}>Select Result</label>
              <select
                style={input}
                value={selectedDrugKey}
                onChange={(e) => handleDrugSelect(e.target.value)}
              >
                <option value="">
                  {loadingDrugs ? "Loading drugs..." : "Choose a drug..."}
                </option>
                {filteredDrugs.map((drug) => (
                  <option key={drug.key} value={drug.key}>
                    {[drug.brand, drug.generic, drug.strength, drug.form]
                      .filter(Boolean)
                      .join(" - ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Patient Information</div>
            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Patient Name</label>
                <input
                  style={input}
                  value={form.patientName}
                  onChange={(e) => updateField("patientName", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>MRN</label>
                <input
                  style={input}
                  value={form.mrn}
                  onChange={(e) => updateField("mrn", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Age</label>
                <input
                  style={input}
                  value={form.age}
                  onChange={(e) => updateField("age", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Sex</label>
                <input
                  style={input}
                  value={form.sex}
                  onChange={(e) => updateField("sex", e.target.value)}
                  placeholder="Male / Female"
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Prescription Information</div>
            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Rx Number</label>
                <input
                  style={input}
                  value={form.rxNumber}
                  onChange={(e) => updateField("rxNumber", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Doctor Name</label>
                <input
                  style={input}
                  value={form.doctorName}
                  onChange={(e) => updateField("doctorName", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Drug Information</div>
            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Brand Name</label>
                <input
                  style={input}
                  value={form.brandName}
                  onChange={(e) => updateField("brandName", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Generic Name</label>
                <input
                  style={input}
                  value={form.genericName}
                  onChange={(e) => updateField("genericName", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Strength</label>
                <input
                  style={input}
                  value={form.strength}
                  onChange={(e) => updateField("strength", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Dosage Form</label>
                <input
                  style={input}
                  value={form.dosageForm}
                  onChange={(e) => updateField("dosageForm", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Directions</div>
            <div style={fieldGroup}>
              <label style={label}>Directions</label>
              <textarea
                style={textarea}
                value={form.directions}
                onChange={(e) => updateField("directions", e.target.value)}
                placeholder="Take as directed"
              />
            </div>

            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Quantity</label>
                <input
                  style={input}
                  value={form.quantity}
                  onChange={(e) => updateField("quantity", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Duration</label>
                <input
                  style={input}
                  value={form.duration}
                  onChange={(e) => updateField("duration", e.target.value)}
                  placeholder="e.g. 7 days"
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Route</label>
                <input
                  style={input}
                  value={form.route}
                  onChange={(e) => updateField("route", e.target.value)}
                  placeholder="Oral / IV / Topical"
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Frequency</label>
                <input
                  style={input}
                  value={form.frequency}
                  onChange={(e) => updateField("frequency", e.target.value)}
                  placeholder="BID / TID / Once daily"
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Dispense</div>
            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Dispense Date</label>
                <input
                  style={input}
                  type="date"
                  value={form.dispenseDate}
                  onChange={(e) => updateField("dispenseDate", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Pharmacist</label>
                <input
                  style={input}
                  value={form.pharmacist}
                  onChange={(e) => updateField("pharmacist", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Pharmacy Info</div>
            <div style={fieldGroup}>
              <label style={label}>Pharmacy Name</label>
              <input
                style={input}
                value={form.pharmacyName}
                onChange={(e) => updateField("pharmacyName", e.target.value)}
              />
            </div>

            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Phone</label>
                <input
                  style={input}
                  value={form.pharmacyPhone}
                  onChange={(e) => updateField("pharmacyPhone", e.target.value)}
                />
              </div>
              <div style={fieldGroup}>
                <label style={label}>Address</label>
                <input
                  style={input}
                  value={form.pharmacyAddress}
                  onChange={(e) => updateField("pharmacyAddress", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div style={groupBlock}>
            <div style={groupTitle}>Warnings & Thermal Options</div>

            <div style={checkboxRow}>
              <input
                id="keepOutOfReach"
                type="checkbox"
                checked={form.keepOutOfReach}
                onChange={(e) => updateCheckbox("keepOutOfReach", e.target.checked)}
              />
              <label htmlFor="keepOutOfReach" style={checkboxLabel}>
                Keep out of reach of children
              </label>
            </div>

            <div style={checkboxRow}>
              <input
                id="showQr"
                type="checkbox"
                checked={form.showQr}
                onChange={(e) => updateCheckbox("showQr", e.target.checked)}
              />
              <label htmlFor="showQr" style={checkboxLabel}>
                Show QR code on label
              </label>
            </div>

            <div style={twoCol}>
              <div style={fieldGroup}>
                <label style={label}>Storage Instruction</label>
                <input
                  style={input}
                  value={form.storageInstruction}
                  onChange={(e) => updateField("storageInstruction", e.target.value)}
                  placeholder="Store below 25°C"
                />
              </div>

              <div style={fieldGroup}>
                <label style={label}>Auxiliary Warning</label>
                <input
                  style={input}
                  value={form.auxiliaryWarning}
                  onChange={(e) => updateField("auxiliaryWarning", e.target.value)}
                  placeholder="Shake well before use"
                />
              </div>
            </div>

            <div style={fieldGroup}>
              <label style={label}>Thermal Label Size</label>
              <select
                style={input}
                value={form.labelSize}
                onChange={(e) => updateField("labelSize", e.target.value)}
              >
                {Object.values(LABEL_SIZES).map((size) => (
                  <option key={size.key} value={size.key}>
                    {size.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="button" style={printButton} onClick={handlePrintLabel}>
            Print Label
          </button>
        </div>

        <div style={previewCard}>
          <h3 style={sectionTitle}>Label Preview</h3>
          <p style={previewHint}>
            Thermal layout updates automatically based on selected size.
          </p>

          <div ref={labelRef} className="label-paper" style={previewPaperStyle}>
            <div style={topRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={pharmacyNameStyle}>
                  {form.pharmacyName || "FalconMed Pharmacy"}
                </p>
                <p style={pharmacyLineStyle}>{form.pharmacyAddress || "Address"}</p>
                <p style={pharmacyLineStyle}>{form.pharmacyPhone || "Phone"}</p>
              </div>

              <div style={rxBadge}>
                <span style={compactBadgeStyle}>
                  Rx {form.rxNumber ? `#${form.rxNumber}` : "#-"}
                </span>
              </div>
            </div>

            <div style={divider} />

            <div style={patientRow}>
              <p style={kvLineStyle}>
                <strong>Patient:</strong> {form.patientName || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>MRN:</strong> {form.mrn || "-"}
              </p>
            </div>

            <div style={patientRow}>
              <p style={kvLineStyle}>
                <strong>Age:</strong> {form.age || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>Sex:</strong> {form.sex || "-"}
              </p>
            </div>

            <div style={divider} />

            <p style={drugHeadlineStyle} className="label-drug-name">
              {form.brandName || "Drug name"}
            </p>
            <p style={genericLineStyle}>{form.genericName || "Generic name"}</p>

            <div style={drugMetaRowStyle}>
              <span>
                <strong>Strength:</strong> {form.strength || "-"}
              </span>
              <span>
                <strong>Form:</strong> {form.dosageForm || "-"}
              </span>
            </div>

            {(form.route || form.frequency) && (
              <div style={drugMetaRowStyle}>
                <span>
                  <strong>Route:</strong> {form.route || "-"}
                </span>
                <span>
                  <strong>Frequency:</strong> {form.frequency || "-"}
                </span>
              </div>
            )}

            <div style={divider} />

            <div style={directionsBox} className="label-directions">
              <p style={directionsTitle}>Directions</p>
              <p style={directionsText}>
                {form.directions || "No directions entered"}
              </p>
            </div>

            <div style={infoGrid}>
              <p style={kvLineStyle}>
                <strong>Qty:</strong> {form.quantity || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>Duration:</strong> {form.duration || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>Date:</strong> {toDisplayDate(form.dispenseDate) || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>Doctor:</strong> {form.doctorName || "-"}
              </p>
              <p style={kvLineStyle}>
                <strong>Pharmacist:</strong> {form.pharmacist || "-"}
              </p>
            </div>

            <div style={warningBox} className="label-warnings">
              <p style={warningTitleStyle}>Warnings</p>
              {warningLines.length > 0 ? (
                warningLines.map((line) => (
                  <p key={line} style={warningItemStyle}>
                    {line}
                  </p>
                ))
              ) : (
                <p style={warningItemStyle}>None documented</p>
              )}
            </div>

            {form.showQr ? (
              <div style={qrAndFooter} className="label-qr-area">
                <div style={qrWrap}>
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Medication QR" style={qrImageStyle} />
                  ) : (
                    <div style={qrFallback}>Generating QR...</div>
                  )}
                </div>

                <div style={scanHintWrap}>
                  <p style={scanHintTitle}>Scan QR</p>
                  <p style={scanHintText}>For medication and dispensing details</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const pageWrap = {
  display: "grid",
  gap: "16px",
};

const headerCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "20px 22px",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
};

const title = {
  margin: 0,
  color: "#0f172a",
  fontSize: "24px",
  letterSpacing: "-0.01em",
};

const subtitle = {
  marginTop: "8px",
  marginBottom: 0,
  color: "#475569",
  fontSize: "14px",
};

const layoutGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(360px, 1fr) minmax(360px, 0.95fr)",
  gap: "16px",
  alignItems: "start",
};

const formCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 10px 26px rgba(15, 23, 42, 0.07)",
};

const previewCard = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 10px 26px rgba(15, 23, 42, 0.07)",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "12px",
  fontSize: "18px",
  fontWeight: 700,
  color: "#0f172a",
};

const previewHint = {
  marginTop: 0,
  marginBottom: "12px",
  color: "#64748b",
  fontSize: "12px",
};

const groupBlock = {
  border: "1px solid #e9eef5",
  borderRadius: "12px",
  padding: "12px",
  marginBottom: "12px",
  background: "#fcfdff",
};

const groupTitle = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#475569",
  fontWeight: 700,
  marginBottom: "10px",
};

const twoCol = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "10px",
};

const fieldGroup = {
  marginBottom: "10px",
};

const checkboxRow = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "10px",
};

const checkboxLabel = {
  fontSize: "13px",
  color: "#334155",
};

const label = {
  display: "block",
  marginBottom: "6px",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#64748b",
  fontWeight: 700,
};

const input = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cfd9e6",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  background: "#ffffff",
};

const textarea = {
  ...input,
  minHeight: "72px",
  resize: "vertical",
  fontFamily: "inherit",
};

const printButton = {
  border: "1px solid #0f4c81",
  background: "linear-gradient(135deg, #0f4c81 0%, #166091 100%)",
  color: "#ffffff",
  borderRadius: "10px",
  padding: "10px 14px",
  fontWeight: 700,
  fontSize: "14px",
  cursor: "pointer",
  boxShadow: "0 10px 20px rgba(15, 76, 129, 0.25)",
};

const labelPaper = {
  boxSizing: "border-box",
  border: "1px solid #111827",
  background: "#ffffff",
  color: "#0f172a",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.08)",
  overflow: "hidden",
  fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
};

const topRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "10px",
};

const pharmacyName = {
  margin: 0,
  fontWeight: 800,
  lineHeight: 1.08,
  letterSpacing: "-0.01em",
  color: "#0f172a",
};

const pharmacyLine = {
  margin: "3px 0 0",
  color: "#1f2937",
  lineHeight: 1.25,
};

const rxBadge = {
  display: "flex",
  alignItems: "flex-start",
};

const compactBadge = {
  display: "inline-block",
  border: "1px solid #bfdbfe",
  background: "#eff6ff",
  color: "#0f172a",
  borderRadius: "999px",
  padding: "4px 8px",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const divider = {
  height: "1px",
  background: "#d1dbe8",
  margin: "8px 0",
};

const patientRow = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
  alignItems: "start",
};

const kvLine = {
  margin: 0,
  color: "#0f172a",
  lineHeight: 1.32,
  wordBreak: "break-word",
};

const drugHeadline = {
  margin: "2px 0 0",
  lineHeight: 1.04,
  fontWeight: 900,
  letterSpacing: "-0.012em",
  color: "#0f172a",
  wordBreak: "break-word",
};

const genericLine = {
  margin: "4px 0 0",
  color: "#334155",
  lineHeight: 1.25,
  wordBreak: "break-word",
};

const drugMetaRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: "9px",
  marginTop: "5px",
  color: "#0f172a",
};

const directionsBox = {
  border: "1px solid #d4deea",
  background: "#f8fafc",
  borderRadius: "8px",
  padding: "8px 9px",
};

const directionsTitle = {
  margin: "0 0 4px",
  fontSize: "8.5px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#334155",
};

const directionsText = {
  margin: 0,
  fontSize: "10.5px",
  lineHeight: 1.4,
  color: "#0f172a",
  wordBreak: "break-word",
};

const infoGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "6px 9px",
  marginTop: "8px",
};

const warningBox = {
  marginTop: "9px",
  border: "1px solid #f8b4b4",
  background: "#fff6f6",
  borderRadius: "8px",
  padding: "8px 9px",
};

const warningTitle = {
  margin: "0 0 5px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#991b1b",
};

const warningItem = {
  margin: "0 0 3px",
  color: "#7f1d1d",
  lineHeight: 1.3,
  wordBreak: "break-word",
};

const qrAndFooter = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  marginTop: "9px",
};

const qrWrap = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  border: "1px solid #dbe3ee",
  borderRadius: "6px",
  padding: "3px",
  background: "#ffffff",
};

const qrImage = {
  display: "block",
};

const scanHintWrap = {
  flex: 1,
  minWidth: 0,
};

const scanHintTitle = {
  margin: 0,
  fontSize: "9.5px",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#1f2937",
};

const scanHintText = {
  margin: "3px 0 0",
  fontSize: "8.75px",
  lineHeight: 1.3,
  color: "#334155",
};

const qrFallback = {
  fontSize: "11px",
  color: "#64748b",
};