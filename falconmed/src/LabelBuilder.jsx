import { useState, useMemo, useEffect, useCallback } from "react";
import Papa from "papaparse";
import "./App.css";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

const LABEL_TABS = [
  { key: "patient", label: "Patient Label" },
  { key: "shelf", label: "Shelf Label" },
  { key: "auxiliary", label: "Auxiliary Label" },
];

const LABEL_SIZES = [
  { key: "small", label: "Small" },
  { key: "standard", label: "Standard" },
  { key: "large", label: "Large" },
];

const COLOR_OPTIONS = ["red", "yellow", "blue", "green", "orange", "gray"];

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

const SHELF_TEMPLATES = [
  {
    key: "shelf",
    label: "Shelf Label",
    category: "Shelf",
    defaultText: "Arrange by strength and FEFO sequence",
  },
  {
    key: "fridge",
    label: "Fridge Label",
    category: "Refrigerator",
    defaultText: "Store at 2-8 C",
  },
  {
    key: "drawer",
    label: "Drawer Label",
    category: "Drawer",
    defaultText: "Use dedicated drawer section",
  },
  {
    key: "bin",
    label: "Storage Bin",
    category: "Storage Bin",
    defaultText: "Restock when level is low",
  },
];

const AUX_TEMPLATES = [
  { key: "high-alert", title: "High Alert", message: "Double check dose and patient", color: "red" },
  { key: "refrigerate", title: "Refrigerate", message: "Keep between 2-8 C", color: "blue" },
  { key: "shake-well", title: "Shake Well", message: "Shake bottle before each use", color: "yellow" },
  { key: "external-use", title: "For External Use Only", message: "Do not swallow", color: "orange" },
  { key: "children", title: "Keep Away from Children", message: "Store safely out of reach", color: "green" },
  { key: "cytotoxic", title: "Cytotoxic", message: "Handle with protective equipment", color: "gray" },
  { key: "protect-light", title: "Protect from Light", message: "Store in original light-protective container", color: "blue" },
  { key: "lasa", title: "Look-Alike / Sound-Alike", message: "Apply LASA caution in selection and dispensing", color: "red" },
];

const EMPTY_PATIENT_FORM = {
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
};

const EMPTY_SHELF_FORM = {
  drugName: "",
  strength: "",
  dosageForm: "",
  storageCategory: "Shelf",
  location: "",
  customText: "",
};

const EMPTY_AUX_FORM = {
  title: "",
  message: "",
  drugName: "",
  extraText: "",
};

const PREMIUM_FUTURE = {
  logoUrl: "",
  pharmacyAddress: "",
  pharmacyPhone: "",
  qrValue: "",
  savedTemplates: [],
  favorites: [],
};

