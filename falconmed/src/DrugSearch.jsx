import { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import "./App.css";

function DrugSearch({ onBack }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedDrug, setSelectedDrug] = useState(null);
  const [drugs, setDrugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Load CSV data on component mount
  useEffect(() => {
    const loadDrugsData = async () => {
      try {
        setLoading(true);
        console.log('Parsing started');
        const response = await fetch('/drugs.csv');
        if (!response.ok) {
          throw new Error(`Failed to load drugs data: ${response.status}`);
        }
        const csvText = await response.text();
        
        // Parse CSV using PapaParse with worker
        const parsedData = await new Promise((resolve, reject) => {
          Papa.parse(csvText, {
            header: false,
            worker: true,
            skipEmptyLines: true,
            encoding: 'utf-8',
            complete: (results) => {
              console.log('Parsing finished');
              if (results.errors.length > 0) {
                reject(new Error(results.errors[0].message));
              } else {
                resolve(results.data);
              }
            },
            error: (error) => {
              reject(error);
            }
          });
        });
        
        console.log('Raw rows length:', parsedData.length);
        console.log('First 5 raw rows:', parsedData.slice(0, 5));
        
        // Ignore first row if it's clearly a header
        let dataRows = parsedData;
        if (parsedData.length > 0 && isNaN(parseInt(parsedData[0][0], 10))) {
          dataRows = parsedData.slice(1);
        }
        
        const parsedDrugs = dataRows.map((row, index) => {
          const id = parseInt(row[0], 10) || (index + 1);
          const brand = row[1] || '';
          const generic = row[2] || '';
          const strength = row[3] || '';
          const dosageForm = row[4] || '';
          const barcode = row[5] || '';
          return { id, brand, generic, strength, dosageForm, barcode };
        }).filter(drug => drug.brand && drug.generic);
        
        setDrugs(parsedDrugs);
        setError(null);
        
        // Debugging logs
        console.log('Total accepted medicines:', parsedDrugs.length);
        console.log('First 5 parsed medicines:', parsedDrugs.slice(0, 5));
      } catch (err) {
        console.error('Error loading drugs data:', err);
        setError(`Failed to load drug database: ${err.message}`);
        setLoading(false);
      } finally {
        setLoading(false);
      }
    };

    loadDrugsData();
  }, []);

  const filteredDrugs = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const isNumeric = /^\d+$/.test(q);

    if (!q) return drugs;

    return drugs.filter((drug) => {
      if (isNumeric && drug.barcode?.toLowerCase().includes(q)) {
        return true;
      }
      return (
        drug.brand?.toLowerCase().includes(q) ||
        drug.generic?.toLowerCase().includes(q) ||
        drug.strength?.toLowerCase().includes(q) ||
        drug.dosageForm?.toLowerCase().includes(q) ||
        drug.barcode?.toLowerCase().includes(q)
      );
    });
  }, [debouncedQuery, drugs]);

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
          <button
            className="view-button"
            onClick={() => window.location.reload()}
            style={{ background: '#dc2626' }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <p>Total loaded medicines: {drugs.length}</p>
          <div className="search-input-container">
            <input
              type="text"
              className="search-input"
              placeholder="Search by brand / generic / strength / dosage form / barcode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="search-layout">
            <div className="results-panel">
              <h3>Showing results: {filteredDrugs.length}</h3>

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
                    {filteredDrugs.map((drug) => (
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