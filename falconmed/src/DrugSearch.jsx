import { useEffect, useMemo, useState } from "react";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

function normalizeKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[\s/_-]+/g, "")
    .trim();
}

function getValue(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function formatCoverageValue(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return "No";
  return text;
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
    const loadCSV = async () => {
      try {
        const text = String(drugsMasterCsv || "");

        if (!text.trim()) {
          throw new Error("Drug dataset is empty or failed to import");
        }

        const lines = text
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "");

        if (lines.length < 2) {
          setAllDrugs([]);
          setLoading(false);
          return;
        }

        const rawHeaders = parseCSVLine(lines[0]);
        const headers = rawHeaders.map((h) => normalizeKey(h));

        const parsed = lines.slice(1).map((line) => {
          const cols = parseCSVLine(line);
          const rawRow = {};

          headers.forEach((header, index) => {
            rawRow[header] = cols[index] ?? "";
          });

          return {
            brand: getValue(rawRow, ["brand", "brandname", "packagename", "tradename"]),
            generic: getValue(rawRow, ["generic", "genericname", "scientificname"]),
            strength: getValue(rawRow, ["strength"]),
            dosage_form: getValue(rawRow, ["dosageform", "dosage", "form"]),
            drug_code: getValue(rawRow, ["drugcode", "code", "id"]),
            barcode: getValue(rawRow, ["barcode"]),
            rx_otc: getValue(rawRow, ["rxotc", "prescriptionrequired", "rx"]),
            upp_scope: getValue(rawRow, ["uppscope", "upp"]),
            thiqa_abm: getValue(rawRow, ["thiqaabmcoverage", "thiqaabm", "thiqa"]),
            basic_coverage: getValue(rawRow, ["basiccoverage", "basic"]),
            public_price: getValue(rawRow, ["publicprice", "price", "unitprice"]),
          };
        });

        setAllDrugs(parsed);
      } catch (error) {
        console.error("Error loading drugs CSV:", error);
        setAllDrugs([]);
      } finally {
        setLoading(false);
      }
    };

    loadCSV();
  }, []);

  const filteredDrugs = useMemo(() => {
    const q = search.toLowerCase().trim();

    return allDrugs.filter((drug) => {
      const searchMatch =
        !q ||
        drug.brand?.toLowerCase().includes(q) ||
        drug.generic?.toLowerCase().includes(q) ||
        drug.drug_code?.toLowerCase().includes(q) ||
        drug.strength?.toLowerCase().includes(q) ||
        drug.dosage_form?.toLowerCase().includes(q) ||
        drug.barcode?.toLowerCase().includes(q);

      const brandMatch =
        !brandFilter || drug.brand?.toLowerCase().includes(brandFilter.toLowerCase());

      const genericMatch =
        !genericFilter || drug.generic?.toLowerCase().includes(genericFilter.toLowerCase());

      const strengthMatch =
        !strengthFilter || drug.strength?.toLowerCase().includes(strengthFilter.toLowerCase());

      const dosageMatch =
        !dosageFilter ||
        drug.dosage_form?.toLowerCase().includes(dosageFilter.toLowerCase());

      const rxMatch =
        !rxFilter || drug.rx_otc?.toLowerCase().includes(rxFilter.toLowerCase());

      const uppMatch =
        !uppFilter || drug.upp_scope?.toLowerCase().includes(uppFilter.toLowerCase());

      const thiqaMatch =
        !thiqaFilter || drug.thiqa_abm?.toLowerCase().includes(thiqaFilter.toLowerCase());

      const basicMatch =
        !basicFilter ||
        drug.basic_coverage?.toLowerCase().includes(basicFilter.toLowerCase());

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

  const displayedDrugs = filteredDrugs.slice(0, 750);

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
            (showing top {displayedDrugs.length})
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
                  <td style={td}>{drug.brand || "-"}</td>
                  <td style={td}>{drug.generic || "-"}</td>
                  <td style={td}>{drug.strength || "-"}</td>
                  <td style={td}>{drug.dosage_form || "-"}</td>
                  <td style={td}>{drug.rx_otc || "-"}</td>
                  <td style={td}>{drug.public_price || "-"}</td>
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
                <div style={detailValue}>{selectedDrug.brand || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Generic</div>
                <div style={detailValue}>{selectedDrug.generic || "-"}</div>
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
                <div style={detailValue}>{selectedDrug.rx_otc || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Public Price</div>
                <div style={detailValue}>{selectedDrug.public_price || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>UPP Scope</div>
                <div style={detailValue}>{selectedDrug.upp_scope || "-"}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Thiqa/ABM Coverage</div>
                <div style={detailValue}>{formatCoverageValue(selectedDrug.thiqa_abm)}</div>
              </div>

              <div style={detailItem}>
                <div style={detailLabel}>Basic Coverage</div>
                <div style={detailValue}>{formatCoverageValue(selectedDrug.basic_coverage)}</div>
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