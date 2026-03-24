import { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import "./App.css";
import drugsMasterCsv from "./data/drugs_master.csv?raw";

function DrugSearch({ onBack }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [drugs, setDrugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shortages, setShortages] = useState([]);
  const [expiries, setExpiries] = useState([]);
  const [refills, setRefills] = useState([]);

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
    const loadDrugsData = () => {
      try {
        setLoading(true);
        const csvText = drugsMasterCsv;

        const parsedData = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          transformHeader: (header) => header.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        });

        const dataRows = parsedData.data;

        const parsedDrugs = dataRows
          .map((row, index) => {
            const drug_code = (row.drug_code || row.drug_code?.trim?.() || '').trim();
            const brand = (row.brand_name || row.brand_name?.trim?.() || '').trim();
            const generic = (row.generic_name || row.generic_name?.trim?.() || '').trim();
            const strength = (row.strength || row.strength?.trim?.() || '').trim();
            const dosageForm = (row.dosage_form || row.dosage_form?.trim?.() || '').trim();
            const packageSize = (row.package_size || row.package_size?.trim?.() || '').trim();
            const rx_otc = (row.rx_otc || row.dispense_mode || row.rx_otc?.trim?.() || '').trim();
            const price_public = (row.price_public || row.public_price || row.price_public?.trim?.() || '').trim();
            const price_pharmacy = (row.price_pharmacy || row.pharmacy_price || row.price_pharmacy?.trim?.() || '').trim();
            const agent = (row.agent || row.agent_name || row.agent?.trim?.() || '').trim();
            const manufacturer = (row.manufacturer || row.manufacturer_name || row.manufacturer?.trim?.() || '').trim();
            const upp_scope = (row.upp_scope || row.upp_scope?.trim?.() || '').trim();
            const thiqa_abm_coverage = (row.thiqa_abm_coverage || row['included_in_thiqa_abm_other_than_1_7_drug_formulary'] || row.thiqa_abm_coverage?.trim?.() || '').trim();
            const basic_coverage = (row.basic_coverage || row.basic_coverage?.trim?.() || '').trim();

            const id = drug_code || index + 1;

            return {
              id,
              drug_code,
              brand,
              generic,
              strength,
              dosageForm,
              packageSize,
              rx_otc,
              price_public,
              price_pharmacy,
              agent,
              manufacturer,
              upp_scope,
              thiqa_abm_coverage,
              basic_coverage,
              barcode: (row.barcode || '').trim()
            };
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

    const loadIntelligenceData = () => {
      try {
        const shortagesData = localStorage.getItem('falconmed_shortages');
        const expiriesData = localStorage.getItem('falconmed_expiries');
        const refillsData = localStorage.getItem('falconmed_refills');
        setShortages(shortagesData ? JSON.parse(shortagesData) : []);
        setExpiries(expiriesData ? JSON.parse(expiriesData) : []);
        setRefills(refillsData ? JSON.parse(refillsData) : []);
      } catch (error) {
        console.error('Error loading intelligence data:', error);
      }
    };

    loadDrugsData();
    loadIntelligenceData();
  }, []);

  const normalizedDrugs = useMemo(
    () =>
      drugs.map((drug) => ({
        ...drug,
        __brand: (drug.brand || '').toLowerCase(),
        __generic: (drug.generic || '').toLowerCase(),
        __strength: (drug.strength || '').toLowerCase(),
        __dosageForm: (drug.dosageForm || '').toLowerCase(),
        __drug_code: (drug.drug_code || '').toLowerCase(),
        __barcode: (drug.barcode || '').toLowerCase()
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
      if (isNumeric && (drug.__barcode.includes(search) || drug.__drug_code.includes(search))) return true;

      return (
        drug.__brand.includes(search) ||
        drug.__generic.includes(search) ||
        drug.__drug_code.includes(search) ||
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
      if (drug.__drug_code.startsWith(input)) suggestionSet.add(drug.drug_code);
      if (drug.__strength.startsWith(input)) suggestionSet.add(drug.strength);
      if (drug.__dosageForm.startsWith(input)) suggestionSet.add(drug.dosageForm);
    }

    return Array.from(suggestionSet).slice(0, 8);
  }, [normalizedDrugs, debouncedQuery]);

  const displayedRows = filteredDrugs.slice(0, 750);

  const handleFilterChange = (field) => (event) => {
    setFilters((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const drugIntelligence = useMemo(() => {
    if (!selectedDrug) return null;

    const drugName = selectedDrug.brand || selectedDrug.generic;
    const shortageReports = shortages.filter(s => s.drug_name === drugName);
    const refillRequests = refills.filter(r => r.drug_name === drugName);
    const expiryAlerts = expiries.filter(e => e.drug_name === drugName);

    const shortageCount = shortageReports.length;
    const refillCount = refillRequests.length;
    const expiryCount = expiryAlerts.length;

    const lastShortageDate = shortageReports.length > 0
      ? new Date(Math.max(...shortageReports.map(s => new Date(s.requested_at || s.created_at))))
      : null;
    const lastRefillDate = refillRequests.length > 0
      ? new Date(Math.max(...refillRequests.map(r => new Date(r.created_at))))
      : null;

    let status = 'Available';
    let statusColor = 'green';
    if (shortageCount > 0) {
      status = 'Shortage';
      statusColor = 'red';
    } else if (expiryAlerts.some(e => e.status === 'Near Expiry')) {
      status = 'Near Expiry';
      statusColor = 'orange';
    }

    return {
      shortageCount,
      refillCount,
      expiryCount,
      lastShortageDate,
      lastRefillDate,
      status,
      statusColor
    };
  }, [selectedDrug, shortages, expiries, refills]);

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
                    <div className="detail-value">{selectedDrug.dosageForm || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Drug Code</div>
                    <div className="detail-value">{selectedDrug.drug_code || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Package Size</div>
                    <div className="detail-value">{selectedDrug.packageSize || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Rx/OTC</div>
                    <div className="detail-value">{selectedDrug.rx_otc || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Public Price</div>
                    <div className="detail-value">{selectedDrug.price_public || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Pharmacy Price</div>
                    <div className="detail-value">{selectedDrug.price_pharmacy || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Agent</div>
                    <div className="detail-value">{selectedDrug.agent || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Manufacturer</div>
                    <div className="detail-value">{selectedDrug.manufacturer || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">UPP Scope</div>
                    <div className="detail-value">{selectedDrug.upp_scope || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Thiqa/ABM Coverage</div>
                    <div className="detail-value">{selectedDrug.thiqa_abm_coverage || 'N/A'}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Basic Coverage</div>
                    <div className="detail-value">{selectedDrug.basic_coverage || 'N/A'}</div>
                  </div>

                  {/* Drug Intelligence Panel */}
                  {drugIntelligence && (
                    <>
                      <div className="intelligence-section">
                        <h4>Operational Insights</h4>
                        <div className="insight-item">
                          <span className="insight-label">Shortage Reports:</span>
                          <span className="insight-value">{drugIntelligence.shortageCount}</span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Refill Requests:</span>
                          <span className="insight-value">{drugIntelligence.refillCount}</span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Expiry Alerts:</span>
                          <span className="insight-value">{drugIntelligence.expiryCount}</span>
                        </div>
                      </div>

                      <div className="intelligence-section">
                        <h4>Status Indicator</h4>
                        <div className={`status-badge ${drugIntelligence.statusColor}`}>
                          {drugIntelligence.status}
                        </div>
                      </div>

                      <div className="intelligence-section">
                        <h4>Usage Insights</h4>
                        <div className="insight-item">
                          <span className="insight-label">Times in Shortages:</span>
                          <span className="insight-value">{drugIntelligence.shortageCount}</span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Last Refill Date:</span>
                          <span className="insight-value">
                            {drugIntelligence.lastRefillDate ? drugIntelligence.lastRefillDate.toLocaleDateString() : 'N/A'}
                          </span>
                        </div>
                        <div className="insight-item">
                          <span className="insight-label">Last Shortage Date:</span>
                          <span className="insight-value">
                            {drugIntelligence.lastShortageDate ? drugIntelligence.lastShortageDate.toLocaleDateString() : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </>
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
