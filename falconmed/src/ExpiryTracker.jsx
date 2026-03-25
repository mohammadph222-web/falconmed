import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

const EXPIRY_TABLE = "expiry_records";

const mapDbToUi = (row) => ({
  id: row.id,
  drugName: row.drug_name,
  batchNo: row.batch_no,
  quantity: Number(row.quantity || 0),
  expiryDate: row.expiry_date,
  unitPrice: Number(row.unit_price || 0),
  location: row.location,
});

export default function ExpiryTracker({ user, profile }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    drugName: "",
    batchNo: "",
    quantity: "",
    expiryDate: "",
    unitPrice: "",
    location: "",
  });

  const today = new Date();

  const getMonthsLeft = (dateStr) => {
    const expiry = new Date(dateStr);
    const diffTime = expiry - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays / 30;
  };

  const getStatus = (dateStr) => {
    const monthsLeft = getMonthsLeft(dateStr);

    if (monthsLeft < 0) return "Expired";
    if (monthsLeft <= 3) return "High Risk";
    if (monthsLeft <= 6) return "Near Expiry";
    return "OK";
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case "Expired":
        return badgeExpired;
      case "High Risk":
        return badgeHighRisk;
      case "Near Expiry":
        return badgeNear;
      default:
        return badgeOk;
    }
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    const loadItems = async () => {
      setLoading(true);
      setMessage("");

      if (!profile?.organization_id) {
        setItems([]);
        setLoading(false);
        setMessage("Organization is still being set up. Please refresh shortly.");
        localStorage.setItem("falconmed_expiries", JSON.stringify([]));
        return;
      }

      try {
        let query = supabase
          .from(EXPIRY_TABLE)
          .select("*")
          .eq("organization_id", profile.organization_id)
          .order("created_at", { ascending: false });

        if (profile.site_id) {
          query = query.eq("site_id", profile.site_id);
        }

        const { data, error } = await query;

        if (error) {
          setItems([]);
          setMessage("Failed to load expiry records.");
          console.error("Failed to load expiry records:", error.message);
          localStorage.setItem("falconmed_expiries", JSON.stringify([]));
          return;
        }

        const mapped = (data || []).map(mapDbToUi);
        setItems(mapped);

        localStorage.setItem(
          "falconmed_expiries",
          JSON.stringify(
            mapped.map((item) => ({
              id: item.id,
              drug_name: item.drugName,
              batch_no: item.batchNo,
              quantity: item.quantity,
              expiry_date: item.expiryDate,
              status: getStatus(item.expiryDate),
              created_at: item.expiryDate,
            }))
          )
        );
      } catch (err) {
        setItems([]);
        setMessage("Failed to load expiry records.");
        console.error("Expiry load error:", err?.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    void loadItems();
  }, [profile?.organization_id, profile?.site_id]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setMessage("");

    if (
      !form.drugName ||
      !form.batchNo ||
      !form.quantity ||
      !form.expiryDate ||
      !form.unitPrice ||
      !form.location
    ) {
      return;
    }

    if (!profile?.organization_id || !profile?.site_id || !user?.id) {
      setMessage("Cannot save yet. User organization/site is not ready.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from(EXPIRY_TABLE)
        .insert({
          drug_name: form.drugName,
          batch_no: form.batchNo,
          quantity: Number(form.quantity),
          expiry_date: form.expiryDate,
          unit_price: Number(form.unitPrice),
          location: form.location,
          organization_id: profile.organization_id,
          site_id: profile.site_id,
          created_by: user.id,
        })
        .select("*")
        .single();

      if (error) {
        setMessage("Failed to save expiry item.");
        console.error("Failed to save expiry item:", error.message);
        return;
      }

      const newItem = mapDbToUi(data);
      setItems((prev) => {
        const next = [newItem, ...prev];
        localStorage.setItem(
          "falconmed_expiries",
          JSON.stringify(
            next.map((item) => ({
              id: item.id,
              drug_name: item.drugName,
              batch_no: item.batchNo,
              quantity: item.quantity,
              expiry_date: item.expiryDate,
              status: getStatus(item.expiryDate),
              created_at: item.expiryDate,
            }))
          )
        );
        return next;
      });
    } catch (err) {
      setMessage("Failed to save expiry item.");
      console.error("Expiry save error:", err?.message || "Unknown error");
      return;
    }

    setForm({
      drugName: "",
      batchNo: "",
      quantity: "",
      expiryDate: "",
      unitPrice: "",
      location: "",
    });
  };

  const totals = useMemo(() => {
    let totalValue = 0;
    let nearExpiryValue = 0;
    let highRiskValue = 0;
    let expiredValue = 0;

    items.forEach((item) => {
      const value = Number(item.quantity) * Number(item.unitPrice);
      const status = getStatus(item.expiryDate);

      totalValue += value;
      if (status === "Near Expiry") nearExpiryValue += value;
      if (status === "High Risk") highRiskValue += value;
      if (status === "Expired") expiredValue += value;
    });

    return {
      totalValue,
      nearExpiryValue,
      highRiskValue,
      expiredValue,
    };
  }, [items]);

  return (
    <div>
      <h1 style={pageTitle}>Expiry Tracker</h1>

      <div style={cardsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Total Stock Value</div>
          <div style={statValue}>{totals.totalValue.toLocaleString()} AED</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Near Expiry Value</div>
          <div style={statValue}>{totals.nearExpiryValue.toLocaleString()} AED</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>High Risk Value</div>
          <div style={statValue}>{totals.highRiskValue.toLocaleString()} AED</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Expired Value</div>
          <div style={statValue}>{totals.expiredValue.toLocaleString()} AED</div>
        </div>
      </div>

      <div style={formCard}>
        <h2 style={sectionTitle}>Add Expiry Item</h2>

        {message && <div style={messageBox}>{message}</div>}

        <form onSubmit={handleAdd} style={formGrid}>
          <input
            style={input}
            placeholder="Drug Name"
            value={form.drugName}
            onChange={(e) => handleChange("drugName", e.target.value)}
          />
          <input
            style={input}
            placeholder="Batch No"
            value={form.batchNo}
            onChange={(e) => handleChange("batchNo", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Quantity"
            value={form.quantity}
            onChange={(e) => handleChange("quantity", e.target.value)}
          />
          <input
            style={input}
            type="date"
            value={form.expiryDate}
            onChange={(e) => handleChange("expiryDate", e.target.value)}
          />
          <input
            style={input}
            type="number"
            placeholder="Unit Price"
            value={form.unitPrice}
            onChange={(e) => handleChange("unitPrice", e.target.value)}
          />
          <input
            style={input}
            placeholder="Location"
            value={form.location}
            onChange={(e) => handleChange("location", e.target.value)}
          />

          <button type="submit" style={primaryBtn}>
            Add Item
          </button>
        </form>
      </div>

      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Items</h2>

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Drug</th>
                <th style={th}>Batch</th>
                <th style={th}>Qty</th>
                <th style={th}>Unit Price</th>
                <th style={th}>Value</th>
                <th style={th}>Expiry Date</th>
                <th style={th}>Location</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    Loading expiry records...
                  </td>
                </tr>
              )}

              {items.map((item) => {
                const status = getStatus(item.expiryDate);
                const value = Number(item.quantity) * Number(item.unitPrice);

                return (
                  <tr key={item.id}>
                    <td style={td}>{item.drugName}</td>
                    <td style={td}>{item.batchNo}</td>
                    <td style={td}>{item.quantity}</td>
                    <td style={td}>{item.unitPrice}</td>
                    <td style={td}>{value.toLocaleString()} AED</td>
                    <td style={td}>{item.expiryDate}</td>
                    <td style={td}>{item.location}</td>
                    <td style={td}>
                      <span style={getStatusStyle(status)}>{status}</span>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    No expiry items found.
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

const cardsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "22px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
};

const statLabel = {
  fontSize: "13px",
  color: "#64748b",
  marginBottom: "10px",
};

const statValue = {
  fontSize: "24px",
  fontWeight: "bold",
  color: "#0f172a",
};

const formCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  marginBottom: "22px",
};

const sectionTitle = {
  marginTop: 0,
  marginBottom: "16px",
  color: "#0f172a",
};

const formGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
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

const input = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  borderRadius: "10px",
  border: "1px solid #cbd5e1",
  boxSizing: "border-box",
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

const tableCard = {
  background: "white",
  borderRadius: "16px",
  padding: "22px",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
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

const badgeBase = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: "bold",
};

const badgeOk = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
};

const badgeNear = {
  ...badgeBase,
  background: "#fef3c7",
  color: "#92400e",
};

const badgeHighRisk = {
  ...badgeBase,
  background: "#fee2e2",
  color: "#b91c1c",
};

const badgeExpired = {
  ...badgeBase,
  background: "#e2e8f0",
  color: "#334155",
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};