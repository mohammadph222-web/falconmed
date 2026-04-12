import { useMemo, useState, useEffect } from "react";
import "./Billing.css";
import {
  getDrugDisplayName,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMasterLoader";
import { ActionButton, PageHeader } from "./ui";

const INITIAL_PHARMACY = {
  name: "FalconMed Pharmacy",
  address: "Enter pharmacy address",
  phone: "Enter pharmacy phone",
  logoUrl: "",
};

const INITIAL_CUSTOMER = {
  name: "",
  phone: "",
  mrn: "",
};

const createEmptyItem = () => ({
  id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  item: "",
  quantity: 1,
  discount: 0,
  source: "manual",
  saleMode: "pack",
  packagePrice: "",
  unitSalePrice: "",
  packageSize: 0,
  packageSizeLabel: "-",
  billingUnit: "Pack",
  baseUnit: "Unit",
  strength: "",
  drugName: "",
  drugCode: "",
});

const sanitizeNumber = (value, fallback = 0) => {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatCurrency = (value) => sanitizeNumber(value, 0).toFixed(2);

const normalizeText = (value) => String(value ?? "").trim();

const BILLING_DRAFT_KEY = "billing-draft-v4";

const sanitizeRestoredItem = (item) => {
  const safe = {
    ...createEmptyItem(),
    ...(item || {}),
  };

  return safe;
};

const sanitizeRestoredItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((item) => sanitizeRestoredItem(item));
};

const saveBillingDraft = (state) => {
  try {
    sessionStorage.setItem(BILLING_DRAFT_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to save billing draft:", error);
  }
};

const restoreBillingDraft = () => {
  try {
    const stored = sessionStorage.getItem(BILLING_DRAFT_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn("Failed to restore billing draft:", error);
    return null;
  }
};

const clearBillingDraft = () => {
  try {
    sessionStorage.removeItem(BILLING_DRAFT_KEY);
  } catch (error) {
    console.warn("Failed to clear billing draft:", error);
  }
};

const getPublicSellingPackPriceFromDrug = (drug) => {
  return Math.max(
    sanitizeNumber(
      drug?.public_pack_price ??
      drug?.public_price ??
      drug?.price_to_public ??
      drug?.selling_price ??
      drug?.retail_price ??
      drug?.cash_price,
      0
    ),
    0
  );
};

const getPackPrice = (row) => {
  if (row?.source === "database") {
    return Math.max(sanitizeNumber(row?.publicPackPrice, 0), 0);
  }
  return Math.max(sanitizeNumber(row?.packagePrice, 0), 0);
};

const getEffectiveUnitPrice = (row) => {
  if (row?.source === "database") {
    return Math.max(sanitizeNumber(row?.publicUnitPrice, 0), 0);
  }

  const manual = sanitizeNumber(row?.unitSalePrice, 0);
  if (manual > 0) return manual;
  return 0;
};

const getRowTotal = (row) => {
  const qty = Math.max(sanitizeNumber(row?.quantity, 0), 0);
  const discount = Math.max(sanitizeNumber(row?.discount, 0), 0);

  const price =
    row?.saleMode === "unit"
      ? getEffectiveUnitPrice(row)
      : getPackPrice(row);

  return Math.max(qty * price - discount, 0);
};

const isMeaningfulRow = (row) => {
  if (normalizeText(row?.item)) return true;
  if (row?.source === "database") return true;
  if (sanitizeNumber(row?.quantity, 1) !== 1) return true;
  if (sanitizeNumber(row?.discount, 0) > 0) return true;
  if (sanitizeNumber(row?.packagePrice, 0) > 0) return true;
  if (sanitizeNumber(row?.unitSalePrice, 0) > 0) return true;
  if (normalizeText(row?.saleMode || "pack") !== "pack") return true;
  return false;
};

function Billing({ onBack }) {
  const [hasHydrated, setHasHydrated] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [documentType, setDocumentType] = useState("Invoice");
  const [documentNumber, setDocumentNumber] = useState("INV-1001");
  const [documentDate, setDocumentDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [pharmacy, setPharmacy] = useState(INITIAL_PHARMACY);
  const [customer, setCustomer] = useState(INITIAL_CUSTOMER);

  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(5);

  const [items, setItems] = useState([]);

  const [drugs, setDrugs] = useState([]);
  const [drugQuery, setDrugQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedMedicineMeta, setSelectedMedicineMeta] = useState(null);

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) setDrugs(rows || []);
      })
      .catch((error) => {
        console.error("Failed to load billing drug source:", error);
        if (isMounted) setDrugs([]);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (documentType === "Invoice" && !documentNumber.startsWith("INV-")) {
      setDocumentNumber("INV-1001");
    }
    if (documentType === "Quotation" && !documentNumber.startsWith("QUO-")) {
      setDocumentNumber("QUO-1001");
    }
  }, [documentType, documentNumber]);

  useEffect(() => {
    if (hasHydrated) return;

    const draft = restoreBillingDraft();
    if (draft) {
      setDocumentType(draft.documentType || "Invoice");
      setDocumentNumber(draft.documentNumber || "INV-1001");
      setDocumentDate(draft.documentDate || new Date().toISOString().slice(0, 10));
      setPharmacy(draft.pharmacy || INITIAL_PHARMACY);
      setCustomer(draft.customer || INITIAL_CUSTOMER);
      setVatEnabled(draft.vatEnabled !== undefined ? draft.vatEnabled : true);
      setVatRate(draft.vatRate !== undefined ? draft.vatRate : 5);
      setItems(sanitizeRestoredItems(draft.items));
      setRestoreMessage("Restored unsaved billing draft");
      setTimeout(() => setRestoreMessage(""), 4000);
    }

    setHasHydrated(true);
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated) return;

    const saveTimer = setTimeout(() => {
      saveBillingDraft({
        documentType,
        documentNumber,
        documentDate,
        pharmacy,
        customer,
        vatEnabled,
        vatRate,
        items,
      });
      setHasUnsavedChanges(false);
    }, 500);

    setHasUnsavedChanges(true);
    return () => clearTimeout(saveTimer);
  }, [
    hasHydrated,
    documentType,
    documentNumber,
    documentDate,
    pharmacy,
    customer,
    vatEnabled,
    vatRate,
    items,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const suggestions = useMemo(() => {
    return searchDrugMaster(drugs, drugQuery, 8);
  }, [drugQuery, drugs]);

  const updatePharmacy = (field, value) => {
    setPharmacy((prev) => ({ ...prev, [field]: value }));
  };

  const updateCustomer = (field, value) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  };

  const addManualItem = () => {
    setItems((prev) => [...prev, createEmptyItem()]);
  };

  const addItemFromDrug = (drug) => {
    const label = getDrugDisplayName(drug);

    const packSize = Math.max(sanitizeNumber(drug?.normalized_pack_size, 1), 1);

    const packageSizeLabel =
      normalizeText(drug?.package_size_raw) ||
      normalizeText(drug?.package_size) ||
      String(packSize);

    const publicPackPrice = getPublicSellingPackPriceFromDrug(drug);
    const publicUnitPrice = packSize > 0 ? Number((publicPackPrice / packSize).toFixed(4)) : 0;

    setItems((prev) => [
      ...prev,
      {
        id: `drug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        item: label,
        quantity: 1,
        discount: 0,
        source: "database",
        saleMode: "pack",
        billingUnit: "Pack",
        baseUnit: "Unit",
        packageSize: packSize,
        packageSizeLabel,
        packagePrice: publicPackPrice,
        unitSalePrice: publicUnitPrice,
        publicPackPrice,
        publicUnitPrice,
        strength: normalizeText(drug?.strength),
        drugName: normalizeText(drug?.drug_name || label),
        drugCode: normalizeText(drug?.drug_code),
      },
    ]);

    setSelectedMedicineMeta({
      drugName: normalizeText(drug?.drug_name || label),
      strength: normalizeText(drug?.strength) || "-",
      packageSize: packageSizeLabel || "-",
      billingUnit: "Pack",
      defaultSellingPrice: publicPackPrice,
      defaultUnitPrice: publicUnitPrice,
      drugCode: normalizeText(drug?.drug_code),
    });

    setDrugQuery("");
    setShowSuggestions(false);
  };

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        if (field === "item") return { ...item, item: value };
        if (field === "quantity") {
          return {
            ...item,
            quantity: Math.max(Math.round(sanitizeNumber(value, 1)), 1),
          };
        }
        if (field === "packagePrice") {
          return { ...item, packagePrice: value };
        }
        if (field === "unitSalePrice") {
          return { ...item, unitSalePrice: value };
        }
        if (field === "saleMode") {
          return { ...item, saleMode: value };
        }
        if (field === "discount") {
          return { ...item, discount: Math.max(sanitizeNumber(value, 0), 0) };
        }

        return item;
      })
    );
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const totals = useMemo(() => {
    const rows = items.map((item) => ({
      id: item.id,
      total: getRowTotal(item),
    }));

    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const vatAmount = vatEnabled ? subtotal * (Math.max(vatRate, 0) / 100) : 0;
    const grandTotal = subtotal + vatAmount;

    return { rows, subtotal, vatAmount, grandTotal };
  }, [items, vatEnabled, vatRate]);

  const rowTotalMap = useMemo(() => {
    return totals.rows.reduce((acc, row) => {
      acc[row.id] = row.total;
      return acc;
    }, {});
  }, [totals.rows]);

  const visibleItems = useMemo(() => {
    return items.filter((item) => isMeaningfulRow(item));
  }, [items]);

  const handlePrint = () => {
    window.print();
  };

  const handleClear = () => {
    setDocumentType("Invoice");
    setDocumentNumber("INV-1001");
    setDocumentDate(new Date().toISOString().slice(0, 10));
    setPharmacy(INITIAL_PHARMACY);
    setCustomer(INITIAL_CUSTOMER);
    setVatEnabled(true);
    setVatRate(5);
    setItems([]);
    setDrugQuery("");
    setShowSuggestions(false);
    setSelectedMedicineMeta(null);
    clearBillingDraft();
    setHasUnsavedChanges(false);
  };

  const processLogoFile = (file) => {
    if (!file || !file.type.startsWith("image/")) {
      alert("Please select a valid image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Image size must be less than 5MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      updatePharmacy("logoUrl", e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) processLogoFile(file);
  };

  const handleLogoDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add("billing-logo-wrap--dragging");
  };

  const handleLogoDragLeave = (e) => {
    e.currentTarget.classList.remove("billing-logo-wrap--dragging");
  };

  const handleLogoDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("billing-logo-wrap--dragging");
    const file = e.dataTransfer.files?.[0];
    if (file) processLogoFile(file);
  };

  const handleRemoveLogo = () => {
    updatePharmacy("logoUrl", "");
  };

  return (
    <div className="billing-page">
      <div className="billing-header-card">
        <PageHeader
          title="Billing"
          subtitle="Create invoices and quotations for patient transactions."
          actions={
            onBack ? (
              <ActionButton type="button" variant="secondary" className="back-button" onClick={onBack}>
                ← Back
              </ActionButton>
            ) : null
          }
        />
      </div>

      {restoreMessage && (
        <div className="billing-restore-message">{restoreMessage}</div>
      )}

      <div className="billing-controls no-print">
        <div className="billing-control-card">
          <h3 className="billing-section-title">Document Settings</h3>
          <div className="billing-settings-grid">
            <label>
              Mode
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
              >
                <option value="Invoice">Invoice</option>
                <option value="Quotation">Quotation</option>
              </select>
            </label>

            <label>
              {documentType} Number
              <input
                type="text"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder={documentType === "Invoice" ? "INV-1001" : "QUO-1001"}
              />
            </label>

            <label>
              Date
              <input
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="billing-control-card">
          <h3 className="billing-section-title">Medicine Search</h3>
          <div className="billing-search-box">
            <input
              type="text"
              value={drugQuery}
              onChange={(e) => {
                setDrugQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
              placeholder="Search by brand, generic, strength, drug code"
            />
            {showSuggestions && drugQuery.trim() && suggestions.length > 0 && (
              <ul className="billing-suggestions">
                {suggestions.map((drug) => (
                  <li key={`suggestion-${drug.drug_code || drug.display_name}`}>
                    <button
                      type="button"
                      onMouseDown={() => addItemFromDrug(drug)}
                      className="billing-suggestion-btn"
                    >
                      <span>{getDrugDisplayName(drug)}</span>
                      <span>
                        CSV public price
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="billing-helper-text">
            Selecting a medicine auto-fills public selling pack and unit prices from the CSV master.
          </p>
          {selectedMedicineMeta && (
            <div className="billing-selected-meta" role="status" aria-live="polite">
              <h4>Selected Medicine</h4>
              <div className="billing-selected-meta-grid">
                <div>
                  <span>Drug Name</span>
                  <strong>{selectedMedicineMeta.drugName || "-"}</strong>
                </div>
                <div>
                  <span>Strength</span>
                  <strong>{selectedMedicineMeta.strength || "-"}</strong>
                </div>
                <div>
                  <span>Package Size</span>
                  <strong>{selectedMedicineMeta.packageSize || "-"}</strong>
                </div>
                <div>
                  <span>Billing Unit</span>
                  <strong>{selectedMedicineMeta.billingUnit || "Pack"}</strong>
                </div>
                <div>
                  <span>Pack Price</span>
                  <strong>AED {formatCurrency(selectedMedicineMeta.defaultSellingPrice || 0)}</strong>
                </div>
                <div>
                  <span>Unit Price</span>
                  <strong>AED {formatCurrency(selectedMedicineMeta.defaultUnitPrice || 0)}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="billing-print-area">
        <div className="billing-document">
          <h3 className="billing-section-title">Invoice Preview</h3>

          <div className="billing-doc-header">
            <div className="billing-pharmacy-block">
              <div className="billing-subtitle no-print">Pharmacy Information</div>
              <div
                className="billing-logo-wrap"
                onDragOver={handleLogoDragOver}
                onDragLeave={handleLogoDragLeave}
                onDrop={handleLogoDrop}
              >
                {pharmacy.logoUrl ? (
                  <>
                    <img src={pharmacy.logoUrl} alt="Pharmacy logo" className="billing-logo" />
                    <button
                      type="button"
                      className="billing-logo-remove"
                      onClick={handleRemoveLogo}
                      title="Remove logo"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <>
                    <div className="billing-logo-placeholder">
                      <div className="billing-logo-placeholder-text">
                        Click to upload or
                        <br />
                        drag and drop image
                      </div>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="billing-logo-input"
                      aria-label="Upload pharmacy logo"
                    />
                  </>
                )}
              </div>
              <div className="billing-pharmacy-fields no-print">
                <input
                  type="text"
                  value={pharmacy.name}
                  onChange={(e) => updatePharmacy("name", e.target.value)}
                  placeholder="Pharmacy Name"
                />
                <input
                  type="text"
                  value={pharmacy.address}
                  onChange={(e) => updatePharmacy("address", e.target.value)}
                  placeholder="Pharmacy Address"
                />
                <input
                  type="text"
                  value={pharmacy.phone}
                  onChange={(e) => updatePharmacy("phone", e.target.value)}
                  placeholder="Pharmacy Phone"
                />
              </div>
              <div className="billing-pharmacy-static print-only">
                <h3>{pharmacy.name || "Pharmacy Name"}</h3>
                <p>{pharmacy.address || "Pharmacy Address"}</p>
                <p>{pharmacy.phone || "Pharmacy Phone"}</p>
              </div>
            </div>

            <div className="billing-doc-meta">
              <h1>{documentType}</h1>
              <p>
                <strong>{documentType} No:</strong> {documentNumber || "-"}
              </p>
              <p>
                <strong>Date:</strong> {documentDate || "-"}
              </p>
            </div>
          </div>

          <div className="billing-customer-section">
            <h3>Customer Information</h3>
            <div className="billing-customer-grid">
              <label>
                Customer Name
                <input
                  type="text"
                  value={customer.name}
                  onChange={(e) => updateCustomer("name", e.target.value)}
                  placeholder="Customer Name"
                />
              </label>
              <label>
                Customer Phone (optional)
                <input
                  type="text"
                  value={customer.phone}
                  onChange={(e) => updateCustomer("phone", e.target.value)}
                  placeholder="Phone"
                />
              </label>
              <label>
                MRN / File Number (optional)
                <input
                  type="text"
                  value={customer.mrn}
                  onChange={(e) => updateCustomer("mrn", e.target.value)}
                  placeholder="MRN / File Number"
                />
              </label>
            </div>
          </div>

          <div className="billing-table-section">
            <h3 className="billing-section-title">Items Table</h3>

            <div className="billing-table-actions no-print">
              <ActionButton
                type="button"
                variant="secondary"
                className="billing-secondary-btn"
                onClick={addManualItem}
              >
                Add Item
              </ActionButton>
            </div>

            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th className="no-print">Mode</th>
                    <th>Price</th>
                    <th>Discount</th>
                    <th>Total</th>
                    <th className="no-print">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="text"
                          value={item.item}
                          onChange={(e) => updateItem(item.id, "item", e.target.value)}
                          placeholder="Medicine or custom item"
                        />
                        {item.source === "database" && (
                          <div className="billing-item-meta-row">
                            <span>{item.strength || "-"}</span>
                            <span>Size: {item.packageSizeLabel || item.packageSize || "-"}</span>
                            <span>Unit: {item.billingUnit || "Pack"}</span>
                            {item.drugCode ? <span>Code: {item.drugCode}</span> : null}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                          className="billing-quantity-input"
                        />
                      </td>
                      <td className="no-print">
                        <select
                          value={item.saleMode || "pack"}
                          onChange={(e) => updateItem(item.id, "saleMode", e.target.value)}
                          className="billing-select"
                        >
                          <option value="pack">Pack</option>
                          <option value="unit">Unit</option>
                        </select>
                      </td>
                      <td>
                        {item.saleMode === "unit" ? (
                          <div className="billing-price-cell">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={getEffectiveUnitPrice(item)}
                              onChange={(e) =>
                                updateItem(item.id, "unitSalePrice", e.target.value)
                              }
                              placeholder="Unit price"
                              className="billing-price-input"
                              disabled={item.source === "database"}
                            />
                            <small className="billing-price-hint">
                              {item.source === "database"
                                ? `AED ${formatCurrency(getEffectiveUnitPrice(item))} per Unit`
                                : "Enter unit price manually"}
                            </small>
                          </div>
                        ) : (
                          <div className="billing-price-cell">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={getPackPrice(item)}
                              onChange={(e) =>
                                updateItem(item.id, "packagePrice", e.target.value)
                              }
                              placeholder="Pack price"
                              className="billing-price-input"
                              disabled={item.source === "database"}
                            />
                            <small className="billing-price-hint">per Pack</small>
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.discount}
                          onChange={(e) => updateItem(item.id, "discount", e.target.value)}
                        />
                      </td>
                      <td className="billing-row-total">
                        AED {formatCurrency(rowTotalMap[item.id] || 0)}
                      </td>
                      <td className="no-print">
                        <button
                          type="button"
                          className="billing-danger-btn"
                          onClick={() => removeItem(item.id)}
                          disabled={visibleItems.length <= 1}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="billing-totals-row">
            <h3 className="billing-section-title billing-summary-title">
              Totals / Summary
            </h3>

            <div className="billing-vat-box no-print">
              <label className="billing-toggle">
                <input
                  type="checkbox"
                  checked={vatEnabled}
                  onChange={(e) => setVatEnabled(e.target.checked)}
                />
                Enable VAT
              </label>

              <label>
                VAT %
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={vatRate}
                  disabled={!vatEnabled}
                  onChange={(e) =>
                    setVatRate(Math.max(sanitizeNumber(e.target.value, 0), 0))
                  }
                />
              </label>
            </div>

            <div className="billing-totals-box">
              <div className="billing-total-line">
                <span>Subtotal</span>
                <strong>AED {formatCurrency(totals.subtotal)}</strong>
              </div>
              <div className="billing-total-line">
                <span>VAT ({vatEnabled ? `${vatRate}%` : "0%"})</span>
                <strong>AED {formatCurrency(totals.vatAmount)}</strong>
              </div>
              <div className="billing-total-line grand">
                <span>Grand Total</span>
                <strong>AED {formatCurrency(totals.grandTotal)}</strong>
              </div>
            </div>
          </div>

          <div className="billing-footer-note">
            <p>
              {documentType === "Invoice"
                ? "Thank you for your purchase."
                : "This quotation is valid as per pharmacy policy."}
            </p>
          </div>
        </div>
      </div>

      <div className="billing-bottom-actions no-print">
        <ActionButton
          type="button"
          variant="secondary"
          className="billing-secondary-btn"
          onClick={addManualItem}
        >
          Add Item
        </ActionButton>
        <ActionButton
          type="button"
          variant="ghost"
          className="billing-clear-btn"
          onClick={handleClear}
        >
          Clear
        </ActionButton>
        <ActionButton
          type="button"
          variant="primary"
          className="billing-primary-btn"
          onClick={handlePrint}
        >
          Print
        </ActionButton>
      </div>

      <div className="billing-future-ready no-print">
        <h4>Future-Ready Notes</h4>
        <p>
          Designed for easy extension: saved pharmacy profile, saved invoices,
          quotation history, PDF export, barcode scanning, and POS integration.
        </p>
      </div>
    </div>
  );
}

export default Billing;