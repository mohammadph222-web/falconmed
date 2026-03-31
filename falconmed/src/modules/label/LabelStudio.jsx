import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import DrugKnowledgePanel from "../drug/DrugKnowledgePanel";
import { LABEL_TYPES, buildLabelPreview, buildQrPayload } from "../../utils/labelTemplates";

export default function LabelStudio() {
  const [labelType, setLabelType] = useState("patient");
  const [form, setForm] = useState({
    drugName: "",
    strength: "",
    dosageForm: "",
    doseInstructions: "",
    daysSupply: "",
    rxNumber: "",
  });
  const [qrDataUrl, setQrDataUrl] = useState("");
  const labelRef = useRef(null);

  const preview = useMemo(() => buildLabelPreview(form, labelType), [form, labelType]);

  const selectedDrug = useMemo(() => {
    const drugName = String(form.drugName || "").trim();
    if (!drugName) return null;

    return {
      drugName,
      generic: drugName,
      dosageForm: form.dosageForm,
      strength: form.strength,
    };
  }, [form]);

  const qrPayload = useMemo(() => buildQrPayload(form), [form]);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      try {
        const payload = JSON.stringify(qrPayload);
        const dataUrl = await QRCode.toDataURL(payload, {
          width: 120,
          margin: 1,
          errorCorrectionLevel: "M",
        });

        if (isMounted) {
          setQrDataUrl(dataUrl);
        }
      } catch {
        if (isMounted) {
          setQrDataUrl("");
        }
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [qrPayload]);

  const updateField = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handlePrintLabel = () => {
    if (!labelRef.current) return;

    const labelHtml = labelRef.current.outerHTML;
    const printWindow = window.open("", "_blank", "width=420,height=680");
    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>FalconMed Label</title>
          <style>
            body {
              margin: 0;
              padding: 16px;
              font-family: Inter, Arial, sans-serif;
              background: #ffffff;
            }
            .print-label {
              width: 320px;
              border: 1px solid #dbe1ea;
              border-radius: 8px;
              padding: 12px;
              box-sizing: border-box;
            }
            .print-label h4 {
              margin: 0 0 8px;
              font-size: 12px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
              color: #334155;
            }
            .print-label .line {
              font-size: 15px;
              color: #0f172a;
              font-weight: 600;
              line-height: 1.35;
            }
            .print-label .muted {
              font-size: 12px;
              color: #475569;
              font-weight: 500;
            }
            .print-label .footer {
              margin-top: 8px;
              font-size: 12px;
              font-weight: 700;
              color: #0f172a;
            }
            .print-label .qr {
              margin-top: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
            }
          </style>
        </head>
        <body>
          ${labelHtml}
          <script>
            window.onload = function () {
              window.print();
              window.close();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  };

  return (
    <div style={wrap}>
      <div style={headerCard}>
        <h2 style={title}>Label Studio</h2>
        <p style={subtitle}>Generate and print pharmacy labels with live preview and QR code.</p>
      </div>

      <div style={layoutGrid}>
        <div style={formCard}>
          <h3 style={sectionTitle}>Smart Label Generator</h3>

          <div style={fieldGroup}>
            <label style={label}>Label Type</label>
            <select style={input} value={labelType} onChange={(e) => setLabelType(e.target.value)}>
              {LABEL_TYPES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div style={formGrid}>
            <div style={fieldGroup}>
              <label style={label}>Drug Name</label>
              <input style={input} value={form.drugName} onChange={(e) => updateField("drugName", e.target.value)} />
            </div>

            <div style={fieldGroup}>
              <label style={label}>Strength</label>
              <input style={input} value={form.strength} onChange={(e) => updateField("strength", e.target.value)} placeholder="500 mg" />
            </div>

            <div style={fieldGroup}>
              <label style={label}>Dosage Form</label>
              <input style={input} value={form.dosageForm} onChange={(e) => updateField("dosageForm", e.target.value)} placeholder="Capsules" />
            </div>

            <div style={fieldGroup}>
              <label style={label}>Days Supply</label>
              <input style={input} value={form.daysSupply} onChange={(e) => updateField("daysSupply", e.target.value)} placeholder="7" />
            </div>
          </div>

          <div style={fieldGroup}>
            <label style={label}>Dose Instructions</label>
            <textarea
              style={textarea}
              value={form.doseInstructions}
              onChange={(e) => updateField("doseInstructions", e.target.value)}
              placeholder="Take 1 capsule every 8 hours"
            />
          </div>

          <div style={fieldGroup}>
            <label style={label}>Optional RX Number</label>
            <input style={input} value={form.rxNumber} onChange={(e) => updateField("rxNumber", e.target.value)} placeholder="204883" />
          </div>

          <button type="button" style={printButton} onClick={handlePrintLabel}>
            Print Label
          </button>
        </div>

        <div style={previewCard}>
          <h3 style={sectionTitle}>Live Preview</h3>

          <div ref={labelRef} className="print-label" style={labelPreview}>
            <h4 style={labelHeader}>{preview.header}</h4>

            {preview.lines.map((line, index) => (
              <div key={`${line}-${index}`} style={line ? labelLine : labelSpacer} className={line ? "line" : "muted"}>
                {line || " "}
              </div>
            ))}

            {preview.footer ? (
              <div style={labelFooter} className="footer">
                {preview.footer}
              </div>
            ) : null}

            <div style={qrWrap} className="qr">
              {qrDataUrl ? <img src={qrDataUrl} alt="Label QR" style={qrImage} /> : <div style={qrFallback}>QR loading...</div>}
            </div>
          </div>

          <div style={previewNote}>Print output is optimized for thermal labels.</div>
        </div>

        <div style={knowledgeCardWrap}>
          <DrugKnowledgePanel drug={selectedDrug} />
        </div>
      </div>
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
  padding: "20px 24px",
  border: "1px solid #eef2f7",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.04)",
};

const title = {
  margin: 0,
  color: "#0f172a",
};

const subtitle = {
  marginTop: "8px",
  marginBottom: 0,
  color: "#475569",
};

const layoutGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr) minmax(280px, 0.9fr)",
  gap: "16px",
};

