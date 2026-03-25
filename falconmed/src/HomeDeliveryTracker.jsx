import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

const DELIVERY_TABLE = "delivery_requests";

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
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

const mapDbToUi = (row) => ({
  id: row.id,
  patientName: row.patient_name || "",
  contactNumber: row.contact_number || "",
  address: row.address || "",
  itemName: row.item_name || "",
  quantity: Number(row.quantity || 0),
  deliveryType: row.delivery_type || "Standard",
  driverName: row.driver_name || "-",
  paymentMethod: row.payment_method || "-",
  status: row.status || "Pending",
  notes: row.notes || "",
  createdAt: row.created_at || "",
});

export default function HomeDeliveryTracker() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [allDrugs, setAllDrugs] = useState([]);
  const [itemSearch, setItemSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [form, setForm] = useState({
    patientName: "",
    contactNumber: "",
    address: "",
    itemName: "",
    quantity: "",
    deliveryType: "Standard",
    driverName: "",
    paymentMethod: "Cash",
    status: "Pending",
    notes: "",
  });

  const loadItems = async () => {
    setLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from(DELIVERY_TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setItems([]);
        setMessage("Failed to load delivery requests.");
        console.error("Failed to load delivery requests:", error.message);
        return;
      }

      setItems((data || []).map(mapDbToUi));
    } catch (error) {
      setItems([]);
      setMessage("Failed to load delivery requests.");
      console.error("Delivery fetch error:", error?.message || error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  useEffect(() => {
    const loadDrugs = async () => {
      try {
        const response = await fetch("/src/data/drugs_master.csv");
        if (!response.ok) {
          throw new Error("Failed to load drug dataset");
        }

        const text = await response.text();
        const lines = text
          .split(/\r?\n/)
          .filter((line) => line.trim() !== "");

        if (lines.length < 2) {
          setAllDrugs([]);
          return;
        }

        const rawHeaders = parseCSVLine(lines[0]);
        const headers = rawHeaders.map((header) => normalizeKey(header));

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
            dosageForm: getValue(rawRow, ["dosageform", "dosage", "form"]),
          };
        });

        setAllDrugs(parsed);
      } catch (error) {
        console.error("Failed to load delivery drug suggestions:", error?.message || error);
        setAllDrugs([]);
      }
    };

    void loadDrugs();
  }, []);

  const filteredDrugs = useMemo(() => {
    if (!itemSearch.trim() || !showDropdown) return [];

    const query = itemSearch.toLowerCase().trim();
    return allDrugs
      .filter((drug) => {
        return (
          drug.brand?.toLowerCase().includes(query) ||
          drug.generic?.toLowerCase().includes(query) ||
          drug.strength?.toLowerCase().includes(query) ||
          drug.dosageForm?.toLowerCase().includes(query)
        );
      })
      .slice(0, 25);
  }, [allDrugs, itemSearch, showDropdown]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleDrugSelect = (drug) => {
    const displayName = drug.brand
      ? `${drug.brand}${drug.strength ? ` (${drug.strength})` : ""}`
      : `${drug.generic || "Unknown"}${drug.strength ? ` (${drug.strength})` : ""}`;

    setForm((prev) => ({ ...prev, itemName: displayName }));
    setItemSearch(displayName);
    setShowDropdown(false);
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setMessage("");

    if (!form.patientName || !form.contactNumber || !form.address || !form.itemName || !form.quantity) {
      setMessage("Please complete the required delivery request fields.");
      return;
    }

    try {
      const { error } = await supabase.from(DELIVERY_TABLE).insert({
        patient_name: form.patientName,
        contact_number: form.contactNumber,
        address: form.address,
        item_name: form.itemName,
        quantity: Number(form.quantity),
        delivery_type: form.deliveryType,
        driver_name: form.driverName,
        payment_method: form.paymentMethod,
        status: form.status,
        notes: form.notes,
      });

      if (error) {
        setMessage("Failed to save delivery request.");
        console.error("Failed to save delivery request:", error.message);
        return;
      }

      await loadItems();
      setMessage("Delivery request added successfully.");
      setForm({
        patientName: "",
        contactNumber: "",
        address: "",
        itemName: "",
        quantity: "",
        deliveryType: "Standard",
        driverName: "",
        paymentMethod: "Cash",
        status: "Pending",
        notes: "",
      });
      setItemSearch("");
      setShowDropdown(false);
    } catch (error) {
      setMessage("Failed to save delivery request.");
      console.error("Delivery insert error:", error?.message || error);
    }
  };

  return (
    <div>
      <h1 style={pageTitle}>Home Delivery Tracker</h1>

      <div style={formCard}>
        <h2 style={sectionTitle}>Add Delivery Request</h2>
        {message && <div style={messageBox}>{message}</div>}

        <form onSubmit={handleAdd} style={formGrid}>
          <input
            style={input}
            placeholder="Patient Name"
            value={form.patientName}
            onChange={(event) => handleChange("patientName", event.target.value)}
          />
          <input
            style={input}
            placeholder="Contact Number"
            value={form.contactNumber}
            onChange={(event) => handleChange("contactNumber", event.target.value)}
          />
          <input
            style={input}
            placeholder="Address"
            value={form.address}
            onChange={(event) => handleChange("address", event.target.value)}
          />
          <div style={searchWrap}>
            <input
              style={input}
              placeholder="Item / Drug Name"
              value={itemSearch || form.itemName}
              onChange={(event) => {
                setItemSearch(event.target.value);
                handleChange("itemName", event.target.value);
              }}
              onFocus={() => setShowDropdown(true)}
            />
            {showDropdown && filteredDrugs.length > 0 && (
              <div style={dropdown}>
                {filteredDrugs.map((drug, index) => {
                  const label = drug.brand
                    ? `${drug.brand}${drug.strength ? ` (${drug.strength})` : ""}`
                    : `${drug.generic || "Unknown"}${drug.strength ? ` (${drug.strength})` : ""}`;

                  return (
                    <div
                      key={`${label}-${index}`}
                      style={dropdownItem}
                      onClick={() => handleDrugSelect(drug)}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
            )}
            {showDropdown && itemSearch && filteredDrugs.length === 0 && (
              <div style={dropdownEmpty}>No matching drug found. You can type a manual item name.</div>
            )}
          </div>
          <input
            style={input}
            type="number"
            placeholder="Quantity"
            value={form.quantity}
            onChange={(event) => handleChange("quantity", event.target.value)}
          />
          <select
            style={input}
            value={form.deliveryType}
            onChange={(event) => handleChange("deliveryType", event.target.value)}
          >
            <option value="Standard">Standard</option>
            <option value="Urgent">Urgent</option>
            <option value="Same Day">Same Day</option>
          </select>
          <input
            style={input}
            placeholder="Driver / Courier Name"
            value={form.driverName}
            onChange={(event) => handleChange("driverName", event.target.value)}
          />
          <select
            style={input}
            value={form.paymentMethod}
            onChange={(event) => handleChange("paymentMethod", event.target.value)}
          >
            <option value="Cash">Cash</option>
            <option value="Card">Card</option>
            <option value="Insurance">Insurance</option>
            <option value="Online">Online</option>
          </select>
          <select
            style={input}
            value={form.status}
            onChange={(event) => handleChange("status", event.target.value)}
          >
            <option value="Pending">Pending</option>
            <option value="Assigned">Assigned</option>
            <option value="Dispatched">Dispatched</option>
            <option value="Delivered">Delivered</option>
          </select>
          <textarea
            style={textarea}
            placeholder="Notes"
            value={form.notes}
            onChange={(event) => handleChange("notes", event.target.value)}
          />
          <button type="submit" style={primaryBtn}>Add Delivery Request</button>
        </form>
      </div>

      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Delivery Requests</h2>
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Patient</th>
                <th style={th}>Contact</th>
                <th style={th}>Address</th>
                <th style={th}>Item</th>
                <th style={th}>Qty</th>
                <th style={th}>Delivery Type</th>
                <th style={th}>Driver</th>
                <th style={th}>Payment</th>
                <th style={th}>Status</th>
                <th style={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="10" style={emptyCell}>Loading delivery requests...</td>
                </tr>
              )}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="10" style={emptyCell}>No delivery requests found.</td>
                </tr>
              )}

              {items.map((item) => (
                <tr key={item.id}>
                  <td style={td}>{item.patientName}</td>
                  <td style={td}>{item.contactNumber}</td>
                  <td style={td}>{item.address}</td>
                  <td style={td}>{item.itemName}</td>
                  <td style={td}>{item.quantity}</td>
                  <td style={td}>{item.deliveryType}</td>
                  <td style={td}>{item.driverName}</td>
                  <td style={td}>{item.paymentMethod}</td>
                  <td style={td}><span style={getStatusStyle(item.status)}>{item.status}</span></td>
                  <td style={td}>{item.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const getStatusStyle = (status) => {
  switch (status) {
    case "Assigned":
      return badgeAssigned;
    case "Dispatched":
      return badgeDispatched;
    case "Delivered":
      return badgeDelivered;
    default:
      return badgePending;
  }
};

const pageTitle = {
  fontSize: "26px",
  marginTop: 0,
  marginBottom: "22px",
  color: "#0f172a",
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "22px",
};

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  color: "#0f172a",
};

const messageBox = {
  marginBottom: "12px",
  padding: "10px 12px",
  borderRadius: "10px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: "14px",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const input = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
};

const textarea = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
  gridColumn: "1 / -1",
  minHeight: "84px",
  resize: "vertical",
  fontFamily: "inherit",
};

const searchWrap = {
  position: "relative",
};

const dropdown = {
  position: "absolute",
  top: "48px",
  left: 0,
  right: 0,
  background: "white",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.1)",
  zIndex: 1000,
  maxHeight: "250px",
  overflowY: "auto",
};

const dropdownItem = {
  padding: "10px 14px",
  cursor: "pointer",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "14px",
  color: "#0f172a",
};

const dropdownEmpty = {
  position: "absolute",
  top: "48px",
  left: 0,
  right: 0,
  background: "#f8fafc",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 14px",
  color: "#64748b",
  fontSize: "14px",
  zIndex: 1000,
};

const primaryBtn = {
  padding: "12px 14px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: "bold",
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
  verticalAlign: "top",
};

const badgeBase = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "bold",
};

const badgePending = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
};

const badgeAssigned = {
  ...badgeBase,
  background: "#dbeafe",
  color: "#1d4ed8",
};

const badgeDispatched = {
  ...badgeBase,
  background: "#ede9fe",
  color: "#6d28d9",
};

const badgeDelivered = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};
