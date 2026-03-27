import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";

function formatCurrency(value) {
  const n = Number(value || 0);
  return `AED ${n.toFixed(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function deriveItem(item) {
  const systemQty = Number(item.system_qty || 0);
  const countedQty = Number(item.counted_qty || 0);
  const unitPrice = Number(item.unit_price || 0);
  const differenceQty = countedQty - systemQty;
  const valueDifference = differenceQty * unitPrice;

  return {
    ...item,
    system_qty: systemQty,
    counted_qty: countedQty,
    unit_price: unitPrice,
    difference_qty: differenceQty,
    value_difference: valueDifference,
  };
}

function downloadCsv(filename, rows) {
  if (!rows || rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const escapeCell = (value) => {
    const str = String(value ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Stocktaking() {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionItems, setSessionItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [newSite, setNewSite] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [barcodeInput, setBarcodeInput] = useState("");
  const [lastScanned, setLastScanned] = useState(null);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadSessionItems(selectedSessionId);
    } else {
      setSessionItems([]);
    }
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const summary = useMemo(() => {
    const openSessions = sessions.filter((s) => s.status === "open").length;
    const countedItems = sessionItems.filter((i) => Number(i.counted_qty || 0) > 0).length;
    const varianceItems = sessionItems.filter((i) => Number(i.difference_qty || 0) !== 0).length;
    const totalVarianceValue = sessionItems.reduce(
      (sum, i) => sum + Number(i.value_difference || 0),
      0
    );
    const negativeVarianceValue = sessionItems
      .filter((i) => Number(i.value_difference || 0) < 0)
      .reduce((sum, i) => sum + Number(i.value_difference || 0), 0);
    const positiveVarianceValue = sessionItems
      .filter((i) => Number(i.value_difference || 0) > 0)
      .reduce((sum, i) => sum + Number(i.value_difference || 0), 0);

    return {
      openSessions,
      countedItems,
      varianceItems,
      totalVarianceValue,
      negativeVarianceValue,
      positiveVarianceValue,
    };
  }, [sessions, sessionItems]);

  async function loadSessions() {
    setLoading(true);
    setFeedback({ type: "", message: "" });

    const { data, error } = await supabase
      .from("stocktaking_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setFeedback({ type: "error", message: error.message });
      setLoading(false);
      return;
    }

    setSessions(data || []);

    if (!selectedSessionId && data && data.length > 0) {
      setSelectedSessionId(data[0].id);
    }

    setLoading(false);
  }

  async function loadSessionItems(sessionId) {
    setLoading(true);

    const { data, error } = await supabase
      .from("stocktaking_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("drug_name", { ascending: true });

    if (error) {
      setFeedback({ type: "error", message: error.message });
      setLoading(false);
      return;
    }

    setSessionItems((data || []).map(deriveItem));
    setLoading(false);
  }

  async function createSession() {
    if (!newSessionName.trim()) {
      setFeedback({ type: "error", message: "Please enter a session name." });
      return;
    }

    setLoading(true);
    setFeedback({ type: "", message: "" });

    const payload = {
      session_name: newSessionName.trim(),
      site: newSite.trim() || null,
      notes: newNotes.trim() || null,
      status: "open",
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    const { data: sessionData, error: sessionError } = await supabase
      .from("stocktaking_sessions")
      .insert([payload])
      .select()
      .single();

    if (sessionError) {
      setFeedback({ type: "error", message: sessionError.message });
      setLoading(false);
      return;
    }

    const sessionId = sessionData.id;

    let expiryRows = null;
    let expiryError = null;

    const barcodeAttempt = await supabase
      .from("expiry_records")
      .select("drug_name, quantity, batch_no, expiry_date, barcode");

    if (barcodeAttempt.error) {
      const fallbackAttempt = await supabase
        .from("expiry_records")
        .select("drug_name, quantity, batch_no, expiry_date");

      expiryRows = fallbackAttempt.data || [];
      expiryError = fallbackAttempt.error || null;
    } else {
      expiryRows = barcodeAttempt.data || [];
      expiryError = null;
    }

    if (expiryError) {
      setFeedback({
        type: "error",
        message: `Session created, but snapshot failed: ${expiryError.message}`,
      });
      setLoading(false);
      await loadSessions();
      setSelectedSessionId(sessionId);
      return;
    }

    const grouped = {};
    for (const row of expiryRows) {
      const drugName = String(row.drug_name || "").trim();
      if (!drugName) continue;

      if (!grouped[drugName]) {
        grouped[drugName] = {
          session_id: sessionId,
          drug_name: drugName,
          barcode: row.barcode ?? null,
          batch_no: row.batch_no ?? null,
          expiry_date: row.expiry_date ?? null,
          system_qty: 0,
          counted_qty: 0,
          unit_price: 0,
          difference_qty: 0,
          value_difference: 0,
          counted_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
      }

      grouped[drugName].system_qty += Number(row.quantity || 0);

      if (!grouped[drugName].barcode && row.barcode) {
        grouped[drugName].barcode = row.barcode;
      }
      if (!grouped[drugName].batch_no && row.batch_no) {
        grouped[drugName].batch_no = row.batch_no;
      }
      if (!grouped[drugName].expiry_date && row.expiry_date) {
        grouped[drugName].expiry_date = row.expiry_date;
      }
    }

    const snapshotItems = Object.values(grouped).map(deriveItem);

    if (snapshotItems.length > 0) {
      const { error: itemsError } = await supabase
        .from("stocktaking_items")
        .insert(snapshotItems);

      if (itemsError) {
        setFeedback({
          type: "error",
          message: `Session created, but snapshot items failed: ${itemsError.message}`,
        });
        setLoading(false);
        await loadSessions();
        setSelectedSessionId(sessionId);
        return;
      }
    }

    setShowCreateModal(false);
    setNewSessionName("");
    setNewSite("");
    setNewNotes("");
    setSelectedSessionId(sessionId);

    await loadSessions();
    await loadSessionItems(sessionId);

    setFeedback({
      type: "success",
      message: `Stocktaking session created successfully with ${snapshotItems.length} snapshot items.`,
    });

    setLoading(false);
  }

  function updateLocalItem(itemId, newCountedQty) {
    setSessionItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? deriveItem({
              ...item,
              counted_qty: Number(newCountedQty || 0),
              counted_at: nowIso(),
              updated_at: nowIso(),
            })
          : item
      )
    );
  }

  async function saveProgress() {
    if (!selectedSession) {
      setFeedback({ type: "error", message: "Please select a session first." });
      return;
    }

    setLoading(true);

    for (const item of sessionItems) {
      const payload = {
        counted_qty: Number(item.counted_qty || 0),
        difference_qty: Number(item.difference_qty || 0),
        value_difference: Number(item.value_difference || 0),
        counted_at: item.counted_at || null,
        updated_at: nowIso(),
      };

      const { error } = await supabase
        .from("stocktaking_items")
        .update(payload)
        .eq("id", item.id);

      if (error) {
        setFeedback({ type: "error", message: error.message });
        setLoading(false);
        return;
      }
    }

    await supabase
      .from("stocktaking_sessions")
      .update({ updated_at: nowIso() })
      .eq("id", selectedSession.id);

    setFeedback({ type: "success", message: "Progress saved successfully." });
    setLoading(false);
  }

  async function closeSession() {
    if (!selectedSession) {
      setFeedback({ type: "error", message: "Please select a session first." });
      return;
    }

    if (selectedSession.status === "closed") {
      setFeedback({ type: "error", message: "This session is already closed." });
      return;
    }

    const ok = window.confirm("Are you sure you want to close this session?");
    if (!ok) return;

    setLoading(true);

    const { error } = await supabase
      .from("stocktaking_sessions")
      .update({
        status: "closed",
        closed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", selectedSession.id);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      setLoading(false);
      return;
    }

    await loadSessions();
    setFeedback({ type: "success", message: "Session closed successfully." });
    setLoading(false);
  }

  function exportVarianceReport() {
    if (!selectedSession || sessionItems.length === 0) {
      setFeedback({ type: "error", message: "No session data available to export." });
      return;
    }

    const rows = sessionItems.map((item) => ({
      session_name: selectedSession.session_name,
      site: selectedSession.site || "",
      drug_name: item.drug_name,
      barcode: item.barcode || "",
      batch_no: item.batch_no || "",
      expiry_date: item.expiry_date || "",
      system_qty: item.system_qty,
      counted_qty: item.counted_qty,
      difference_qty: item.difference_qty,
      unit_price: item.unit_price,
      value_difference: item.value_difference,
      counted_at: item.counted_at || "",
    }));

    const safeName = selectedSession.session_name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    downloadCsv(`stocktaking_variance_${safeName}.csv`, rows);
    setFeedback({ type: "success", message: "Variance report exported." });
  }

  async function handleBarcodeKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    if (!selectedSession) {
      setFeedback({ type: "error", message: "Please select a session first." });
      return;
    }

    if (selectedSession.status === "closed") {
      setFeedback({ type: "error", message: "Session is closed, scanning is disabled." });
      return;
    }

    const scanned = barcodeInput.trim();
    if (!scanned) return;

    const matched = sessionItems.find(
      (item) =>
        String(item.barcode || "").trim() !== "" &&
        String(item.barcode).trim() === scanned
    );

    if (!matched) {
      setLastScanned(null);
      setFeedback({
        type: "error",
        message: "Barcode not found in this stocktaking session",
      });
      setBarcodeInput("");
      return;
    }

    const newCount = Number(matched.counted_qty || 0) + 1;
    const updated = deriveItem({
      ...matched,
      counted_qty: newCount,
      counted_at: nowIso(),
      updated_at: nowIso(),
    });

    const { error } = await supabase
      .from("stocktaking_items")
      .update({
        counted_qty: updated.counted_qty,
        difference_qty: updated.difference_qty,
        value_difference: updated.value_difference,
        counted_at: updated.counted_at,
        updated_at: updated.updated_at,
      })
      .eq("id", matched.id);

    if (error) {
      setFeedback({ type: "error", message: error.message });
      setBarcodeInput("");
      return;
    }

    setSessionItems((prev) =>
      prev.map((item) => (item.id === matched.id ? updated : item))
    );

    setLastScanned({
      drug_name: updated.drug_name,
      barcode: updated.barcode,
      counted_qty: updated.counted_qty,
    });

    setFeedback({
      type: "success",
      message: `Scanned successfully: ${updated.drug_name} | Counted Qty: ${updated.counted_qty}`,
    });

    setBarcodeInput("");
  }

  const feedbackStyle =
    feedback.type === "error"
      ? {
          background: "#fde7e7",
          color: "#b42318",
          border: "1px solid #f3b4b4",
        }
      : feedback.type === "success"
      ? {
          background: "#e8f8ec",
          color: "#137333",
          border: "1px solid #b7e1c0",
        }
      : {};

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          background: "#fff",
          border: "1px solid #dbe3ee",
          borderRadius: 24,
          padding: 28,
          boxShadow: "0 2px 8px rgba(15,23,42,0.03)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 28, color: "#0f172a" }}>Stocktaking Sessions</h1>
        </div>

        <p
          style={{
            textAlign: "center",
            color: "#475569",
            fontSize: 16,
            marginTop: 0,
            marginBottom: 24,
          }}
        >
          Create controlled stocktaking snapshots, record counted quantities, and review variances without adjusting stock in v1.
        </p>

        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "14px 22px",
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: 18,
          }}
        >
          Start New Session
        </button>

        {feedback.message ? (
          <div
            style={{
              ...feedbackStyle,
              borderRadius: 14,
              padding: "14px 18px",
              marginBottom: 20,
              textAlign: "center",
              fontWeight: 600,
            }}
          >
            {feedback.message}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <MetricCard label="OPEN SESSIONS" value={summary.openSessions} />
          <MetricCard label="COUNTED ITEMS" value={summary.countedItems} />
          <MetricCard label="VARIANCE ITEMS" value={summary.varianceItems} />
          <MetricCard label="TOTAL VARIANCE VALUE" value={formatCurrency(summary.totalVarianceValue)} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "360px 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe3ee",
              borderRadius: 20,
              padding: 22,
              minHeight: 420,
            }}
          >
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>Sessions</h2>

            {sessions.length === 0 ? (
              <div
                style={{
                  border: "1px dashed #cbd5e1",
                  borderRadius: 18,
                  padding: 28,
                  textAlign: "center",
                  color: "#64748b",
                  lineHeight: 1.6,
                }}
              >
                No stocktaking sessions yet. Create the first session to capture a system stock snapshot.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {sessions.map((session) => {
                  const active = session.id === selectedSessionId;
                  return (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      style={{
                        textAlign: "left",
                        border: active ? "2px solid #2563eb" : "1px solid #dbe3ee",
                        background: active ? "#eff6ff" : "#fff",
                        borderRadius: 16,
                        padding: 14,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
                        {session.session_name}
                      </div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
                        Site: {session.site || session.location_name || "-"}
                      </div>
                      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>
                        Status:{" "}
                        <span
                          style={{
                            color: session.status === "open" ? "#137333" : "#b42318",
                            fontWeight: 700,
                          }}
                        >
                          {session.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        {session.created_at ? new Date(session.created_at).toLocaleString() : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe3ee",
              borderRadius: 20,
              padding: 22,
              minHeight: 420,
            }}
          >
            <h2 style={{ marginTop: 0, color: "#0f172a" }}>Session Workspace</h2>

            {!selectedSession ? (
              <div style={{ color: "#64748b" }}>Select a session to start counting.</div>
            ) : (
              <>
                <div style={{ marginBottom: 12, color: "#64748b" }}>
                  <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    {selectedSession.session_name}
                  </div>
                  <div>Site: {selectedSession.site || selectedSession.location_name || "-"}</div>
                  <div>Status: {selectedSession.status}</div>
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
                  <button
                    onClick={exportVarianceReport}
                    style={secondaryBtnStyle}
                  >
                    Export Variance Report
                  </button>

                  <button
                    onClick={saveProgress}
                    style={secondaryBtnStyle}
                  >
                    Save Progress
                  </button>

                  <button
                    onClick={closeSession}
                    style={dangerBtnStyle}
                  >
                    Close Session
                  </button>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 12,
                    marginBottom: 18,
                  }}
                >
                  <MetricCard
                    label="NEGATIVE VARIANCE VALUE"
                    value={formatCurrency(summary.negativeVarianceValue)}
                    valueColor="#dc2626"
                  />
                  <MetricCard
                    label="POSITIVE VARIANCE VALUE"
                    value={formatCurrency(summary.positiveVarianceValue)}
                    valueColor="#15803d"
                  />
                  <MetricCard
                    label="NET VARIANCE VALUE"
                    value={formatCurrency(summary.totalVarianceValue)}
                    valueColor={summary.totalVarianceValue < 0 ? "#dc2626" : "#15803d"}
                  />
                </div>

                <div
                  style={{
                    border: "1px solid #dbe3ee",
                    borderRadius: 18,
                    padding: 16,
                    marginBottom: 18,
                    background: selectedSession.status === "closed" ? "#f8fafc" : "#fff",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 10, color: "#0f172a" }}>
                    Barcode Scan
                  </div>

                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={handleBarcodeKeyDown}
                    disabled={selectedSession.status === "closed"}
                    placeholder={
                      selectedSession.status === "closed"
                        ? "Session closed, scanning disabled"
                        : "Scan barcode and press Enter"
                    }
                    style={{
                      width: "100%",
                      maxWidth: 420,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      outline: "none",
                      fontSize: 15,
                    }}
                  />

                  {lastScanned ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        borderRadius: 12,
                        background: "#eff6ff",
                        color: "#1e3a8a",
                        fontWeight: 600,
                      }}
                    >
                      Last scanned: {lastScanned.drug_name} | Barcode: {lastScanned.barcode || "-"} | Counted Qty: {lastScanned.counted_qty}
                    </div>
                  ) : null}
                </div>

                {sessionItems.length === 0 ? (
                  <div
                    style={{
                      border: "1px dashed #cbd5e1",
                      borderRadius: 18,
                      padding: 28,
                      textAlign: "center",
                      color: "#64748b",
                    }}
                  >
                    No items found in this session.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: 14,
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f8fafc", color: "#334155" }}>
                          <th style={thStyle}>Drug</th>
                          <th style={thStyle}>Barcode</th>
                          <th style={thStyle}>System Qty</th>
                          <th style={thStyle}>Counted Qty</th>
                          <th style={thStyle}>Difference</th>
                          <th style={thStyle}>Unit Price</th>
                          <th style={thStyle}>Value Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionItems.map((item) => (
                          <tr key={item.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={tdStyle}>{item.drug_name}</td>
                            <td style={tdStyle}>{item.barcode || "-"}</td>
                            <td style={tdStyle}>{item.system_qty}</td>
                            <td style={tdStyle}>
                              <input
                                type="number"
                                min="0"
                                value={item.counted_qty}
                                disabled={selectedSession.status === "closed"}
                                onChange={(e) => updateLocalItem(item.id, e.target.value)}
                                style={{
                                  width: 90,
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid #cbd5e1",
                                }}
                              />
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                color:
                                  Number(item.difference_qty) < 0
                                    ? "#dc2626"
                                    : Number(item.difference_qty) > 0
                                    ? "#15803d"
                                    : "#0f172a",
                                fontWeight: 700,
                              }}
                            >
                              {item.difference_qty}
                            </td>
                            <td style={tdStyle}>{formatCurrency(item.unit_price)}</td>
                            <td
                              style={{
                                ...tdStyle,
                                color:
                                  Number(item.value_difference) < 0
                                    ? "#dc2626"
                                    : Number(item.value_difference) > 0
                                    ? "#15803d"
                                    : "#0f172a",
                                fontWeight: 700,
                              }}
                            >
                              {formatCurrency(item.value_difference)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showCreateModal ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 22, color: "#0f172a", textAlign: "center" }}>
              Start New Stocktaking Session
            </h2>

            <label style={labelStyle}>Session Name</label>
            <input
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>Site</label>
            <input
              value={newSite}
              onChange={(e) => setNewSite(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>Notes</label>
            <textarea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 18 }}>
              <button onClick={() => setShowCreateModal(false)} style={secondaryBtnStyle}>
                Cancel
              </button>
              <button onClick={createSession} style={primaryBtnStyle}>
                Create Session
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 14, color: "#64748b", fontWeight: 600 }}>Loading...</div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, valueColor = "#0f172a" }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #dbe3ee",
        borderRadius: 18,
        padding: 18,
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.08em",
          color: "#64748b",
          marginBottom: 14,
          textAlign: "center",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 900,
          color: valueColor,
          textAlign: "center",
        }}
      >
        {value}
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "12px 10px",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 800,
};

const tdStyle = {
  padding: "12px 10px",
  color: "#0f172a",
  verticalAlign: "middle",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  marginBottom: 14,
  fontSize: 15,
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  marginBottom: 8,
  color: "#334155",
  fontWeight: 700,
};

const primaryBtnStyle = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryBtnStyle = {
  background: "#fff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerBtnStyle = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 20,
};

const modalCardStyle = {
  width: "100%",
  maxWidth: 620,
  background: "#fff",
  borderRadius: 24,
  padding: 26,
  boxShadow: "0 20px 50px rgba(15,23,42,0.20)",
};