const knowledgeCardWrap = {
  minWidth: 0,
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px 24px",
  border: "1px solid #eef2f7",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.04)",
};

const previewCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px 24px",
  border: "1px solid #eef2f7",
  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.04)",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  fontSize: "20px",
  fontWeight: 600,
  color: "#0f172a",
  borderBottom: "1px solid #f1f5f9",
  paddingBottom: "10px",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "12px",
};

const fieldGroup = {
  marginBottom: "12px",
};

const label = {
  display: "block",
  marginBottom: "6px",
  fontSize: "12px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#64748b",
};

const input = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #d7deeb",
  fontSize: "14px",
  boxSizing: "border-box",
};

const textarea = {
  ...input,
  minHeight: "72px",
  resize: "vertical",
  fontFamily: "inherit",
};

const printButton = {
  marginTop: "8px",
  background: "#1f3c88",
  color: "white",
  border: "1px solid transparent",
  borderRadius: "12px",
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};

const labelPreview = {
  width: "100%",
  maxWidth: "340px",
  background: "#ffffff",
  border: "1px solid #dbe1ea",
  borderRadius: "8px",
  padding: "12px",
  boxSizing: "border-box",
};

const labelHeader = {
  margin: 0,
  marginBottom: "8px",
  fontSize: "12px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#334155",
};

const labelLine = {
  fontSize: "15px",
  color: "#0f172a",
  fontWeight: 600,
  lineHeight: 1.35,
  minHeight: "18px",
};

const labelSpacer = {
  minHeight: "10px",
};

const labelFooter = {
  marginTop: "8px",
  fontSize: "12px",
  color: "#0f172a",
  fontWeight: 700,
};

const qrWrap = {
  marginTop: "10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const qrImage = {
  width: "104px",
  height: "104px",
};

const qrFallback = {
  fontSize: "12px",
  color: "#64748b",
};

const previewNote = {
  marginTop: "10px",
  color: "#64748b",
  fontSize: "12px",
};
