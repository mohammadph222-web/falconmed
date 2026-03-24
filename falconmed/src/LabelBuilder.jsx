import { useMemo, useState } from "react";

export default function LabelBuilder() {
  const today = new Date().toISOString().split("T")[0];

  const [mode, setMode] = useState("patient");
  const [labelSize, setLabelSize] = useState("standard");

  const [form, setForm] = useState({
    packageName: "",
    genericName: "",
    strength: "",
    dosageForm: "",
    directions: "",
    patientName: "",
    prescriberName: "",
    mrn: "",
    dispenseDate: today,
    pharmacyName: "FalconMed Pharmacy",
    shelfTitle: "",
    shelfGeneric: "",
    shelfDosageForm: "",
    shelfStrength: "",
    auxText: "",
  });

  const [selectedWarnings, setSelectedWarnings] = useState([]);

  const warningOptions = [
    "Refrigerate",
    "Shake Well",
    "High Alert",
    "LASA",
    "For External Use",
    "Keep Out of Reach of Children",
    "Do Not Crush",
    "Take With Food",
  ];

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleWarning = (item) => {
    setSelectedWarnings((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const previewStyle = useMemo(() => {
    if (labelSize === "small") {
      return {
        width: "280px",
        minHeight: "160px",
        fontSize: "11px",
      };
    }

    if (labelSize === "large") {
      return {
        width: "520px",
        minHeight: "260px",
        fontSize: "15px",
      };
    }

    return {
      width: "380px",
      minHeight: "210px",
      fontSize: "13px",
    };
  }, [labelSize]);

  return (
    <div>
      <h1 style={pageTitle}>Label Builder</h1>

      <div style={topGrid}>
        <div style={formCard}>
          <h2 style={sectionTitle}>Label Settings</h2>

          <div style={modeRow}>
            <button
              style={mode === "patient" ? activeModeBtn : modeBtn}
              onClick={() => setMode("patient")}
              type="button"
            >
              Patient Label
            </button>

            <button
              style={mode === "shelf" ? activeModeBtn : modeBtn}
              onClick={() => setMode("shelf")}
              type="button"
            >
              Shelf Label
            </button>

            <button
              style={mode === "aux" ? activeModeBtn : modeBtn}
              onClick={() => setMode("aux")}
              type="button"
            >
              Auxiliary Label
            </button>
          </div>

          <div style={{ marginBottom: "18px" }}>
            <label style={label}>Label Size</label>
            <select
              style={input}
              value={labelSize}
              onChange={(e) => setLabelSize(e.target.value)}
            >
              <option value="small">Small</option>
              <option value="standard">Standard</option>
              <option value="large">Large</option>
            </select>
          </div>

          {mode === "patient" && (
            <div style={formGrid}>
              <div>
                <label style={label}>Package Name</label>
                <input
                  style={input}
                  value={form.packageName}
                  onChange={(e) => handleChange("packageName", e.target.value)}
                  placeholder="Augmentin 1g"
                />
              </div>

              <div>
                <label style={label}>Generic Name</label>
                <input
                  style={input}
                  value={form.genericName}
                  onChange={(e) => handleChange("genericName", e.target.value)}
                  placeholder="Amoxicillin + Clavulanate"
                />
              </div>

              <div>
                <label style={label}>Strength</label>
                <input
                  style={input}
                  value={form.strength}
                  onChange={(e) => handleChange("strength", e.target.value)}
                  placeholder="1 g"
                />
              </div>

              <div>
                <label style={label}>Dosage Form</label>
                <input
                  style={input}
                  value={form.dosageForm}
                  onChange={(e) => handleChange("dosageForm", e.target.value)}
                  placeholder="Tablet"
                />
              </div>

              <div>
                <label style={label}>Patient Name</label>
                <input
                  style={input}
                  value={form.patientName}
                  onChange={(e) => handleChange("patientName", e.target.value)}
                  placeholder="Patient name"
                />
              </div>

              <div>
                <label style={label}>MRN</label>
                <input
                  style={input}
                  value={form.mrn}
                  onChange={(e) => handleChange("mrn", e.target.value)}
                  placeholder="Medical record number"
                />
              </div>

              <div>
                <label style={label}>Prescriber Name</label>
                <input
                  style={input}
                  value={form.prescriberName}
                  onChange={(e) => handleChange("prescriberName", e.target.value)}
                  placeholder="Dr. Name"
                />
              </div>

              <div>
                <label style={label}>Dispense Date</label>
                <input
                  style={input}
                  type="date"
                  value={form.dispenseDate}
                  onChange={(e) => handleChange("dispenseDate", e.target.value)}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>Directions</label>
                <textarea
                  style={textarea}
                  value={form.directions}
                  onChange={(e) => handleChange("directions", e.target.value)}
                  placeholder="Take 1 tablet twice daily after meals"
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>Pharmacy Name</label>
                <input
                  style={input}
                  value={form.pharmacyName}
                  onChange={(e) => handleChange("pharmacyName", e.target.value)}
                  placeholder="Pharmacy name"
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={label}>Warning Chips</label>
                <div style={chipsWrap}>
                  {warningOptions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleWarning(item)}
                      style={selectedWarnings.includes(item) ? chipActive : chip}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mode === "shelf" && (
            <div style={formGrid}>
              <div>
                <label style={label}>Shelf Title / Brand</label>
                <input
                  style={input}
                  value={form.shelfTitle}
                  onChange={(e) => handleChange("shelfTitle", e.target.value)}
                  placeholder="Brufen"
                />
              </div>

              <div>
                <label style={label}>Generic Name</label>
                <input
                  style={input}
                  value={form.shelfGeneric}
                  onChange={(e) => handleChange("shelfGeneric", e.target.value)}
                  placeholder="Ibuprofen"
                />
              </div>

              <div>
                <label style={label}>Strength</label>
                <input
                  style={input}
                  value={form.shelfStrength}
                  onChange={(e) => handleChange("shelfStrength", e.target.value)}
                  placeholder="400 mg"
                />
              </div>

              <div>
                <label style={label}>Dosage Form</label>
                <input
                  style={input}
                  value={form.shelfDosageForm}
                  onChange={(e) =>
                    handleChange("shelfDosageForm", e.target.value)
                  }
                  placeholder="Tablet"
                />
              </div>
            </div>
          )}

          {mode === "aux" && (
            <div>
              <label style={label}>Auxiliary Text</label>
              <textarea
                style={textarea}
                value={form.auxText}
                onChange={(e) => handleChange("auxText", e.target.value)}
                placeholder="Refrigerate"
              />
            </div>
          )}

          <div style={{ marginTop: "20px" }}>
            <button style={printBtn} onClick={handlePrint} type="button">
              Print Label
            </button>
          </div>
        </div>

        <div style={previewCard}>
          <h2 style={sectionTitle}>Preview</h2>

          <div style={{ ...labelPreview, ...previewStyle }}>
            {mode === "patient" && (
              <div>
                <div style={previewHeader}>{form.pharmacyName || "Pharmacy"}</div>

                <div style={previewBigTitle}>
                  {form.packageName || "Package Name"}
                </div>

                <div style={previewLine}>
                  <strong>Generic:</strong> {form.genericName || "-"}
                </div>
                <div style={previewLine}>
                  <strong>Strength:</strong> {form.strength || "-"}
                </div>
                <div style={previewLine}>
                  <strong>Dosage Form:</strong> {form.dosageForm || "-"}
                </div>
                <div style={previewLine}>
                  <strong>Patient:</strong> {form.patientName || "-"}
                </div>
                <div style={previewLine}>
                  <strong>MRN:</strong> {form.mrn || "-"}
                </div>
                <div style={previewLine}>
                  <strong>Prescriber:</strong> {form.prescriberName || "-"}
                </div>
                <div style={previewLine}>
                  <strong>Date:</strong> {form.dispenseDate || "-"}
                </div>

                <div style={directionsBox}>
                  <strong>Directions:</strong> {form.directions || "-"}
                </div>

                {selectedWarnings.length > 0 && (
                  <div style={warningBox}>
                    {selectedWarnings.map((w) => (
                      <span key={w} style={warningTag}>
                        {w}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {mode === "shelf" && (
              <div style={{ textAlign: "center" }}>
                <div style={previewShelfTitle}>
                  {form.shelfTitle || "Shelf Label"}
                </div>
                <div style={previewShelfLine}>
                  {form.shelfGeneric || "Generic Name"}
                </div>
                <div style={previewShelfLine}>
                  {form.shelfStrength || "Strength"}
                </div>
                <div style={previewShelfLine}>
                  {form.shelfDosageForm || "Dosage Form"}
                </div>
              </div>
            )}

            {mode === "aux" && (
              <div style={auxPreview}>
                {form.auxText || "Auxiliary Label"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const pageTitle = {
  fontSize: "26px",
  marginTop: 0,
  marginBottom: "22px",
  color: "#0f172a",
};

const topGrid = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr",
  gap: "22px",
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const previewCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  color: "#0f172a",
};

const modeRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginBottom: "18px",
};

const modeBtn = {
  padding: "10px 14px",
  background: "#e2e8f0",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  color: "#0f172a",
  fontWeight: "bold",
};

const activeModeBtn = {
  ...modeBtn,
  background: "#2563eb",
  color: "white",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const label = {
  display: "block",
  marginBottom: "8px",
  fontSize: "14px",
  color: "#334155",
  fontWeight: "bold",
};

const input = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const textarea = {
  width: "100%",
  minHeight: "90px",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  resize: "vertical",
};

const chipsWrap = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const chip = {
  padding: "8px 12px",
  borderRadius: "999px",
  border: "1px solid #cbd5e1",
  background: "white",
  cursor: "pointer",
};

const chipActive = {
  ...chip,
  background: "#2563eb",
  color: "white",
  border: "1px solid #2563eb",
};

const printBtn = {
  padding: "12px 18px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: "bold",
};

const labelPreview = {
  margin: "0 auto",
  background: "white",
  border: "2px dashed #94a3b8",
  borderRadius: "14px",
  padding: "18px",
  boxSizing: "border-box",
};

const previewHeader = {
  fontWeight: "bold",
  fontSize: "1.1em",
  marginBottom: "10px",
  textAlign: "center",
};

const previewBigTitle = {
  fontSize: "1.2em",
  fontWeight: "bold",
  marginBottom: "10px",
  color: "#0f172a",
};

const previewLine = {
  marginBottom: "6px",
  color: "#0f172a",
};

const directionsBox = {
  marginTop: "12px",
  padding: "10px",
  borderRadius: "10px",
  background: "#f8fafc",
};

const warningBox = {
  marginTop: "12px",
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
};

const warningTag = {
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#fee2e2",
  color: "#b91c1c",
  fontSize: "12px",
  fontWeight: "bold",
};

const previewShelfTitle = {
  fontSize: "1.5em",
  fontWeight: "bold",
  marginBottom: "12px",
};

const previewShelfLine = {
  marginBottom: "8px",
  fontSize: "1.05em",
};

const auxPreview = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "120px",
  fontSize: "1.6em",
  fontWeight: "bold",
  color: "#b91c1c",
  textAlign: "center",
};