import { useEffect, useMemo, useState } from "react";
import { getDrugDisplayName, loadDrugMaster } from "./utils/drugMaster";

function formatCoverageValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return "No";
  return text;
}

function parseNumber(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return null;
  const normalized = text.replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatPrice(value) {
  const num = parseNumber(value);
  if (num === null) return "-";
  return num.toFixed(2);
}

export default function DrugSearch() {
  const [allDrugs, setAllDrugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrug, setSelectedDrug] = useState(null);

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [genericFilter, setGenericFilter] = useState("");
  const [strengthFilter, setStrengthFilter] = useState("");
  const [dosageFilter, setDosageFilter] = useState("");
  const [rxFilter, setRxFilter] = useState("");
  const [uppFilter, setUppFilter] = useState("");
  const [thiqaFilter, setThiqaFilter] = useState("");
  const [basicFilter, setBasicFilter] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const rows = await loadDrugMaster();
        setAllDrugs(rows || []);
      } catch {
        setAllDrugs([]);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  const filteredDrugs = useMemo(() => {
    const q = search.toLowerCase().trim();

    return allDrugs.filter((drug) => {
      const searchMatch =
        !q ||
        drug.drug_name?.toLowerCase().includes(q) ||
        drug.brand_name?.toLowerCase().includes(q) ||
        drug.generic_name?.toLowerCase().includes(q) ||
        drug.drug_code?.toLowerCase().includes(q) ||
        drug.strength?.toLowerCase().includes(q) ||
        drug.dosage_form?.toLowerCase().includes(q) ||
        drug.barcode?.toLowerCase().includes(q);

      const brandMatch =
        !brandFilter || drug.brand_name?.toLowerCase().includes(brandFilter.toLowerCase());

      const genericMatch =
        !genericFilter || drug.generic_name?.toLowerCase().includes(genericFilter.toLowerCase());

      const strengthMatch =
        !strengthFilter || drug.strength?.toLowerCase().includes(strengthFilter.toLowerCase());

      const dosageMatch =
        !dosageFilter ||
        drug.dosage_form?.toLowerCase().includes(dosageFilter.toLowerCase());

      const rxMatch =
        !rxFilter || drug.dispense_mode?.toLowerCase().includes(rxFilter.toLowerCase());

      const uppMatch =
        !uppFilter || drug.upp_scope?.toLowerCase().includes(uppFilter.toLowerCase());

      const thiqaMatch =
        !thiqaFilter || drug.included_thiqa_abm?.toLowerCase().includes(thiqaFilter.toLowerCase());

      const basicMatch =
        !basicFilter ||
        drug.included_basic?.toLowerCase().includes(basicFilter.toLowerCase());

      return (
        searchMatch &&
        brandMatch &&
        genericMatch &&
        strengthMatch &&
        dosageMatch &&
        rxMatch &&
        uppMatch &&
        thiqaMatch &&
        basicMatch
      );
    });
  }, [
    allDrugs,
    search,
    brandFilter,
    genericFilter,
    strengthFilter,
    dosageFilter,
    rxFilter,
    uppFilter,
    thiqaFilter,
    basicFilter,
  ]);

  const displayedDrugs = filteredDrugs;

  return (
    <div>
      <h1 style={pageTitle}>Drug Search</h1>

      <div style={topCard}>
        <div style={searchLabel}>Search</div>
        <input
          type="text"
          placeholder="Search by brand / generic / drug code / strength / dosage form / barcode"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
        <p style={helperText}>
          Search by brand name, generic name, or drug code. Supports partial matches.
        </p>
      </div>

      <div style={filtersGrid}>
        <div>
          <label style={filterLabel}>Brand</label>
          <input
            type="text"
            placeholder="Filter by brand"
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Generic</label>
          <input
            type="text"
            placeholder="Filter by generic"
            value={genericFilter}
            onChange={(e) => setGenericFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Strength</label>
          <input
            type="text"
            placeholder="Filter by strength"
            value={strengthFilter}
            onChange={(e) => setStrengthFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Dosage Form</label>
          <input
            type="text"
            placeholder="Filter by dosage form"
            value={dosageFilter}
            onChange={(e) => setDosageFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Rx / OTC</label>
          <input
            type="text"
            placeholder="Filter by Rx/OTC"
            value={rxFilter}
            onChange={(e) => setRxFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>UPP Scope</label>
          <input
            type="text"
            placeholder="Filter by UPP scope"
            value={uppFilter}
            onChange={(e) => setUppFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Thiqa/ABM Coverage</label>
          <input
            type="text"
            placeholder="Filter by Thiqa/ABM"
            value={thiqaFilter}
            onChange={(e) => setThiqaFilter(e.target.value)}
            style={filterInput}
          />
        </div>

        <div>
          <label style={filterLabel}>Basic Coverage</label>
          <input
            type="text"
            placeholder="Filter by Basic Coverage"
            value={basicFilter}
            onChange={(e) => setBasicFilter(e.target.value)}
            style={filterInput}
          />
        </div>
      </div>

      <div style={statsBar}>
        {loading ? (
          <span>Loading drugs...</span>
        ) : (
          <span>
            <strong>Total loaded drugs:</strong> {allDrugs.length.toLocaleString()} |{" "}
            <strong>Filtered results:</strong> {filteredDrugs.length.toLocaleString()}{" "}
            (showing {displayedDrugs.length})
          </span>
        )}
      </div>

      <div style={tableCard}>
        <h2 style={tableTitle}>Drugs</h2>

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>BRAND</th>
                <th style={th}>GENERIC</th>
                <th style={th}>STRENGTH</th>
                <th style={th}>DOSAGE FORM</th>
                <th style={th}>RX/OTC</th>
                <th style={th}>PUBLIC PRICE</th>
                <th style={th}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {displayedDrugs.map((drug, index) => (
                <tr key={index}>
                  <td style={td}>{drug.brand_name || drug.drug_name || "-"}</td>
                  <td style={td}>{drug.generic_name || "-"}</td>
                  <td style={td}>{drug.strength || "-"}</td>
                  <td style={td}>{drug.dosage_form || "-"}</td>
                  <td style={td}>{drug.dispense_mode || "-"}</td>
                  <td style={td}>{drug.public_price || drug.price_to_public || "-"}</td>
                  <td style={td}>
                    <button style={smallBtn} onClick={() => setSelectedDrug(drug)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}

              {!loading && displayedDrugs.length === 0 && (
                <tr>
                  <td style={emptyCell} colSpan="7">
                    No matching drugs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDrug ? (
        <div style={modalOverlay} onClick={() => setSelectedDrug(null)}>
          <div style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <h3 style={modalTitle}>Drug Details</h3>
              <button style={closeBtn} onClick={() => setSelectedDrug(null)}>
                Close
              </button>
            </div>

            <div style={detailsGrid}>
              <div style={detailItem}>
                <div style={detailLabel}>Brand</div>
                <div style={detailValue}>{selectedDrug.brand_name || selectedDrug.drug_name || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Generic</div>
                <div style={detailValue}>{selectedDrug.generic_name || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Display Name</div>
                <div style={detailValue}>{getDrugDisplayName(selectedDrug) || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Strength</div>
                <div style={detailValue}>{selectedDrug.strength || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Dosage Form</div>
                <div style={detailValue}>{selectedDrug.dosage_form || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Drug Code</div>
                <div style={detailValue}>{selectedDrug.drug_code || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Barcode</div>
                <div style={detailValue}>{selectedDrug.barcode || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Rx / OTC</div>
                <div style={detailValue}>{selectedDrug.dispense_mode || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Public Price</div>
                <div style={detailValue}>{selectedDrug.public_price || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Package Size</div>
                <div style={detailValue}>{selectedDrug.package_size || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Package Units</div>
                <div style={detailValue}>{selectedDrug.pack_size || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Package Price to Pharmacy</div>
                <div style={detailValue}>
                  {selectedDrug.price_to_pharmacy || selectedDrug.pharmacy_price || "-"}
                </div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Package Price to Public</div>
                <div style={detailValue}>{selectedDrug.price_to_public || selectedDrug.public_price || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Unit Price to Pharmacy</div>
                <div style={detailValue}>
                  {selectedDrug.unit_price_to_pharmacy || selectedDrug.unit_price_pharmacy || "-"}
                </div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Unit Price to Public</div>
                <div style={detailValue}>{selectedDrug.unit_price_to_public || selectedDrug.unit_price_public || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Calculated Unit Price to Pharmacy</div>
                <div style={detailValue}>
                  {formatPrice(selectedDrug.unit_price_to_pharmacy || selectedDrug.unit_price_pharmacy)}
                </div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Calculated Unit Price to Public</div>
                <div style={detailValue}>
                  {formatPrice(selectedDrug.unit_price_to_public || selectedDrug.unit_price_public)}
                </div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>UPP Scope</div>
                <div style={detailValue}>{selectedDrug.upp_scope || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Thiqa/ABM Coverage</div>
                <div style={detailValue}>{formatCoverageValue(selectedDrug.included_thiqa_abm)}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Basic Coverage</div>
                <div style={detailValue}>{formatCoverageValue(selectedDrug.included_basic)}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const pageTitle = {
  fontSize: "28px",
  fontWeight: 700,
  marginTop: 0,
  marginBottom: "18px",
  color: "#0f172a",
};

const topCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e5eaf1",
  marginBottom: "18px",
};

const searchLabel = {
  textAlign: "left",
  fontSize: "14px",
  marginBottom: "8px",
  color: "#0f172a",
  fontWeight: 600,
};

const searchInput = {
  width: "100%",
  padding: "11px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const helperText = {
  marginTop: "10px",
  marginBottom: 0,
  textAlign: "left",
  color: "#475569",
  fontSize: "13px",
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
  marginBottom: "14px",
};

const filterLabel = {
  display: "block",
  marginBottom: "6px",
  fontSize: "13px",
  color: "#334155",
  fontWeight: 600,
};

const filterInput = {
  width: "100%",
  padding: "10px 12px",
  fontSize: "14px",
  borderRadius: "9px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const statsBar = {
  marginBottom: "14px",
  color: "#334155",
  fontSize: "14px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "18px",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.05)",
  border: "1px solid #e5eaf1",
};

const tableTitle = {
  marginTop: 0,
  marginBottom: "12px",
  textAlign: "left",
  color: "#0f172a",
  fontSize: "18px",
};

const tableWrap = {
  overflowX: "auto",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: "13px",
};

const td = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontSize: "13px",
};

const smallBtn = {
  padding: "7px 10px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "7px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 2000,
};

const modalCard = {
  width: "100%",
  maxWidth: "780px",
  maxHeight: "85vh",
  overflowY: "auto",
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.24)",
};

const modalHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "14px",
};

const modalTitle = {
  margin: 0,
  color: "#0f172a",
  fontSize: "20px",
};

const closeBtn = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#0f172a",
  borderRadius: "8px",
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const detailsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "10px",
};

const detailItem = {
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  padding: "10px",
  background: "#f8fafc",
};

const detailLabel = {
  fontSize: "12px",
  color: "#64748b",
  marginBottom: "6px",
  fontWeight: 700,
};

const detailValue = {
  fontSize: "14px",
  color: "#0f172a",
  wordBreak: "break-word",
};