import { useEffect, useMemo, useState } from "react";

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

export default function DrugSearch() {
  const [allDrugs, setAllDrugs] = useState([]);
  const [loading, setLoading] = useState(true);

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
        const res = await fetch("/src/data/drugs_master.csv");
        const text = await res.text();

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
                    <button style={smallBtn}>View</button>
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
    </div>
  );
}

const pageTitle = {
  fontSize: "26px",
  marginTop: 0,
  marginBottom: "22px",
  color: "#0f172a",
};

const topCard = {
  background: "white",
  borderRadius: "16px",
  padding: "24px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "24px",
};

const searchLabel = {
  textAlign: "center",
  fontSize: "16px",
  marginBottom: "10px",
  color: "#0f172a",
  fontWeight: "bold",
};

const searchInput = {
  width: "100%",
  padding: "14px 16px",
  fontSize: "16px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const helperText = {
  marginTop: "12px",
  marginBottom: 0,
  textAlign: "center",
  color: "#475569",
  fontSize: "14px",
};

const filtersGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "18px",
};

const filterLabel = {
  display: "block",
  marginBottom: "8px",
  fontSize: "14px",
  color: "#334155",
  fontWeight: "bold",
};

const filterInput = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const statsBar = {
  marginBottom: "18px",
  color: "#334155",
  fontSize: "15px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const tableTitle = {
  marginTop: 0,
  marginBottom: "18px",
  textAlign: "center",
  color: "#0f172a",
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
  padding: "12px",
  borderBottom: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: "14px",
};

const td = {
  padding: "12px",
  borderBottom: "1px solid #f1f5f9",
  color: "#0f172a",
  fontSize: "14px",
};

const smallBtn = {
  padding: "8px 12px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};