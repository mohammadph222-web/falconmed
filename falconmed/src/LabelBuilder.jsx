import { useState, useMemo, useEffect, useCallback } from "react";
import Papa from "papaparse";
import "./App.css";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

const QUICK_DIRECTIONS = [
  "Take 1 tablet once daily",
  "Take 1 tablet twice daily",
  "Take 1 tablet every 8 hours",
  "Take after food",
  "Take before food",
  "Apply twice daily",
  "Instill 1 drop in each eye twice daily",
  "Use as directed by physician",
];

const LABEL_SIZES = [
  { key: "small", label: "Small" },
  { key: "standard", label: "Standard" },
  { key: "large", label: "Large" },
];

const EMPTY_FORM = {
  drugName: "",
  strength: "",
  dosageForm: "",
  directions: "",
  patientName: "",
  doctorName: "",
  pharmacyName: "",
  mrn: "",
  dispensingDate: "",
  notes: "",
  warnings: "",
  // Reserved for future premium add-ons (logo/address/phone/QR)
  premium: {
    logoUrl: "",
    pharmacyAddress: "",
    pharmacyPhone: "",
    qrValue: "",
  },
};

function LabelBuilder({ onBack }) {
  const [drugs, setDrugs] = useState([]);
  const [drugQuery, setDrugQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [labelSize, setLabelSize] = useState("standard");

  useEffect(() => {
    const parsed = Papa.parse(drugsMasterCsv, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
    });

    const rows = parsed.data
      .map((row, idx) => ({
        id: (row.drug_code || String(idx + 1)).trim(),
        brand: (row.brand_name || "").trim(),
        generic: (row.generic_name || "").trim(),
        strength: (row.strength || "").trim(),
        dosageForm: (row.dosage_form || "").trim(),
        drug_code: (row.drug_code || "").trim(),
      }))
      .filter((d) => d.brand || d.generic);

    setDrugs(rows);
  }, []);

  const suggestions = useMemo(() => {
    const q = drugQuery.trim().toLowerCase();
    if (!q) return [];
    return drugs
      .filter((d) => {
        const haystack = `${d.brand} ${d.generic} ${d.drug_code}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [drugQuery, drugs]);

  const selectDrug = useCallback((drug) => {
    setForm((prev) => ({
      ...prev,
      drugName: drug.brand || drug.generic,
      strength: drug.strength,
      dosageForm: drug.dosageForm,
    }));
    setDrugQuery(drug.brand || drug.generic);
    setShowSuggestions(false);
  }, []);

  const updateField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const clearForm = () => {
    setForm(EMPTY_FORM);
    setDrugQuery("");
    setShowSuggestions(false);
  };

  const canPrint = form.drugName.trim() && form.directions.trim();

  const composedDrugLine = useMemo(() => {
    return [form.drugName, form.strength, form.dosageForm].filter(Boolean).join(" • ");
  }, [form.drugName, form.strength, form.dosageForm]);

  const metaFields = useMemo(
    () => [
      { key: "patientName", label: "Patient" },
      { key: "mrn", label: "MRN / File #" },
      { key: "doctorName", label: "Prescriber" },
      { key: "dispensingDate", label: "Dispensed" },
    ],
    []
  );

  return (
    <div className="label-builder-container">
      <div className="label-builder-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Label Builder</h2>
      </div>

      <div className="label-builder-body">
        {/* ── Left: Form ── */}
        <section className="label-form-panel">

          {/* Step 1: Drug search */}
          <div className="lb-section">
            <h3 className="lb-section-title">1. Select Medicine (optional)</h3>
            <p className="lb-section-hint">Search from the drug database to auto-fill fields, or skip to enter manually.</p>
            <div className="lb-search-wrapper">
              <input
                type="text"
                className="lb-input"
                placeholder="Search by brand / generic / drug code…"
                value={drugQuery}
                autoComplete="off"
                onChange={(e) => {
                  setDrugQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="lb-suggestions">
                  {suggestions.map((drug) => (
                    <li key={`${drug.id}-${drug.drug_code}`}>
                      <button
                        type="button"
                        className="lb-suggestion-btn"
                        onMouseDown={() => selectDrug(drug)}
                      >
                        <span className="sug-brand">{drug.brand || drug.generic}</span>
                        {drug.strength && <span className="sug-meta">{drug.strength}</span>}
                        {drug.dosageForm && <span className="sug-meta">{drug.dosageForm}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showSuggestions && drugQuery.trim() && suggestions.length === 0 && (
                <div className="lb-no-results">No matches — enter manually below.</div>
              )}
            </div>
          </div>

          <div className="lb-section">
            <h3 className="lb-section-title">2. Label Size</h3>
            <div className="lb-size-group" role="radiogroup" aria-label="Label size">
              {LABEL_SIZES.map((size) => (
                <button
                  key={size.key}
                  type="button"
                  className={`lb-size-btn ${labelSize === size.key ? "active" : ""}`}
                  onClick={() => setLabelSize(size.key)}
                  aria-pressed={labelSize === size.key}
                >
                  {size.label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Required fields */}
          <div className="lb-section">
            <h3 className="lb-section-title">3. Required Fields</h3>

            <label className="lb-label">
              Drug Name <span className="lb-required">*</span>
              <input
                type="text"
                className="lb-input"
                value={form.drugName}
                onChange={(e) => updateField("drugName", e.target.value)}
                placeholder="e.g., Amoxicillin"
              />
            </label>

            <label className="lb-label">
              Strength
              <input
                type="text"
                className="lb-input"
                value={form.strength}
                onChange={(e) => updateField("strength", e.target.value)}
                placeholder="e.g., 500 mg"
              />
            </label>

            <label className="lb-label">
              Dosage Form
              <input
                type="text"
                className="lb-input"
                value={form.dosageForm}
                onChange={(e) => updateField("dosageForm", e.target.value)}
                placeholder="e.g., Tablet, Syrup"
              />
            </label>

            <label className="lb-label">
              Directions for Use <span className="lb-required">*</span>
              <div className="lb-quick-row">
                <select
                  className="lb-input lb-quick-select"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      updateField("directions", e.target.value);
                      e.target.value = "";
                    }
                  }}
                >
                  <option value="">Quick Directions...</option>
                  {QUICK_DIRECTIONS.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <div className="lb-quick-chips">
                  {QUICK_DIRECTIONS.slice(0, 4).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className="lb-chip"
                      onClick={() => updateField("directions", item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                className="lb-input lb-textarea"
                rows={3}
                value={form.directions}
                onChange={(e) => updateField("directions", e.target.value)}
                placeholder="e.g., Take 1 tablet every 8 hours with food."
              />
            </label>
          </div>

          {/* Step 3: Optional fields */}
          <div className="lb-section">
            <h3 className="lb-section-title">4. Optional Fields</h3>

            <label className="lb-label">
              Patient Name
              <input
                type="text"
                className="lb-input"
                value={form.patientName}
                onChange={(e) => updateField("patientName", e.target.value)}
              />
            </label>

            <label className="lb-label">
              Doctor / Prescriber
              <input
                type="text"
                className="lb-input"
                value={form.doctorName}
                onChange={(e) => updateField("doctorName", e.target.value)}
              />
            </label>

            <label className="lb-label">
              Pharmacy Name
              <input
                type="text"
                className="lb-input"
                value={form.pharmacyName}
                onChange={(e) => updateField("pharmacyName", e.target.value)}
              />
            </label>

            <label className="lb-label">
              Patient File Number / MRN
              <input
                type="text"
                className="lb-input"
                value={form.mrn}
                onChange={(e) => updateField("mrn", e.target.value)}
                placeholder="MRN / File #"
              />
            </label>

            <label className="lb-label">
              Dispensing Date
              <input
                type="date"
                className="lb-input"
                value={form.dispensingDate}
                onChange={(e) => updateField("dispensingDate", e.target.value)}
              />
            </label>

            <label className="lb-label">
              Notes
              <textarea
                className="lb-input lb-textarea"
                rows={2}
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                placeholder="Additional notes…"
              />
            </label>

            <label className="lb-label">
              Warnings
              <textarea
                className="lb-input lb-textarea"
                rows={2}
                value={form.warnings}
                onChange={(e) => updateField("warnings", e.target.value)}
                placeholder="e.g., Do not drive. Keep away from children."
              />
            </label>
          </div>

          {/* Actions */}
          <div className="lb-actions">
            <button
              type="button"
              className="lb-btn-print"
              onClick={() => window.print()}
              disabled={!canPrint}
              title={!canPrint ? "Drug name and directions are required" : "Print this label"}
            >
              🖨 Print Label
            </button>
            <button type="button" className="lb-btn-clear" onClick={clearForm}>
              Clear
            </button>
          </div>
          {!canPrint && (
            <p className="lb-required-note">* Drug name and directions are required to print.</p>
          )}
        </section>

        {/* ── Right: Live Preview ── */}
        <section className="label-preview-panel">
          <h3 className="lb-preview-heading">Live Label Preview</h3>
          <div className={`lb-preview-card lb-size-${labelSize}`} id="lb-print-target">
            {form.pharmacyName ? (
              <div className="lb-preview-pharmacy">{form.pharmacyName}</div>
            ) : (
              <div className="lb-preview-pharmacy lb-preview-pharmacy--placeholder">Pharmacy Name</div>
            )}

            <div className="lb-preview-divider" />

            {composedDrugLine && <div className="lb-drug-title">{composedDrugLine}</div>}

            {form.directions && (
              <div className="lb-directions-box">
                <span className="lb-directions-label">Directions</span>
                <p className="lb-directions-value">{form.directions}</p>
              </div>
            )}

            {metaFields.map(({ key, label }) =>
              form[key] ? (
                <div className="lb-preview-row" key={key}>
                  <span className="lb-preview-label">{label}</span>
                  <span className="lb-preview-value">{form[key]}</span>
                </div>
              ) : null
            )}

            {form.notes && (
              <div className="lb-preview-row lb-preview-row-note">
                <span className="lb-preview-label">Notes</span>
                <span className="lb-preview-value">{form.notes}</span>
              </div>
            )}

            {form.warnings && (
              <div className="lb-preview-warning">
                <span className="lb-preview-label">Warnings</span>
                <span className="lb-preview-value">{form.warnings}</span>
              </div>
            )}

            {!form.drugName && !form.directions && (
              <p className="lb-preview-empty">Fill in the form to see the label preview.</p>
            )}

            <div className="lb-preview-divider lb-preview-divider--bottom" />
            <div className="lb-preview-footer">FalconMed · Pharmacy Label</div>
          </div>
          <p className="lb-preview-note">Only filled fields appear on the label.</p>
        </section>
      </div>
    </div>
  );
}

export default LabelBuilder;
