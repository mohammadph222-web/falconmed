import { useMemo, useState } from "react";

export default function ShortageTracker() {
  const [items, setItems] = useState([
    {
      id: 1,
      drugName: "Ozempic 1mg",
      quantityRequested: 3,
      patientName: "Ahmed Ali",
      contactNumber: "0501234567",
      requestDate: "2026-03-24",
      status: "Pending",
      notes: "Patient will return tomorrow",
    },
    {
      id: 2,
      drugName: "Augmentin 1g",
      quantityRequested: 2,
      patientName: "Sara Hassan",
      contactNumber: "0559876543",
      requestDate: "2026-03-23",
      status: "Ordered",
      notes: "Supplier contacted",
    },
    {
      id: 3,
      drugName: "Enoxaparin 40mg",
      quantityRequested: 5,
      patientName: "Mariam Khaled",
      contactNumber: "0521112233",
      requestDate: "2026-03-22",
      status: "Completed",
      notes: "Patient notified",
    },
  ]);

  const [form, setForm] = useState({
    drugName: "",
    quantityRequested: "",
    patientName: "",
    contactNumber: "",
    requestDate: "",
    status: "Pending",
    notes: "",
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAdd = (e) => {
    e.preventDefault();

    if (
      !form.drugName ||
      !form.quantityRequested ||
      !form.patientName ||
      !form.contactNumber ||
      !form.requestDate
    ) {
      return;
    }

    const newItem = {
      id: Date.now(),
      drugName: form.drugName,
      quantityRequested: Number(form.quantityRequested),
      patientName: form.patientName,
      contactNumber: form.contactNumber,
      requestDate: form.requestDate,
      status: form.status,
      notes: form.notes,
    };

    setItems((prev) => [newItem, ...prev]);
    setForm({
      drugName: "",
      quantityRequested: "",
      patientName: "",
      contactNumber: "",
      requestDate: "",
      status: "Pending",
      notes: "",
    });
  };

  const updateStatus = (id, newStatus) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: newStatus } : item
      )
    );
  };

  const totals = useMemo(() => {
    const pending = items.filter((x) => x.status === "Pending").length;
    const ordered = items.filter((x) => x.status === "Ordered").length;
    const completed = items.filter((x) => x.status === "Completed").length;
    const totalQty = items.reduce(
      (sum, x) => sum + Number(x.quantityRequested || 0),
      0
    );

    return { pending, ordered, completed, totalQty };
  }, [items]);

  const getStatusStyle = (status) => {
    switch (status) {
      case "Pending":
        return badgePending;
      case "Ordered":
        return badgeOrdered;
      case "Completed":
        return badgeCompleted;
      default:
        return badgePending;
    }
  };

  return (
    <div>
      <h1 style={pageTitle}>Shortage Tracker</h1>

      <div style={cardsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Pending Requests</div>
          <div style={statValue}>{totals.pending}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Ordered Requests</div>
          <div style={statValue}>{totals.ordered}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Completed Requests</div>
          <div style={statValue}>{totals.completed}</div>
        </div>

        <div style={statCard}>
          <div style={statLabel}>Total Quantity Requested</div>
          <div style={statValue}>{totals.totalQty}</div>
        </div>
      </div>

      <div style={formCard}>
        <h2 style={sectionTitle}>Add Shortage Request</h2>

        <form onSubmit={handleAdd} style={formGrid}>
          <input
            style={input}
            placeholder="Drug Name"
            value={form.drugName}
            onChange={(e) => handleChange("drugName", e.target.value)}
          />

          <input
            style={input}
            type="number"
            placeholder="Quantity Requested"
            value={form.quantityRequested}
            onChange={(e) => handleChange("quantityRequested", e.target.value)}
          />

          <input
            style={input}
            placeholder="Patient Name"
            value={form.patientName}
            onChange={(e) => handleChange("patientName", e.target.value)}
          />

          <input
            style={input}
            placeholder="Contact Number"
            value={form.contactNumber}
            onChange={(e) => handleChange("contactNumber", e.target.value)}
          />

          <input
            style={input}
            type="date"
            value={form.requestDate}
            onChange={(e) => handleChange("requestDate", e.target.value)}
          />

          <select
            style={input}
            value={form.status}
            onChange={(e) => handleChange("status", e.target.value)}
          >
            <option value="Pending">Pending</option>
            <option value="Ordered">Ordered</option>
            <option value="Completed">Completed</option>
          </select>

          <input
            style={input}
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => handleChange("notes", e.target.value)}
          />

          <button type="submit" style={primaryBtn}>
            Add Request
          </button>
        </form>
      </div>

      <div style={tableCard}>
        <h2 style={sectionTitle}>Tracked Requests</h2>

        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Drug</th>
                <th style={th}>Qty</th>
                <th style={th}>Patient</th>
                <th style={th}>Contact</th>
                <th style={th}>Date</th>
                <th style={th}>Status</th>
                <th style={th}>Notes</th>
                <th style={th}>Action</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={td}>{item.drugName}</td>
                  <td style={td}>{item.quantityRequested}</td>
                  <td style={td}>{item.patientName}</td>
                  <td style={td}>{item.contactNumber}</td>
                  <td style={td}>{item.requestDate}</td>
                  <td style={td}>
                    <span style={getStatusStyle(item.status)}>{item.status}</span>
                  </td>
                  <td style={td}>{item.notes || "-"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        style={smallBtn}
                        onClick={() => updateStatus(item.id, "Pending")}
                        type="button"
                      >
                        Pending
                      </button>
                      <button
                        style={smallBtn}
                        onClick={() => updateStatus(item.id, "Ordered")}
                        type="button"
                      >
                        Ordered
                      </button>
                      <button
                        style={smallBtn}
                        onClick={() => updateStatus(item.id, "Completed")}
                        type="button"
                      >
                        Completed
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td colSpan="8" style={emptyCell}>
                    No shortage requests found.
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

const badgeOrdered = {
  ...badgeBase,
  background: "#dbeafe",
  color: "#1d4ed8",
};

const badgeCompleted = {
  ...badgeBase,
  background: "#dcfce7",
  color: "#166534",
};

const smallBtn = {
  padding: "8px 10px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  fontSize: "12px",
};

const emptyCell = {
  padding: "24px",
  textAlign: "center",
  color: "#64748b",
};