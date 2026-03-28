import { useMemo, useState, useEffect } from "react";
import "./Billing.css";
import {
  getDrugDisplayName,
  getDrugUnitPrice,
  loadDrugMaster,
  searchDrugMaster,
} from "./utils/drugMaster";

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
  unitPrice: 0,
  discount: 0,
  source: "manual",
});

const sanitizeNumber = (value, fallback = 0) => {
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatCurrency = (value) => sanitizeNumber(value, 0).toFixed(2);

function Billing({ onBack }) {
  const [documentType, setDocumentType] = useState("Invoice");
  const [documentNumber, setDocumentNumber] = useState("INV-1001");
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [pharmacy, setPharmacy] = useState(INITIAL_PHARMACY);
  const [customer, setCustomer] = useState(INITIAL_CUSTOMER);

  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(5);

  const [items, setItems] = useState([createEmptyItem()]);

  const [drugs, setDrugs] = useState([]);
  const [drugQuery, setDrugQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    let isMounted = true;

    loadDrugMaster()
      .then((rows) => {
        if (isMounted) {
          setDrugs(rows || []);
        }
      })
      .catch((error) => {
        console.error("Failed to load billing drug source:", error);
        if (isMounted) {
          setDrugs([]);
        }
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
    setItems((prev) => [
      ...prev,
      {
        id: `drug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        item: label,
        quantity: 1,
        unitPrice: getDrugUnitPrice(drug, "public") || 0,
        discount: 0,
        source: "database",
      },
    ]);
    setDrugQuery("");
    setShowSuggestions(false);
  };

  const updateItem = (id, field, value) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        if (field === "item") {
          return { ...item, item: value };
        }

        if (field === "quantity") {
          return { ...item, quantity: Math.max(sanitizeNumber(value, 1), 0) };
        }

        if (field === "unitPrice") {
          return { ...item, unitPrice: Math.max(sanitizeNumber(value, 0), 0) };
        }

        if (field === "discount") {
          return { ...item, discount: Math.max(sanitizeNumber(value, 0), 0) };
        }

        return item;
      })
    );
  };

  const removeItem = (id) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== id) : prev));
  };

  const totals = useMemo(() => {
    const rows = items.map((item) => {
      const gross = sanitizeNumber(item.quantity, 0) * sanitizeNumber(item.unitPrice, 0);
      const discount = sanitizeNumber(item.discount, 0);
      const net = Math.max(gross - discount, 0);
      return {
        id: item.id,
        total: net,
      };
    });

    const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
    const vatAmount = vatEnabled ? subtotal * (Math.max(vatRate, 0) / 100) : 0;
    const grandTotal = subtotal + vatAmount;

    return {
      rows,
      subtotal,
      vatAmount,
      grandTotal,
    };
  }, [items, vatEnabled, vatRate]);

  const rowTotalMap = useMemo(() => {
    return totals.rows.reduce((acc, row) => {
      acc[row.id] = row.total;
      return acc;
    }, {});
  }, [totals.rows]);

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
    setItems([createEmptyItem()]);
    setDrugQuery("");
    setShowSuggestions(false);
  };

  return (
    <div className="billing-page">
      <div className="billing-header-bar">
        <button onClick={onBack} className="back-button">Back</button>
        <h2>Billing</h2>
      </div>

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
                      <span>AED {formatCurrency(getDrugUnitPrice(drug, "public") || 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="billing-helper-text">Selecting a medicine auto-fills the item name and default price. You can still edit the price manually in the table.</p>
        </div>
      </div>

      <div className="billing-print-area">
        <div className="billing-document">
          <h3 className="billing-section-title">Invoice Preview</h3>

          <div className="billing-doc-header">
            <div className="billing-pharmacy-block">
              <div className="billing-subtitle no-print">Pharmacy Information</div>
              <div className="billing-logo-wrap">
                {pharmacy.logoUrl ? (
                  <img src={pharmacy.logoUrl} alt="Pharmacy logo" className="billing-logo" />
                ) : (
                  <div className="billing-logo-placeholder">Logo</div>
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
                <input
                  type="text"
                  value={pharmacy.logoUrl}
                  onChange={(e) => updatePharmacy("logoUrl", e.target.value)}
                  placeholder="Logo URL (optional)"
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
              <button type="button" className="billing-secondary-btn" onClick={addManualItem}>Add Item</button>
            </div>

            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Unit Price</th>
                    <th>Discount</th>
                    <th>Total</th>
                    <th className="no-print">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="text"
                          value={item.item}
                          onChange={(e) => updateItem(item.id, "item", e.target.value)}
                          placeholder="Medicine or custom item"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={item.quantity}
                          onChange={(e) => updateItem(item.id, "quantity", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)}
                        />
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
                      <td className="billing-row-total">AED {formatCurrency(rowTotalMap[item.id] || 0)}</td>
                      <td className="no-print">
                        <button
                          type="button"
                          className="billing-danger-btn"
                          onClick={() => removeItem(item.id)}
                          disabled={items.length === 1}
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
            <h3 className="billing-section-title billing-summary-title">Totals / Summary</h3>

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
                  onChange={(e) => setVatRate(Math.max(sanitizeNumber(e.target.value, 0), 0))}
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
            <p>{documentType === "Invoice" ? "Thank you for your purchase." : "This quotation is valid as per pharmacy policy."}</p>
          </div>
        </div>
      </div>

      <div className="billing-bottom-actions no-print">
        <button type="button" className="billing-secondary-btn" onClick={addManualItem}>Add Item</button>
        <button type="button" className="billing-clear-btn" onClick={handleClear}>Clear</button>
        <button type="button" className="billing-primary-btn" onClick={handlePrint}>Print</button>
      </div>

      <div className="billing-future-ready no-print">
        <h4>Future-Ready Notes</h4>
        <p>Designed for easy extension: saved pharmacy profile, saved invoices, quotation history, PDF export, barcode scanning, and POS integration.</p>
      </div>
    </div>
  );
}

export default Billing;