function LabelBuilder({ onBack }) {
  const [drugs, setDrugs] = useState([]);
  const [activeTab, setActiveTab] = useState("patient");
  const [labelSize, setLabelSize] = useState("standard");

  const [patientForm, setPatientForm] = useState(EMPTY_PATIENT_FORM);
  const [patientDrugQuery, setPatientDrugQuery] = useState("");
  const [showPatientSuggestions, setShowPatientSuggestions] = useState(false);

  const [shelfForm, setShelfForm] = useState(EMPTY_SHELF_FORM);
  const [shelfDrugQuery, setShelfDrugQuery] = useState("");
  const [showShelfSuggestions, setShowShelfSuggestions] = useState(false);
  const [shelfTemplate, setShelfTemplate] = useState("shelf");
  const [shelfColor, setShelfColor] = useState("blue");

  const [auxForm, setAuxForm] = useState(EMPTY_AUX_FORM);
  const [auxTemplate, setAuxTemplate] = useState("high-alert");
  const [auxColor, setAuxColor] = useState("red");

  const [premiumConfig] = useState(PREMIUM_FUTURE);

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

  const getDrugSuggestions = useCallback(
    (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return drugs
        .filter((d) => {
          const haystack = `${d.brand} ${d.generic} ${d.drug_code}`.toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, 10);
    },
    [drugs]
  );

  const patientSuggestions = useMemo(() => getDrugSuggestions(patientDrugQuery), [getDrugSuggestions, patientDrugQuery]);
  const shelfSuggestions = useMemo(() => getDrugSuggestions(shelfDrugQuery), [getDrugSuggestions, shelfDrugQuery]);

  const selectPatientDrug = useCallback((drug) => {
    setPatientForm((prev) => ({
      ...prev,
      drugName: drug.brand || drug.generic,
      strength: drug.strength,
      dosageForm: drug.dosageForm,
    }));
    setPatientDrugQuery(drug.brand || drug.generic);
    setShowPatientSuggestions(false);
  }, []);

  const selectShelfDrug = useCallback((drug) => {
    setShelfForm((prev) => ({
      ...prev,
      drugName: drug.brand || drug.generic,
      strength: drug.strength,
      dosageForm: drug.dosageForm,
    }));
    setShelfDrugQuery(drug.brand || drug.generic);
    setShowShelfSuggestions(false);
  }, []);

  const setPatientField = useCallback((field, value) => {
    setPatientForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setShelfField = useCallback((field, value) => {
    setShelfForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setAuxField = useCallback((field, value) => {
    setAuxForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const applyShelfTemplate = (templateKey) => {
    const selected = SHELF_TEMPLATES.find((t) => t.key === templateKey);
    setShelfTemplate(templateKey);
    if (!selected) return;
    setShelfForm((prev) => ({
      ...prev,
      storageCategory: selected.category,
      customText: prev.customText || selected.defaultText,
    }));
  };

  const applyAuxTemplate = (templateKey) => {
    const selected = AUX_TEMPLATES.find((t) => t.key === templateKey);
    setAuxTemplate(templateKey);
    if (!selected) return;
    setAuxForm((prev) => ({
      ...prev,
      title: selected.title,
      message: selected.message,
    }));
    setAuxColor(selected.color);
  };

  const clearCurrentTab = () => {
    if (activeTab === "patient") {
      setPatientForm(EMPTY_PATIENT_FORM);
      setPatientDrugQuery("");
      setShowPatientSuggestions(false);
      return;
    }

    if (activeTab === "shelf") {
      setShelfForm(EMPTY_SHELF_FORM);
      setShelfDrugQuery("");
      setShowShelfSuggestions(false);
      setShelfTemplate("shelf");
      setShelfColor("blue");
      return;
    }

    setAuxForm(EMPTY_AUX_FORM);
    setAuxTemplate("high-alert");
    setAuxColor("red");
  };

  const canPrint =
    (activeTab === "patient" && patientForm.drugName.trim() && patientForm.directions.trim()) ||
    (activeTab === "shelf" && shelfForm.drugName.trim()) ||
    (activeTab === "auxiliary" && (auxForm.title.trim() || auxForm.message.trim() || auxForm.extraText.trim()));

  const patientDrugLine = useMemo(
    () => [patientForm.drugName, patientForm.strength, patientForm.dosageForm].filter(Boolean).join(" • "),
    [patientForm.drugName, patientForm.strength, patientForm.dosageForm]
  );

  const shelfDrugLine = useMemo(
    () => [shelfForm.drugName, shelfForm.strength, shelfForm.dosageForm].filter(Boolean).join(" • "),
    [shelfForm.drugName, shelfForm.strength, shelfForm.dosageForm]
  );

  const renderPatientForm = () => (
    <>
      <div className="lb-section">
        <h3 className="lb-section-title">1. Select Medicine (optional)</h3>
        <p className="lb-section-hint">Search from the drug database to auto-fill drug name, strength, and dosage form.</p>
        <div className="lb-search-wrapper">
          <input
            type="text"
            className="lb-input"
            placeholder="Search by brand / generic / drug code..."
            value={patientDrugQuery}
            autoComplete="off"
            onChange={(e) => {
              setPatientDrugQuery(e.target.value);
              setShowPatientSuggestions(true);
            }}
            onFocus={() => setShowPatientSuggestions(true)}
            onBlur={() => setTimeout(() => setShowPatientSuggestions(false), 180)}
          />
          {showPatientSuggestions && patientSuggestions.length > 0 && (
            <ul className="lb-suggestions">
              {patientSuggestions.map((drug) => (
                <li key={`patient-${drug.id}-${drug.drug_code}`}>
                  <button type="button" className="lb-suggestion-btn" onMouseDown={() => selectPatientDrug(drug)}>
                    <span className="sug-brand">{drug.brand || drug.generic}</span>
                    {drug.strength && <span className="sug-meta">{drug.strength}</span>}
                    {drug.dosageForm && <span className="sug-meta">{drug.dosageForm}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showPatientSuggestions && patientDrugQuery.trim() && patientSuggestions.length === 0 && (
            <div className="lb-no-results">No matches - use manual entry below.</div>
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
            >
              {size.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">3. Required Fields</h3>

        <label className="lb-label">
          Drug Name <span className="lb-required">*</span>
          <input
            type="text"
            className="lb-input"
            value={patientForm.drugName}
            onChange={(e) => setPatientField("drugName", e.target.value)}
            placeholder="e.g., Amoxicillin"
          />
        </label>

        <label className="lb-label">
          Strength
          <input
            type="text"
            className="lb-input"
            value={patientForm.strength}
            onChange={(e) => setPatientField("strength", e.target.value)}
            placeholder="e.g., 500 mg"
          />
        </label>

        <label className="lb-label">
          Dosage Form
          <input
            type="text"
            className="lb-input"
            value={patientForm.dosageForm}
            onChange={(e) => setPatientField("dosageForm", e.target.value)}
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
                  setPatientField("directions", e.target.value);
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
                <button type="button" key={item} className="lb-chip" onClick={() => setPatientField("directions", item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="lb-input lb-textarea"
            rows={3}
            value={patientForm.directions}
            onChange={(e) => setPatientField("directions", e.target.value)}
            placeholder="e.g., Take 1 tablet every 8 hours with food."
          />
        </label>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">4. Optional Fields</h3>

        <label className="lb-label">
          Patient Name
          <input type="text" className="lb-input" value={patientForm.patientName} onChange={(e) => setPatientField("patientName", e.target.value)} />
        </label>

        <label className="lb-label">
          Doctor / Prescriber
          <input type="text" className="lb-input" value={patientForm.doctorName} onChange={(e) => setPatientField("doctorName", e.target.value)} />
        </label>

        <label className="lb-label">
          Pharmacy Name
          <input type="text" className="lb-input" value={patientForm.pharmacyName} onChange={(e) => setPatientField("pharmacyName", e.target.value)} />
        </label>

        <label className="lb-label">
          Patient File Number / MRN
          <input
            type="text"
            className="lb-input"
            value={patientForm.mrn}
            onChange={(e) => setPatientField("mrn", e.target.value)}
            placeholder="MRN / File #"
          />
        </label>

        <label className="lb-label">
          Dispensing Date
          <input
            type="date"
            className="lb-input"
            value={patientForm.dispensingDate}
            onChange={(e) => setPatientField("dispensingDate", e.target.value)}
          />
        </label>

        <label className="lb-label">
          Notes
          <textarea
            className="lb-input lb-textarea"
            rows={2}
            value={patientForm.notes}
            onChange={(e) => setPatientField("notes", e.target.value)}
            placeholder="Additional notes..."
          />
        </label>

        <label className="lb-label">
          Warnings
          <textarea
            className="lb-input lb-textarea"
            rows={2}
            value={patientForm.warnings}
            onChange={(e) => setPatientField("warnings", e.target.value)}
            placeholder="e.g., Do not drive. Keep away from children."
          />
        </label>
      </div>
    </>
  );

  const renderShelfForm = () => (
    <>
      <div className="lb-section">
        <h3 className="lb-section-title">1. Shelf Templates</h3>
        <div className="lb-template-grid">
          {SHELF_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.key}
              className={`lb-template-btn ${shelfTemplate === template.key ? "active" : ""}`}
              onClick={() => applyShelfTemplate(template.key)}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">2. Drug Selection (optional)</h3>
        <p className="lb-section-hint">Select from FalconMed database or type manually for custom shelf labels.</p>
        <div className="lb-search-wrapper">
          <input
            type="text"
            className="lb-input"
            placeholder="Search medicine for shelf label..."
            value={shelfDrugQuery}
            autoComplete="off"
            onChange={(e) => {
              setShelfDrugQuery(e.target.value);
              setShowShelfSuggestions(true);
            }}
            onFocus={() => setShowShelfSuggestions(true)}
            onBlur={() => setTimeout(() => setShowShelfSuggestions(false), 180)}
          />
          {showShelfSuggestions && shelfSuggestions.length > 0 && (
            <ul className="lb-suggestions">
              {shelfSuggestions.map((drug) => (
                <li key={`shelf-${drug.id}-${drug.drug_code}`}>
                  <button type="button" className="lb-suggestion-btn" onMouseDown={() => selectShelfDrug(drug)}>
                    <span className="sug-brand">{drug.brand || drug.generic}</span>
                    {drug.strength && <span className="sug-meta">{drug.strength}</span>}
                    {drug.dosageForm && <span className="sug-meta">{drug.dosageForm}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {showShelfSuggestions && shelfDrugQuery.trim() && shelfSuggestions.length === 0 && (
            <div className="lb-no-results">No matches - continue with manual shelf label details.</div>
          )}
        </div>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">3. Shelf Label Details</h3>

        <label className="lb-label">
          Drug Name <span className="lb-required">*</span>
          <input type="text" className="lb-input" value={shelfForm.drugName} onChange={(e) => setShelfField("drugName", e.target.value)} />
        </label>

        <label className="lb-label">
          Strength
          <input type="text" className="lb-input" value={shelfForm.strength} onChange={(e) => setShelfField("strength", e.target.value)} />
        </label>

        <label className="lb-label">
          Dosage Form
          <input type="text" className="lb-input" value={shelfForm.dosageForm} onChange={(e) => setShelfField("dosageForm", e.target.value)} />
        </label>

        <label className="lb-label">
          Storage Category
          <input
            type="text"
            className="lb-input"
            value={shelfForm.storageCategory}
            onChange={(e) => setShelfField("storageCategory", e.target.value)}
            placeholder="Shelf / Cabinet / Drawer / Fridge"
          />
        </label>

        <label className="lb-label">
          Location / Bin Code
          <input
            type="text"
            className="lb-input"
            value={shelfForm.location}
            onChange={(e) => setShelfField("location", e.target.value)}
            placeholder="e.g., A-12 / FR-03 / DR-07"
          />
        </label>

        <label className="lb-label">
          Custom Text
          <textarea
            className="lb-input lb-textarea"
            rows={2}
            value={shelfForm.customText}
            onChange={(e) => setShelfField("customText", e.target.value)}
            placeholder="Extra shelf instructions"
          />
        </label>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">4. Color Theme</h3>
        <div className="lb-color-grid">
          {COLOR_OPTIONS.map((color) => (
            <button
              type="button"
              key={`shelf-color-${color}`}
              className={`lb-color-btn lb-color-${color} ${shelfColor === color ? "active" : ""}`}
              onClick={() => setShelfColor(color)}
            >
              {color}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  const renderAuxForm = () => (
    <>
      <div className="lb-section">
        <h3 className="lb-section-title">1. Auxiliary Templates</h3>
        <div className="lb-template-grid">
          {AUX_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.key}
              className={`lb-template-btn ${auxTemplate === template.key ? "active" : ""}`}
              onClick={() => applyAuxTemplate(template.key)}
            >
              {template.title}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">2. Warning Content</h3>

        <label className="lb-label">
          Warning Title
          <input
            type="text"
            className="lb-input"
            value={auxForm.title}
            onChange={(e) => setAuxField("title", e.target.value)}
            placeholder="e.g., High Alert"
          />
        </label>

        <label className="lb-label">
          Main Warning Text
          <textarea
            className="lb-input lb-textarea"
            rows={2}
            value={auxForm.message}
            onChange={(e) => setAuxField("message", e.target.value)}
            placeholder="Primary warning / handling note"
          />
        </label>

        <label className="lb-label">
          Drug Name (optional)
          <input
            type="text"
            className="lb-input"
            value={auxForm.drugName}
            onChange={(e) => setAuxField("drugName", e.target.value)}
            placeholder="Optional linked medicine"
          />
        </label>

        <label className="lb-label">
          Extra Text
          <textarea
            className="lb-input lb-textarea"
            rows={2}
            value={auxForm.extraText}
            onChange={(e) => setAuxField("extraText", e.target.value)}
            placeholder="Any custom instruction"
          />
        </label>
      </div>

      <div className="lb-section">
        <h3 className="lb-section-title">3. Color Theme</h3>
        <div className="lb-color-grid">
          {COLOR_OPTIONS.map((color) => (
            <button
              type="button"
              key={`aux-color-${color}`}
              className={`lb-color-btn lb-color-${color} ${auxColor === color ? "active" : ""}`}
              onClick={() => setAuxColor(color)}
            >
              {color}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  const renderPatientPreview = () => (
    <div className={`lb-preview-card lb-size-${labelSize}`} id="lb-print-target">
      {patientForm.pharmacyName ? (
        <div className="lb-preview-pharmacy">{patientForm.pharmacyName}</div>
      ) : (
        <div className="lb-preview-pharmacy lb-preview-pharmacy--placeholder">Pharmacy Name</div>
      )}

      <div className="lb-preview-divider" />

      {patientDrugLine && <div className="lb-drug-title">{patientDrugLine}</div>}

      {patientForm.directions && (
        <div className="lb-directions-box">
          <span className="lb-directions-label">Directions</span>
          <p className="lb-directions-value">{patientForm.directions}</p>
        </div>
      )}

      {patientForm.patientName && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">Patient</span>
          <span className="lb-preview-value">{patientForm.patientName}</span>
        </div>
      )}
      {patientForm.mrn && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">MRN / File #</span>
          <span className="lb-preview-value">{patientForm.mrn}</span>
        </div>
      )}
      {patientForm.doctorName && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">Prescriber</span>
          <span className="lb-preview-value">{patientForm.doctorName}</span>
        </div>
      )}
      {patientForm.dispensingDate && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">Dispensed</span>
          <span className="lb-preview-value">{patientForm.dispensingDate}</span>
        </div>
      )}

      {patientForm.notes && (
        <div className="lb-preview-row lb-preview-row-note">
          <span className="lb-preview-label">Notes</span>
          <span className="lb-preview-value">{patientForm.notes}</span>
        </div>
      )}

      {patientForm.warnings && (
        <div className="lb-preview-warning">
          <span className="lb-preview-label">Warnings</span>
          <span className="lb-preview-value">{patientForm.warnings}</span>
        </div>
      )}

      {!patientForm.drugName && !patientForm.directions && (
        <p className="lb-preview-empty">Fill in the form to see the patient label preview.</p>
      )}

      <div className="lb-preview-divider lb-preview-divider--bottom" />
      <div className="lb-preview-footer">FalconMed - Patient Label</div>
    </div>
  );

  const renderShelfPreview = () => (
    <div className={`lb-preview-card lb-size-${labelSize} lb-shelf-preview lb-theme-${shelfColor}`} id="lb-print-target">
      <div className="lb-shelf-template-tag">{SHELF_TEMPLATES.find((t) => t.key === shelfTemplate)?.label || "Shelf Label"}</div>
      <div className="lb-shelf-category">{shelfForm.storageCategory || "Storage Category"}</div>
      {shelfDrugLine && <div className="lb-shelf-drug">{shelfDrugLine}</div>}
      {shelfForm.location && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">Location</span>
          <span className="lb-preview-value">{shelfForm.location}</span>
        </div>
      )}
      {shelfForm.customText && <div className="lb-shelf-note">{shelfForm.customText}</div>}

      {!shelfForm.drugName && !shelfForm.customText && (
        <p className="lb-preview-empty">Fill in drug or custom text to preview shelf label.</p>
      )}

      <div className="lb-preview-divider lb-preview-divider--bottom" />
      <div className="lb-preview-footer">FalconMed - Shelf / Storage Label</div>
    </div>
  );

  const renderAuxPreview = () => (
    <div className={`lb-preview-card lb-size-${labelSize} lb-aux-preview lb-theme-${auxColor}`} id="lb-print-target">
      {auxForm.title && <div className="lb-aux-title">{auxForm.title}</div>}
      {auxForm.message && <div className="lb-aux-message">{auxForm.message}</div>}
      {auxForm.drugName && (
        <div className="lb-preview-row">
          <span className="lb-preview-label">Drug</span>
          <span className="lb-preview-value">{auxForm.drugName}</span>
        </div>
      )}
      {auxForm.extraText && <div className="lb-aux-extra">{auxForm.extraText}</div>}

      {!auxForm.title && !auxForm.message && !auxForm.extraText && (
        <p className="lb-preview-empty">Choose an auxiliary template or enter manual warning text.</p>
      )}

      <div className="lb-preview-divider lb-preview-divider--bottom" />
      <div className="lb-preview-footer">FalconMed - Auxiliary Label</div>
    </div>
  );

  return (
    <div className="label-builder-container">
      <div className="label-builder-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Pharmacy Labels Studio</h2>
      </div>

      <div className="lb-tabs" role="tablist" aria-label="Label type selector">
        {LABEL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`lb-tab-btn ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="label-builder-body">
        <section className="label-form-panel">
          {activeTab === "patient" && renderPatientForm()}
          {activeTab === "shelf" && renderShelfForm()}
          {activeTab === "auxiliary" && renderAuxForm()}

          <div className="lb-actions">
            <button
              type="button"
              className="lb-btn-print"
              onClick={() => window.print()}
              disabled={!canPrint}
              title={!canPrint ? "Complete minimum label details before printing" : "Print this label"}
            >
              Print Label
            </button>
            <button type="button" className="lb-btn-clear" onClick={clearCurrentTab}>
              Clear Current Label
            </button>
          </div>

          {!canPrint && (
            <p className="lb-required-note">
              Required: Patient label needs Drug Name + Directions. Shelf label needs Drug Name. Auxiliary label needs at least one warning text.
            </p>
          )}
        </section>

        <section className="label-preview-panel">
          <h3 className="lb-preview-heading">Live Label Preview</h3>
          {activeTab === "patient" && renderPatientPreview()}
          {activeTab === "shelf" && renderShelfPreview()}
          {activeTab === "auxiliary" && renderAuxPreview()}
          <p className="lb-preview-note">Only filled fields appear on the printed label.</p>
        </section>
      </div>

      <div className="lb-future-ready" aria-hidden="true">
        <strong>Future-ready:</strong> logo, address, phone, QR, saved templates, and favorites are prepared in state for future premium expansion.
        <span className="lb-future-hidden">{JSON.stringify(premiumConfig).length}</span>
      </div>
    </div>
  );
}

export default LabelBuilder;
