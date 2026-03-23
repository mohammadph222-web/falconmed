import { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import "./App.css";

const DRUGS_CSV_URL = `${import.meta.env.BASE_URL}drugs.csv`;

function DrugSearch({ onBack }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [drugs, setDrugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filters, setFilters] = useState({
    brand: "",
    generic: "",
    strength: "",
    dosageForm: ""
  });

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const loadDrugsData = async () => {
      try {
        setLoading(true);
        const response = await fetch(DRUGS_CSV_URL);
        if (!response.ok) {
          throw new Error(`Failed to load drugs data: ${response.status}`);
        }
        const csvText = await response.text();

        const parsedData = await new Promise((resolve, reject) => {
          Papa.parse(csvText, {
            header: false,
            skipEmptyLines: true,
            encoding: 'utf-8',
            complete: (results) => {
              if (results.errors.length > 0) {
                reject(new Error(results.errors[0].message));
              } else {
                resolve(results.data);
              }
            },
            error: (error) => reject(error)
          });
        });

        let dataRows = parsedData;
        if (dataRows.length > 0 && isNaN(parseInt(dataRows[0][0], 10))) {
          dataRows = dataRows.slice(1);
        }

        const parsedDrugs = dataRows
          .map((row, index) => {
            const id = parseInt(row[0], 10) || (index + 1);
            const brand = (row[1] || '').trim();
            const generic = (row[2] || '').trim();
            const strength = (row[3] || '').trim();
            const dosageForm = (row[4] || '').trim();
            const barcode = (row[5] || '').trim();
            return { id, brand, generic, strength, dosageForm, barcode };
          })
          .filter((drug) => drug.brand && drug.generic);

        setDrugs(parsedDrugs);
        setError(null);
      } catch (err) {
        console.error('Error loading drugs data:', err);
        setError(`Failed to load drug database: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    loadDrugsData();
  }, []);

  const normalizedDrugs = useMemo(
    () =>
      drugs.map((drug) => ({
        ...drug,
        __brand: drug.brand.toLowerCase(),
        __generic: drug.generic.toLowerCase(),
        __strength: drug.strength.toLowerCase(),
        __dosageForm: drug.dosageForm.toLowerCase(),
        __barcode: drug.barcode.toLowerCase()
      })),
    [drugs]
  );

  const brandOptions = useMemo(
    () => Array.from(new Set(drugs.map((d) => d.brand).filter(Boolean))).sort(),
    [drugs]
  );
  const genericOptions = useMemo(
    () => Array.from(new Set(drugs.map((d) => d.generic).filter(Boolean))).sort(),
    [drugs]
  );
  const strengthOptions = useMemo(
    () => Array.from(new Set(drugs.map((d) => d.strength).filter(Boolean))).sort(),
    [drugs]
  );
  const dosageFormOptions = useMemo(
    () => Array.from(new Set(drugs.map((d) => d.dosageForm).filter(Boolean))).sort(),
    [drugs]
  );

  const filteredDrugs = useMemo(() => {
    const search = debouncedQuery.trim().toLowerCase();
    const brandFilter = filters.brand.trim().toLowerCase();
    const genericFilter = filters.generic.trim().toLowerCase();
    const strengthFilter = filters.strength.trim().toLowerCase();
    const dosageFilter = filters.dosageForm.trim().toLowerCase();

    return normalizedDrugs.filter((drug) => {
      if (brandFilter && !drug.__brand.includes(brandFilter)) return false;
      if (genericFilter && !drug.__generic.includes(genericFilter)) return false;
      if (strengthFilter && !drug.__strength.includes(strengthFilter)) return false;
      if (dosageFilter && !drug.__dosageForm.includes(dosageFilter)) return false;

      if (!search) return true;

      const isNumeric = /^\d+$/.test(search);
      if (isNumeric && drug.__barcode.includes(search)) return true;

      return (
        drug.__brand.includes(search) ||
        drug.__generic.includes(search) ||
        drug.__strength.includes(search) ||
        drug.__dosageForm.includes(search) ||
        drug.__barcode.includes(search)
      );
    });
  }, [normalizedDrugs, debouncedQuery, filters]);

  const suggestions = useMemo(() => {
    const input = debouncedQuery.trim().toLowerCase();
    if (!input) return [];

    const suggestionSet = new Set();
    for (const drug of normalizedDrugs) {
      if (suggestionSet.size >= 8) break;
      if (drug.__brand.startsWith(input)) suggestionSet.add(drug.brand);
      if (drug.__generic.startsWith(input)) suggestionSet.add(drug.generic);
      if (drug.__strength.startsWith(input)) suggestionSet.add(drug.strength);
      if (drug.__dosageForm.startsWith(input)) suggestionSet.add(drug.dosageForm);
    }

    return Array.from(suggestionSet).slice(0, 8);
  }, [normalizedDrugs, debouncedQuery]);

  const displayedRows = filteredDrugs.slice(0, 750);

  const handleFilterChange = (field) => (event) => {
    setFilters((prev) => ({ ...prev, [field]: event.target.value }));
  };

  return (
    <div className="drug-search-container">
      <div className="drug-search-header">
        <button className="back-button" onClick={onBack}>← Back</button>
        <h2>Drug Search</h2>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading drug database...</p>
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#dc2626' }}>
          <p>{error}</p>
          <button className="view-button" onClick={() => window.location.reload()} style={{ background: '#dc2626' }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="search-input-container">
            <label htmlFor="drug-search" className="sr-only">Search</label>
            <input
              id="drug-search"
              type="text"
              className="search-input"
              placeholder="Search by brand / generic / strength / dosage form / barcode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="autocomplete-list">
                {suggestions.map((item, index) => (
                  <button
                    key={`${item}-${index}`}
                    type="button"
                    className="suggestion-item"
                    onClick={() => setQuery(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="filter-panel">
            <div className="filter-item">
              <label htmlFor="filter-brand">Brand</label>
              <input
                id="filter-brand"
                list="brand-list"
                value={filters.brand}
                onChange={handleFilterChange('brand')}
                placeholder="Filter by brand"
              />
              <datalist id="brand-list">
                {brandOptions.map((opt) => (
                  <option value={opt} key={`brand-${opt}`} />
                ))}
              </datalist>
            </div>
            <div className="filter-item">
              <label htmlFor="filter-generic">Generic</label>
              <input
                id="filter-generic"
                list="generic-list"
                value={filters.generic}
                onChange={handleFilterChange('generic')}
                placeholder="Filter by generic"
              />
              <datalist id="generic-list">
                {genericOptions.map((opt) => (
                  <option value={opt} key={`generic-${opt}`} />
                ))}
              </datalist>
            </div>
            <div className="filter-item">
              <label htmlFor="filter-strength">Strength</label>
              <input
                id="filter-strength"
                list="strength-list"
                value={filters.strength}
                onChange={handleFilterChange('strength')}
                placeholder="Filter by strength"
              />
              <datalist id="strength-list">
                {strengthOptions.map((opt) => (
                  <option value={opt} key={`strength-${opt}`} />
                ))}
              </datalist>
            </div>
            <div className="filter-item">
              <label htmlFor="filter-dosage">Dosage Form</label>
              <input
                id="filter-dosage"
                list="dosage-list"
                value={filters.dosageForm}
                onChange={handleFilterChange('dosageForm')}
                placeholder="Filter by dosage form"
              />
              <datalist id="dosage-list">
                {dosageFormOptions.map((opt) => (
                  <option value={opt} key={`dosage-${opt}`} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="results-summary">
            <p>
              Total loaded drugs: <strong>{drugs.length.toLocaleString()}</strong> | Filtered results: <strong>{filteredDrugs.length.toLocaleString()}</strong>
              {filteredDrugs.length > displayedRows.length && (
                <span> (showing top {displayedRows.length})</span>
              )}
            </p>
          </div>

          <div className="search-layout">
            <div className="results-panel">
              <h3>Drugs</h3>
              <div style={{ overflowX: "auto" }}>
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Brand</th>
                      <th>Generic</th>
                      <th>Strength</th>
                      <th>Dosage Form</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map((drug) => (
                      <tr key={drug.id}>
                        <td>{drug.brand}</td>
                        <td>{drug.generic}</td>
                        <td>{drug.strength}</td>
                        <td>{drug.dosageForm}</td>
                        <td>
                          <button className="view-button" onClick={() => setSelectedDrug(drug)}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="details-panel">
              <h3>Drug Details</h3>
              {!selectedDrug ? (
                <p className="no-selection">Select a drug from the table.</p>
              ) : (
                <div className="details-content">
                  <div className="detail-item">
                    <div className="detail-label">ID</div>
                    <div className="detail-value">{selectedDrug.id}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Brand Name</div>
                    <div className="detail-value">{selectedDrug.brand}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Generic Name</div>
                    <div className="detail-value">{selectedDrug.generic}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Strength</div>
                    <div className="detail-value">{selectedDrug.strength}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Dosage Form</div>
                    <div className="detail-value">{selectedDrug.dosageForm}</div>
                  </div>
                  {selectedDrug.barcode && (
                    <div className="detail-item">
                      <div className="detail-label">Barcode</div>
                      <div className="detail-value">{selectedDrug.barcode}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DrugSearch;
