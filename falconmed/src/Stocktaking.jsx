import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { supabase } from "./lib/supabaseClient";
import { resolvePharmacyUnitPrice } from "./utils/drugPricing";

const sessionStatusStyles = {
  open: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
  closed: { background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" },
};

const feedbackStyles = {
  info: { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" },
  success: { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0" },
  error: { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" },
};

const initialSessionForm = {
  sessionName: "",
  site: "",
  notes: "",
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function roundToTwo(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatQuantity(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

function buildDerivedItem(item, nextFields = {}) {
  const nextItem = { ...item, ...nextFields };
  const systemQty = toNumber(nextItem.system_qty);
  const countedQty = toNumber(nextItem.counted_qty);
  const unitPrice = toNumber(nextItem.unit_price);
  const differenceQty = roundToTwo(countedQty - systemQty);
  const valueDifference = roundToTwo(differenceQty * unitPrice);

  return {
    ...nextItem,
    counted_qty: countedQty,
    difference_qty: differenceQty,
    unit_price: unitPrice,
    value_difference: valueDifference,
  };
}

function aggregateExpiryStock(records) {
  const grouped = new Map();

  for (const row of records || []) {
    const drugName = String(row?.drug_name || "").trim();
    if (!drugName) continue;

    const key = normalizeText(drugName);
    const quantity = toNumber(row?.quantity);

    if (!grouped.has(key)) {
      grouped.set(key, {
        drug_name: drugName,
        barcode: "",
        system_qty: 0,
      });
    }

    const current = grouped.get(key);
    current.system_qty = roundToTwo(current.system_qty + quantity);
  }

  return Array.from(grouped.values()).sort((left, right) =>
    left.drug_name.localeCompare(right.drug_name)
  );
}

function getCsvValue(row, keys) {
  const entries = Object.entries(row || {});

  for (const key of keys) {
    const normalizedKey = normalizeText(key).replace(/[_\s-]+/g, "");
    const match = entries.find(([entryKey]) => {
      const entryNormalized = normalizeText(entryKey).replace(/[_\s-]+/g, "");
      return entryNormalized === normalizedKey;
    });

    if (match && match[1] !== undefined && match[1] !== null && String(match[1]).trim() !== "") {
      return match[1];
    }
  }

  return "";
}

async function insertInChunks(table, rows, chunkSize = 500) {
  if (!supabase || !rows.length) return;

  for (let index = 0; index < rows.length; index += chunkSize) {
    const slice = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw error;
  }
}

export default function Stocktaking() {
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionItems, setSessionItems] = useState([]);
  const [dirtyItems, setDirtyItems] = useState({});
  const [metricsRows, setMetricsRows] = useState([]);
  const [feedback, setFeedback] = useState({ tone: "info", text: "" });
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [sessionForm, setSessionForm] = useState(initialSessionForm);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [quickEntryTerm, setQuickEntryTerm] = useState("");
  const [quickEntryQty, setQuickEntryQty] = useState("1");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  const isClosedSession = selectedSession?.status === "closed";

  const kpis = useMemo(() => {
    const openSessions = sessions.filter((session) => session.status === "open").length;
    const countedItems = metricsRows.filter((item) => toNumber(item.counted_qty) > 0).length;
    const varianceItems = metricsRows.filter((item) => roundToTwo(item.difference_qty) !== 0).length;
    const totalVarianceValue = metricsRows.reduce(
      (total, item) => total + Math.abs(toNumber(item.value_difference)),
      0
    );

    return {
      openSessions,
      countedItems,
      varianceItems,
      totalVarianceValue,
    };
  }, [metricsRows, sessions]);

  const varianceSummary = useMemo(() => {
    return sessionItems.reduce(
      (summary, item) => {
        const value = toNumber(item.value_difference);
        if (value > 0) summary.positive += value;
        if (value < 0) summary.negative += value;
        summary.net += value;
        return summary;
      },
      { positive: 0, negative: 0, net: 0 }
    );
  }, [sessionItems]);

  const filteredItems = useMemo(() => {
    const query = normalizeText(searchTerm);

    return sessionItems.filter((item) => {
      if (filterKey === "variance" && roundToTwo(item.difference_qty) === 0) return false;
      if (filterKey === "negative" && toNumber(item.difference_qty) >= 0) return false;
      if (filterKey === "positive" && toNumber(item.difference_qty) <= 0) return false;

      if (!query) return true;

      const matchesDrug = normalizeText(item.drug_name).includes(query);
      const matchesBarcode = normalizeText(item.barcode).includes(query);
      return matchesDrug || matchesBarcode;
    });
  }, [filterKey, searchTerm, sessionItems]);

  useEffect(() => {
    void refreshDashboard();
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionItems([]);
      setDirtyItems({});
      return;
    }

    void loadSessionItems(selectedSessionId);
  }, [selectedSessionId]);

  async function refreshDashboard(preferredSessionId = null) {
    await Promise.all([loadSessions(preferredSessionId), loadMetrics()]);
  }

  async function loadSessions(preferredSessionId = null) {
    if (!supabase) {
      setSessions([]);
      setSelectedSessionId(null);
      setLoadingSessions(false);
      setFeedback({
        tone: "error",
        text: "Supabase is not configured. Stocktaking is available after the environment is connected.",
      });
      return;
    }

    setLoadingSessions(true);

    const { data, error } = await supabase
      .from("stocktaking_sessions")
      .select("id,session_name,site,status,notes,created_at,closed_at")
      .order("created_at", { ascending: false })
      .limit(200);

    setLoadingSessions(false);

    if (error) {
      setSessions([]);
      setSelectedSessionId(null);
      setFeedback({
        tone: "error",
        text: "Stocktaking tables are not available yet. Run the SQL setup, then reload this module.",
      });
      return;
    }

    const rows = data || [];
    setSessions(rows);
    setSelectedSessionId((current) => {
      const desiredId = preferredSessionId || current;
      if (desiredId && rows.some((session) => session.id === desiredId)) {
        return desiredId;
      }
      return rows[0]?.id || null;
    });
  }

  async function loadMetrics() {
    if (!supabase) {
      setMetricsRows([]);
      return;
    }

    const { data, error } = await supabase
      .from("stocktaking_items")
      .select("counted_qty,difference_qty,value_difference")
      .limit(10000);

    if (error) {
      setMetricsRows([]);
      return;
    }

    setMetricsRows(data || []);
  }

  async function loadSessionItems(sessionId) {
    if (!supabase || !sessionId) {
      setSessionItems([]);
      setDirtyItems({});
      return;
    }

    setLoadingItems(true);

    const { data, error } = await supabase
      .from("stocktaking_items")
      .select(
        "id,session_id,drug_name,barcode,system_qty,counted_qty,difference_qty,unit_price,value_difference,created_at"
      )
      .eq("session_id", sessionId)
      .order("drug_name", { ascending: true })
      .limit(10000);

    setLoadingItems(false);

    if (error) {
      setSessionItems([]);
      setDirtyItems({});
      setFeedback({
        tone: "error",
        text: "Could not load stocktaking items for the selected session.",
      });
      return;
    }

    const rows = (data || []).map((item) => buildDerivedItem(item));
    setSessionItems(rows);
    setDirtyItems({});
  }

  function updateItem(itemId, nextFields) {
    setSessionItems((current) =>
      current.map((item) => (item.id === itemId ? buildDerivedItem(item, nextFields) : item))
    );
    setDirtyItems((current) => ({ ...current, [itemId]: true }));
  }

  function resetCreateModal() {
    setSessionForm(initialSessionForm);
    setShowCreateModal(false);
  }

  async function handleCreateSession(event) {
    event.preventDefault();

    const sessionName = sessionForm.sessionName.trim();
    if (!sessionName || !supabase) return;

    setCreatingSession(true);

    let createdSession = null;

    try {
      const { data: sessionRow, error: sessionError } = await supabase
        .from("stocktaking_sessions")
        .insert([
          {
            session_name: sessionName,
            site: sessionForm.site.trim() || null,
            status: "open",
            notes: sessionForm.notes.trim() || null,
          },
        ])
        .select("id,session_name,site,status,notes,created_at,closed_at")
        .single();

      if (sessionError) throw sessionError;
      createdSession = sessionRow;

      const { data: stockRows, error: stockError } = await supabase
        .from("expiry_records")
        .select("drug_name,quantity,batch_no,expiry_date")
        .limit(10000);

      if (stockError) throw stockError;

      const aggregatedStock = aggregateExpiryStock(stockRows || []);
      const itemsToInsert = aggregatedStock.map((item) => ({
        session_id: createdSession.id,
        drug_name: item.drug_name,
        barcode: item.barcode,
        system_qty: item.system_qty,
        counted_qty: 0,
        difference_qty: 0,
        unit_price: roundToTwo(resolvePharmacyUnitPrice(item.drug_name) ?? 0),
        value_difference: 0,
      }));

      await insertInChunks("stocktaking_items", itemsToInsert, 500);

      await refreshDashboard(createdSession.id);
      setSelectedSessionId(createdSession.id);
      resetCreateModal();
      setFeedback({
        tone: "success",
        text: `Stocktaking session created successfully with ${itemsToInsert.length} snapshot items.`,
      });
    } catch (error) {
      if (createdSession?.id && supabase) {
        await supabase.from("stocktaking_sessions").delete().eq("id", createdSession.id);
      }
      setFeedback({
        tone: "error",
        text: error?.message || "Could not create the stocktaking session.",
      });
    } finally {
      setCreatingSession(false);
    }
  }

  async function saveProgress(options = {}) {
    if (!supabase || !selectedSessionId) return false;

    const dirtyIds = Object.keys(dirtyItems).filter(Boolean);
    if (dirtyIds.length === 0) {
      if (!options.silent) {
        setFeedback({ tone: "success", text: "No unsaved stocktaking changes found." });
      }
      return true;
    }

    setSavingProgress(true);

    try {
      const payload = sessionItems
        .filter((item) => dirtyItems[item.id])
        .map((item) => ({
          id: item.id,
          session_id: item.session_id,
          drug_name: item.drug_name,
          barcode: item.barcode || null,
          system_qty: roundToTwo(item.system_qty),
          counted_qty: roundToTwo(item.counted_qty),
          difference_qty: roundToTwo(item.difference_qty),
          unit_price: roundToTwo(item.unit_price),
          value_difference: roundToTwo(item.value_difference),
        }));

      for (let index = 0; index < payload.length; index += 300) {
        const slice = payload.slice(index, index + 300);
        const { error } = await supabase
          .from("stocktaking_items")
          .upsert(slice, { onConflict: "id" });
        if (error) throw error;
      }

      setDirtyItems({});
      await loadMetrics();

      if (!options.silent) {
        setFeedback({ tone: "success", text: "Stocktaking progress saved." });
      }

      return true;
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error?.message || "Could not save stocktaking progress.",
      });
      return false;
    } finally {
      setSavingProgress(false);
    }
  }

  async function handleCloseSession() {
    if (!supabase || !selectedSession || selectedSession.status === "closed") return;

    setClosingSession(true);

    try {
      const saved = await saveProgress({ silent: true });
      if (!saved) return;

      const closedAt = new Date().toISOString();
      const { error } = await supabase
        .from("stocktaking_sessions")
        .update({ status: "closed", closed_at: closedAt })
        .eq("id", selectedSession.id);

      if (error) throw error;

      setSessions((current) =>
        current.map((session) =>
          session.id === selectedSession.id
            ? { ...session, status: "closed", closed_at: closedAt }
            : session
        )
      );
      setFeedback({ tone: "success", text: "Stocktaking session closed successfully." });
      await loadMetrics();
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error?.message || "Could not close the stocktaking session.",
      });
    } finally {
      setClosingSession(false);
    }
  }

  function handleQuickEntryApply() {
    const query = normalizeText(quickEntryTerm);
    const nextQty = roundToTwo(quickEntryQty);

    if (!query || nextQty < 0) {
      setFeedback({ tone: "error", text: "Enter a drug name or barcode and a valid counted quantity." });
      return;
    }

    const barcodeMatch = sessionItems.find((item) => normalizeText(item.barcode) === query);
    const drugMatch = sessionItems.find((item) => normalizeText(item.drug_name) === query);
    const matchedItem = barcodeMatch || drugMatch;

    if (!matchedItem) {
      setFeedback({ tone: "error", text: "No stocktaking item matched that barcode or drug name." });
      return;
    }

    updateItem(matchedItem.id, { counted_qty: nextQty });
    setSearchTerm(matchedItem.drug_name);
    setFeedback({
      tone: "success",
      text: `Count updated for ${matchedItem.drug_name}. Save progress when ready.`,
    });
  }

  function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingFile(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = Array.isArray(results.data) ? results.data : [];
        let matchedCount = 0;

        const nextItems = sessionItems.map((item) => ({ ...item }));
        const nextDirty = { ...dirtyItems };

        for (const row of rows) {
          const barcode = String(getCsvValue(row, ["barcode", "bar code", "ean", "code"]) || "").trim();
          const drugName = String(getCsvValue(row, ["drug_name", "drug name", "name", "item"]) || "").trim();
          const countedQtyRaw = getCsvValue(row, ["counted_qty", "counted qty", "quantity", "qty"]);
          const countedQty = roundToTwo(countedQtyRaw);

          const indexByBarcode = barcode
            ? nextItems.findIndex((item) => normalizeText(item.barcode) === normalizeText(barcode))
            : -1;
          const indexByDrug = drugName
            ? nextItems.findIndex((item) => normalizeText(item.drug_name) === normalizeText(drugName))
            : -1;
          const matchedIndex = indexByBarcode >= 0 ? indexByBarcode : indexByDrug;

          if (matchedIndex < 0) continue;

          const matchedItem = nextItems[matchedIndex];
          nextItems[matchedIndex] = buildDerivedItem(matchedItem, {
            barcode: barcode || matchedItem.barcode,
            counted_qty: countedQty,
          });
          nextDirty[matchedItem.id] = true;
          matchedCount += 1;
        }

        setSessionItems(nextItems);
        setDirtyItems(nextDirty);
        setImportingFile(false);
        event.target.value = "";

        if (matchedCount === 0) {
          setFeedback({
            tone: "error",
            text: "CSV import completed, but no rows matched by barcode or drug name.",
          });
          return;
        }

        setFeedback({
          tone: "success",
          text: `CSV import updated ${matchedCount} stocktaking item${matchedCount === 1 ? "" : "s"}. Save progress when ready.`,
        });
      },
      error: (error) => {
        setImportingFile(false);
        event.target.value = "";
        setFeedback({ tone: "error", text: error?.message || "Could not import the CSV file." });
      },
    });
  }

  function exportVarianceReport() {
    if (!selectedSession || sessionItems.length === 0) return;

    const csv = Papa.unparse(
      sessionItems.map((item) => ({
        drug_name: item.drug_name,
        barcode: item.barcode || "",
        system_qty: roundToTwo(item.system_qty),
        counted_qty: roundToTwo(item.counted_qty),
        difference_qty: roundToTwo(item.difference_qty),
        unit_price: roundToTwo(item.unit_price),
        value_difference: roundToTwo(item.value_difference),
      }))
    );

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSession.session_name.replace(/[^a-z0-9-_]+/gi, "-") || "stocktaking"}-variance-report.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  return (
    <div style={wrap}>
      <div style={headerCard}>
        <div>
          <h2 style={title}>Stocktaking Sessions</h2>
          <p style={subtitle}>
            Create controlled stocktaking snapshots, record counted quantities, and review variances without adjusting stock in v1.
          </p>
        </div>
        <button type="button" style={primaryBtn} onClick={() => setShowCreateModal(true)}>
          Start New Session
        </button>
      </div>

      {feedback.text ? (
        <div style={{ ...messageBox, ...(feedbackStyles[feedback.tone] || feedbackStyles.info) }}>
          {feedback.text}
        </div>
      ) : null}

      <div style={statsGrid}>
        <div style={statCard}>
          <div style={statLabel}>Open Sessions</div>
          <div style={statValue}>{kpis.openSessions}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Counted Items</div>
          <div style={statValue}>{kpis.countedItems}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Variance Items</div>
          <div style={statValue}>{kpis.varianceItems}</div>
        </div>
        <div style={statCard}>
          <div style={statLabel}>Total Variance Value</div>
          <div style={{ ...statValue, fontSize: "24px" }}>{formatCurrency(kpis.totalVarianceValue)}</div>
        </div>
      </div>

      <div style={splitGrid}>
        <div style={panelCard}>
          <div style={panelHeader}>
            <h3 style={sectionTitle}>Sessions</h3>
          </div>

          {loadingSessions ? (
            <div style={emptyState}>Loading stocktaking sessions...</div>
          ) : sessions.length === 0 ? (
            <div style={emptyState}>No stocktaking sessions yet. Create the first session to capture a system stock snapshot.</div>
          ) : (
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Session Name</th>
                    <th style={th}>Site</th>
                    <th style={th}>Status</th>
                    <th style={th}>Created At</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => {
                    const statusStyle =
                      sessionStatusStyles[session.status] || sessionStatusStyles.closed;

                    return (
                      <tr
                        key={session.id}
                        style={
                          session.id === selectedSessionId
                            ? { background: "#eff6ff" }
                            : undefined
                        }
                      >
                        <td style={tdStrong}>{session.session_name}</td>
                        <td style={td}>{session.site || "—"}</td>
                        <td style={td}>
                          <span style={{ ...statusBadge, ...statusStyle }}>
                            {String(session.status || "open").toUpperCase()}
                          </span>
                        </td>
                        <td style={td}>{formatDateTime(session.created_at)}</td>
                        <td style={td}>
                          <button
                            type="button"
                            style={secondaryBtn}
                            onClick={() => setSelectedSessionId(session.id)}
                          >
                            {session.id === selectedSessionId ? "Open" : "View"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={panelCard}>
          <div style={panelHeaderStack}>
            <div>
              <h3 style={sectionTitle}>Session Workspace</h3>
              <p style={sectionText}>
                {selectedSession
                  ? `${selectedSession.session_name}${selectedSession.site ? ` • ${selectedSession.site}` : ""}`
                  : "Select a session to start counting."}
              </p>
            </div>

            <div style={panelActions}>
              <button
                type="button"
                style={secondaryBtn}
                onClick={exportVarianceReport}
                disabled={!selectedSession || sessionItems.length === 0}
              >
                Export Variance Report
              </button>
              <button
                type="button"
                style={secondaryBtn}
                onClick={() => void saveProgress()}
                disabled={!selectedSession || isClosedSession || savingProgress}
              >
                {savingProgress ? "Saving..." : "Save Progress"}
              </button>
              <button
                type="button"
                style={dangerBtn}
                onClick={() => void handleCloseSession()}
                disabled={!selectedSession || isClosedSession || closingSession}
              >
                {isClosedSession ? "Session Closed" : closingSession ? "Closing..." : "Close Session"}
              </button>
            </div>
          </div>

          {!selectedSession ? (
            <div style={emptyState}>No session selected.</div>
          ) : (
            <>
              <div style={summaryGrid}>
                <div style={summaryCard}>
                  <div style={summaryLabel}>Negative Variance Value</div>
                  <div style={{ ...summaryValue, color: "#b91c1c" }}>
                    {formatCurrency(varianceSummary.negative)}
                  </div>
                </div>
                <div style={summaryCard}>
                  <div style={summaryLabel}>Positive Variance Value</div>
                  <div style={{ ...summaryValue, color: "#166534" }}>
                    {formatCurrency(varianceSummary.positive)}
                  </div>
                </div>
                <div style={summaryCard}>
                  <div style={summaryLabel}>Net Variance Value</div>
                  <div style={summaryValue}>{formatCurrency(varianceSummary.net)}</div>
                </div>
              </div>

              <div style={controlsGrid}>
                <div style={controlCard}>
                  <div style={controlTitle}>Manual / Barcode Entry</div>
                  <div style={controlRow}>
                    <input
                      type="text"
                      placeholder="Scan barcode or enter drug name"
                      style={textInput}
                      value={quickEntryTerm}
                      onChange={(event) => setQuickEntryTerm(event.target.value)}
                      disabled={isClosedSession}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={numberInput}
                      value={quickEntryQty}
                      onChange={(event) => setQuickEntryQty(event.target.value)}
                      disabled={isClosedSession}
                    />
                    <button
                      type="button"
                      style={primaryBtn}
                      onClick={handleQuickEntryApply}
                      disabled={isClosedSession}
                    >
                      Apply Count
                    </button>
                  </div>
                </div>

                <div style={controlCard}>
                  <div style={controlTitle}>Import Counts (CSV)</div>
                  <div style={controlRow}>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleImportFile}
                      disabled={isClosedSession || importingFile}
                    />
                    <div style={helperText}>Columns: drug_name, counted_qty, barcode (optional)</div>
                  </div>
                </div>
              </div>

              <div style={toolbar}>
                <input
                  type="text"
                  placeholder="Filter by drug name or barcode"
                  style={toolbarSearch}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />

                <div style={filterBar}>
                  {[
                    ["all", "All"],
                    ["variance", "Variance only"],
                    ["negative", "Negative only"],
                    ["positive", "Positive only"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      style={filterKey === key ? activeFilterBtn : filterBtn}
                      onClick={() => setFilterKey(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {loadingItems ? (
                <div style={emptyState}>Loading stocktaking items...</div>
              ) : filteredItems.length === 0 ? (
                <div style={emptyState}>No stocktaking items match the current filters.</div>
              ) : (
                <div style={tableWrap}>
                  <table style={wideTable}>
                    <thead>
                      <tr>
                        <th style={th}>Drug Name</th>
                        <th style={th}>Barcode</th>
                        <th style={th}>System Qty</th>
                        <th style={th}>Counted Qty</th>
                        <th style={th}>Difference Qty</th>
                        <th style={th}>Value Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => (
                        <tr key={item.id}>
                          <td style={tdStrong}>{item.drug_name}</td>
                          <td style={td}>
                            <input
                              type="text"
                              style={tableInput}
                              value={item.barcode || ""}
                              onChange={(event) => updateItem(item.id, { barcode: event.target.value })}
                              disabled={isClosedSession}
                            />
                          </td>
                          <td style={td}>{formatQuantity(item.system_qty)}</td>
                          <td style={td}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              style={tableNumberInput}
                              value={item.counted_qty}
                              onChange={(event) => updateItem(item.id, { counted_qty: event.target.value })}
                              disabled={isClosedSession}
                            />
                          </td>
                          <td style={td}>
                            <span
                              style={
                                toNumber(item.difference_qty) < 0
                                  ? negativeText
                                  : toNumber(item.difference_qty) > 0
                                    ? positiveText
                                    : neutralText
                              }
                            >
                              {formatQuantity(item.difference_qty)}
                            </span>
                          </td>
                          <td style={td}>
                            <span
                              style={
                                toNumber(item.value_difference) < 0
                                  ? negativeText
                                  : toNumber(item.value_difference) > 0
                                    ? positiveText
                                    : neutralText
                              }
                            >
                              {formatCurrency(item.value_difference)}
                            </span>
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

      {showCreateModal ? (
        <div style={modalOverlay}>
          <div style={modalCard}>
            <h3 style={modalTitle}>Start New Stocktaking Session</h3>
            <form style={modalForm} onSubmit={handleCreateSession}>
              <label style={fieldLabel}>
                Session Name
                <input
                  type="text"
                  style={modalInput}
                  value={sessionForm.sessionName}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, sessionName: event.target.value }))
                  }
                  placeholder="Month-end count"
                  required
                />
              </label>
              <label style={fieldLabel}>
                Site
                <input
                  type="text"
                  style={modalInput}
                  value={sessionForm.site}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, site: event.target.value }))
                  }
                  placeholder="Main Pharmacy"
                />
              </label>
              <label style={fieldLabel}>
                Notes
                <textarea
                  style={modalTextarea}
                  value={sessionForm.notes}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Optional handover notes"
                  rows={4}
                />
              </label>
              <div style={modalActions}>
                <button type="button" style={secondaryBtn} onClick={resetCreateModal}>
                  Cancel
                </button>
                <button type="submit" style={primaryBtn} disabled={creatingSession}>
                  {creatingSession ? "Creating..." : "Create Session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const wrap = { display: "grid", gap: "16px" };

const headerCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  padding: "20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
};

const title = { margin: 0, color: "#0f172a" };

const subtitle = {
  marginTop: "8px",
  marginBottom: 0,
  color: "#475569",
  fontSize: "14px",
  lineHeight: 1.6,
  maxWidth: "760px",
};

const messageBox = {
  borderRadius: "12px",
  padding: "12px 14px",
  fontSize: "14px",
};

const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const statCard = {
  background: "white",
  borderRadius: "16px",
  padding: "20px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.05)",
};

const statLabel = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  marginBottom: "8px",
};

const statValue = {
  marginTop: "10px",
  fontSize: "28px",
  color: "#0f172a",
  fontWeight: 700,
};

const splitGrid = {
  display: "grid",
  gridTemplateColumns: "minmax(320px, 0.95fr) minmax(520px, 1.45fr)",
  gap: "16px",
};

const panelCard = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 4px 16px rgba(15, 23, 42, 0.06)",
  padding: "20px",
  display: "grid",
  gap: "16px",
};

const panelHeader = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const panelHeaderStack = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap",
};

const panelActions = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const sectionTitle = { margin: 0, color: "#0f172a", fontSize: "18px" };

const sectionText = {
  margin: "6px 0 0",
  color: "#64748b",
  fontSize: "13px",
};

const summaryGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const summaryCard = {
  background: "#f8fafc",
  borderRadius: "14px",
  border: "1px solid #e2e8f0",
  padding: "16px",
};

const summaryLabel = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const summaryValue = {
  marginTop: "10px",
  fontSize: "20px",
  fontWeight: 700,
  color: "#0f172a",
};

const controlsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "12px",
};

const controlCard = {
  background: "#f8fafc",
  borderRadius: "14px",
  border: "1px solid #e2e8f0",
  padding: "16px",
  display: "grid",
  gap: "12px",
};

const controlTitle = {
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: 700,
};

const controlRow = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "center",
};

const helperText = {
  color: "#64748b",
  fontSize: "12px",
};

const toolbar = {
  display: "grid",
  gap: "12px",
};

const toolbarSearch = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  outline: "none",
  boxSizing: "border-box",
};

const filterBar = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const filterBtn = {
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
  borderRadius: "999px",
  padding: "8px 14px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const activeFilterBtn = {
  ...filterBtn,
  background: "#2563eb",
  border: "1px solid #2563eb",
  color: "#ffffff",
};

const primaryBtn = {
  padding: "10px 16px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryBtn = {
  padding: "10px 16px",
  background: "white",
  color: "#334155",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dangerBtn = {
  padding: "10px 16px",
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const textInput = {
  flex: 1,
  minWidth: "220px",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  outline: "none",
};

const numberInput = {
  width: "120px",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  outline: "none",
};

const tableWrap = { width: "100%", overflowX: "auto" };

const table = { width: "100%", borderCollapse: "collapse", minWidth: "680px" };

const wideTable = { width: "100%", borderCollapse: "collapse", minWidth: "920px" };

const th = {
  textAlign: "left",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "#64748b",
  background: "#f8fafc",
  borderBottom: "2px solid #e2e8f0",
  padding: "12px 14px",
  whiteSpace: "nowrap",
};

const td = {
  color: "#334155",
  padding: "12px 14px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: "14px",
  verticalAlign: "middle",
};

const tdStrong = { ...td, fontWeight: 600, color: "#0f172a" };

const statusBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  padding: "5px 10px",
};

const emptyState = {
  padding: "24px",
  color: "#64748b",
  background: "#f8fafc",
  borderRadius: "12px",
  border: "1px dashed #cbd5e1",
};

const tableInput = {
  width: "100%",
  minWidth: "140px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "8px 10px",
  fontSize: "13px",
  color: "#0f172a",
  outline: "none",
  boxSizing: "border-box",
};

const tableNumberInput = {
  ...tableInput,
  minWidth: "110px",
};

const neutralText = { color: "#334155", fontWeight: 600 };
const positiveText = { color: "#166534", fontWeight: 700 };
const negativeText = { color: "#b91c1c", fontWeight: 700 };

const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 1000,
};

const modalCard = {
  width: "100%",
  maxWidth: "460px",
  background: "white",
  borderRadius: "18px",
  border: "1px solid #e2e8f0",
  boxShadow: "0 20px 60px rgba(15, 23, 42, 0.18)",
  padding: "24px",
};

const modalTitle = {
  margin: 0,
  fontSize: "18px",
  color: "#0f172a",
};

const modalForm = {
  display: "grid",
  gap: "14px",
  marginTop: "18px",
};

const fieldLabel = {
  display: "grid",
  gap: "8px",
  fontSize: "13px",
  fontWeight: 600,
  color: "#334155",
};

const modalInput = {
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "14px",
  color: "#0f172a",
  outline: "none",
};

const modalTextarea = {
  ...modalInput,
  resize: "vertical",
  minHeight: "96px",
  fontFamily: "inherit",
};

const modalActions = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "4px",
  flexWrap: "wrap",
};