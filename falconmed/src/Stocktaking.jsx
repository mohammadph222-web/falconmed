import React, { useEffect, useMemo, useRef, useState } from "react";
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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function parseCsvLine(line) {
  return String(line || "")
    .split(",")
    .map((cell) => cell.trim());
}

function normalizeHeader(header) {
  return normalizeText(header).toLowerCase().replace(/\s+/g, "_");
}

function getFirstValue(row, candidates) {
  for (const key of candidates) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

async function readCsvFile(file) {
  const text = await file.text();
  const rawLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (rawLines.length < 2) {
    throw new Error(`File "${file.name}" is empty or missing data rows.`);
  }

  const headers = parseCsvLine(rawLines[0]).map(normalizeHeader);

  return rawLines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function buildCompareKey(row) {
  const drugCode = normalizeKey(
    getFirstValue(row, ["drug_code", "item_code", "code", "sku"])
  );
  if (drugCode) return `code:${drugCode}`;

  const barcode = normalizeKey(getFirstValue(row, ["barcode", "ean", "gtin"]));
  if (barcode) return `barcode:${barcode}`;

  const drugName = normalizeKey(
    getFirstValue(row, ["drug_name", "item_name", "name", "description"])
  );
  if (drugName) return `name:${drugName}`;

  return "";
}

function buildSystemMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = buildCompareKey(row);
    if (!key) continue;

    const previous = map.get(key) || {
      drug_name: "",
      barcode: "",
      batch_no: "",
      expiry_date: "",
      system_qty: 0,
      unit_price: 0,
    };

    const systemQty = toNumber(
      getFirstValue(row, ["system_qty", "quantity", "qty", "stock_qty"])
    );

    const unitPrice = toNumber(
      getFirstValue(row, ["unit_price", "price", "cost", "unit_cost"])
    );

    map.set(key, {
      drug_name:
        normalizeText(
          getFirstValue(row, ["drug_name", "item_name", "name", "description"])
        ) || previous.drug_name,
      barcode:
        normalizeText(getFirstValue(row, ["barcode", "ean", "gtin"])) ||
        previous.barcode,
      batch_no: normalizeText(getFirstValue(row, ["batch_no", "batch"])) || previous.batch_no,
      expiry_date:
        normalizeText(getFirstValue(row, ["expiry_date", "expiry"])) ||
        previous.expiry_date,
      system_qty: previous.system_qty + systemQty,
      unit_price: unitPrice || previous.unit_price,
    });
  }

  return map;
}

function buildCountedMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = buildCompareKey(row);
    if (!key) continue;

    const previous = map.get(key) || {
      drug_name: "",
      barcode: "",
      counted_qty: 0,
    };

    const countedQty = toNumber(
      getFirstValue(row, ["counted_qty", "quantity", "qty", "count_qty"])
    );

    map.set(key, {
      drug_name:
        normalizeText(
          getFirstValue(row, ["drug_name", "item_name", "name", "description"])
        ) || previous.drug_name,
      barcode:
        normalizeText(getFirstValue(row, ["barcode", "ean", "gtin"])) ||
        previous.barcode,
      counted_qty: previous.counted_qty + countedQty,
    });
  }

  return map;
}

function mergeComparedItemsByDrugName(items, sessionId, now) {
  const grouped = new Map();

  for (const item of items) {
    const drugName = normalizeText(item.drug_name);
    if (!drugName) continue;

    const key = normalizeKey(drugName);
    const previous = grouped.get(key);

    if (!previous) {
      grouped.set(key, deriveItem({ ...item, drug_name: drugName }));
      continue;
    }

    grouped.set(
      key,
      deriveItem({
        ...previous,
        session_id: sessionId,
        drug_name: previous.drug_name || drugName,
        barcode: previous.barcode || item.barcode || null,
        batch_no: previous.batch_no || item.batch_no || null,
        expiry_date: previous.expiry_date || item.expiry_date || null,
        system_qty: Number(previous.system_qty || 0) + Number(item.system_qty || 0),
        counted_qty: Number(previous.counted_qty || 0) + Number(item.counted_qty || 0),
        unit_price: Number(previous.unit_price || 0) || Number(item.unit_price || 0) || 0,
        counted_at: now,
        updated_at: now,
      })
    );
  }

  return Array.from(grouped.values());
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

function getVarianceQtyColor(value) {
  const n = Number(value || 0);
  if (n < 0) return "#dc2626";
  if (n > 0) return "#15803d";
  return "#0f172a";
}

function getVarianceStatusLabel(item) {
  const diff = Number(item?.difference_qty || 0);
  if (diff < 0) return "SHORT";
  if (diff > 0) return "OVER";
  return "MATCH";
}

function getVarianceStatusStyle(item) {
  const diff = Number(item?.difference_qty || 0);

  if (diff < 0) {
    return {
      ...statusBadgeBase,
      color: "#b42318",
      background: "#fef2f2",
      border: "1px solid #fecaca",
    };
  }

  if (diff > 0) {
    return {
      ...statusBadgeBase,
      color: "#137333",
      background: "#ecfdf5",
      border: "1px solid #a7f3d0",
    };
  }

  return {
    ...statusBadgeBase,
    color: "#1d4ed8",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  };
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

  const [systemCompareFileName, setSystemCompareFileName] = useState("");
  const [countedCompareFileName, setCountedCompareFileName] = useState("");
  const [systemCompareFile, setSystemCompareFile] = useState(null);
  const [countedCompareFile, setCountedCompareFile] = useState(null);
  const [isComparingFiles, setIsComparingFiles] = useState(false);
  const [compareFeedback, setCompareFeedback] = useState({ type: "", message: "" });

  const systemFileInputRef = useRef(null);
  const countedFileInputRef = useRef(null);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    setSessionItems([]);
    setBarcodeInput("");
    setLastScanned(null);
    setSystemCompareFileName("");
    setCountedCompareFileName("");
    setSystemCompareFile(null);
    setCountedCompareFile(null);
    setCompareFeedback({ type: "", message: "" });

    if (systemFileInputRef.current) {
      systemFileInputRef.current.value = "";
    }

    if (countedFileInputRef.current) {
      countedFileInputRef.current.value = "";
    }

    if (selectedSessionId) {
      void loadSessionItems(selectedSessionId);
    }
  }, [selectedSessionId]);

  const selectedSession = useMemo(
    () =>
      sessions.find((s) => String(s.id) === String(selectedSessionId)) || null,
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

  async function runTwoFileComparison() {
    setCompareFeedback({ type: "", message: "" });

    if (!selectedSession) {
      setCompareFeedback({ type: "error", message: "Please select a session first." });
      return;
    }

    if (selectedSession.status === "closed") {
      setCompareFeedback({
        type: "error",
        message: "Session is closed, file comparison is disabled.",
      });
      return;
    }

    if (!systemCompareFile || !countedCompareFile) {
      setCompareFeedback({
        type: "error",
        message: "Please choose both files before running comparison.",
      });
      return;
    }

    setIsComparingFiles(true);
    setLoading(true);

    try {
      const [systemRows, countedRows] = await Promise.all([
        readCsvFile(systemCompareFile),
        readCsvFile(countedCompareFile),
      ]);

      const systemMap = buildSystemMap(systemRows);
      const countedMap = buildCountedMap(countedRows);
      const allKeys = new Set([...systemMap.keys(), ...countedMap.keys()]);
      const now = nowIso();

      const rawComparedItems = Array.from(allKeys)
        .map((key) => {
          const systemItem = systemMap.get(key) || {};
          const countedItem = countedMap.get(key) || {};

          return deriveItem({
            session_id: selectedSession.id,
            drug_name:
              normalizeText(systemItem.drug_name) ||
              normalizeText(countedItem.drug_name) ||
              "Unnamed item",
            barcode:
              normalizeText(systemItem.barcode) ||
              normalizeText(countedItem.barcode) ||
              null,
            batch_no: normalizeText(systemItem.batch_no) || null,
            expiry_date: normalizeText(systemItem.expiry_date) || null,
            system_qty: toNumber(systemItem.system_qty),
            counted_qty: toNumber(countedItem.counted_qty),
            unit_price: toNumber(systemItem.unit_price),
            counted_at: now,
            created_at: now,
            updated_at: now,
          });
        })
        .filter((item) => normalizeText(item.drug_name));

      const comparedItems = mergeComparedItemsByDrugName(
        rawComparedItems,
        selectedSession.id,
        now
      );

      if (comparedItems.length === 0) {
        throw new Error("No comparable rows were found in the uploaded files.");
      }

      const { error: deleteError } = await supabase
        .from("stocktaking_items")
        .delete()
        .eq("session_id", selectedSession.id);

      if (deleteError) {
        throw new Error(deleteError.message || "Failed to clear previous stocktaking items.");
      }

      const { error: insertError } = await supabase
        .from("stocktaking_items")
        .insert(comparedItems);

      if (insertError) {
        throw new Error(insertError.message || "Failed to insert comparison result.");
      }

      await supabase
        .from("stocktaking_sessions")
        .update({ updated_at: nowIso() })
        .eq("id", selectedSession.id);

      setSessionItems(comparedItems);
      setCompareFeedback({
        type: "success",
        message: `Comparison completed successfully. ${comparedItems.length} items were updated in this session.`,
      });
      setFeedback({
        type: "success",
        message: `Comparison completed successfully. ${comparedItems.length} items were updated in this session.`,
      });
    } catch (error) {
      setCompareFeedback({
        type: "error",
        message: error?.message || "Two-file comparison failed.",
      });
    } finally {
      setIsComparingFiles(false);
      setLoading(false);
    }
  }

  const feedbackStyle =
    feedback.type === "error"
      ? {
          background: "#fef2f2",
          color: "#b42318",
          border: "1px solid #fecaca",
        }
      : feedback.type === "success"
      ? {
          background: "#ecfdf5",
          color: "#137333",
          border: "1px solid #a7f3d0",
        }
      : {};

  const compareFeedbackStyle =
    compareFeedback.type === "error"
      ? {
          background: "#fef2f2",
          color: "#b42318",
          border: "1px solid #fecaca",
        }
      : compareFeedback.type === "success"
      ? {
          background: "#ecfdf5",
          color: "#137333",
          border: "1px solid #a7f3d0",
        }
      : {};

  return (
    <div style={pageShell}>
      <div style={pageWrap}>
        <div style={heroCard}>
          <div style={heroTopRow}>
            <div style={heroContent}>
              <div style={heroEyebrow}>Operations Workspace</div>
              <h1 style={heroTitle}>Stocktaking Sessions</h1>
              <p style={heroSub}>
                Create controlled stocktaking snapshots, record counted quantities,
                compare two files in bulk, and review variances without adjusting stock in v1.
              </p>
            </div>

            <button onClick={() => setShowCreateModal(true)} style={primaryBtnStyle}>
              Start New Session
            </button>
          </div>

          {feedback.message ? (
            <div
              style={{
                ...feedbackStyle,
                borderRadius: 14,
                padding: "14px 18px",
                marginTop: 18,
                fontWeight: 700,
              }}
            >
              {feedback.message}
            </div>
          ) : null}
        </div>

        <div style={metricGrid}>
          <MetricCard label="OPEN SESSIONS" value={summary.openSessions} />
          <MetricCard label="COUNTED ITEMS" value={summary.countedItems} />
          <MetricCard label="VARIANCE ITEMS" value={summary.varianceItems} />
          <MetricCard
            label="TOTAL VARIANCE VALUE"
            value={formatCurrency(summary.totalVarianceValue)}
            valueColor={summary.totalVarianceValue < 0 ? "#dc2626" : "#0f172a"}
          />
        </div>

        <div style={workspaceGrid}>
          <div style={sessionsCard}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionEyebrow}>Session List</div>
                <h2 style={sectionTitle}>Sessions</h2>
              </div>
              <div style={sectionBadge}>{sessions.length} total</div>
            </div>

            {sessions.length === 0 ? (
              <div style={emptyStateCard}>
                No stocktaking sessions yet. Create the first session to capture a
                system stock snapshot.
              </div>
            ) : (
              <div style={sessionsList}>
                {sessions.map((session) => {
                  const active = String(session.id) === String(selectedSessionId);
                  return (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      style={active ? sessionCardActive : sessionCard}
                    >
                      <div style={sessionCardHeader}>
                        <div style={sessionName}>{session.session_name}</div>
                        <span
                          style={
                            session.status === "open"
                              ? sessionStatusOpen
                              : sessionStatusClosed
                          }
                        >
                          {session.status}
                        </span>
                      </div>

                      <div style={sessionMetaLine}>
                        Site: {session.site || session.location_name || "-"}
                      </div>

                      <div style={sessionDate}>
                        {session.created_at
                          ? new Date(session.created_at).toLocaleString()
                          : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={workspaceCard}>
            <div style={sectionHeader}>
              <div>
                <div style={sectionEyebrow}>Active Session</div>
                <h2 style={sectionTitle}>Session Workspace</h2>
              </div>
              <div style={sectionBadge}>
                {selectedSession ? selectedSession.status : "no session"}
              </div>
            </div>

            {!selectedSession ? (
              <div style={emptyStateCard}>Select a session to start counting.</div>
            ) : (
              <>
                <div style={sessionInfoCard}>
                  <div style={sessionInfoTitle}>{selectedSession.session_name}</div>
                  <div style={sessionInfoText}>
                    Site: {selectedSession.site || selectedSession.location_name || "-"}
                  </div>
                  <div style={sessionInfoText}>
                    Status:{" "}
                    <span
                      style={
                        selectedSession.status === "open"
                          ? inlineStatusOpen
                          : inlineStatusClosed
                      }
                    >
                      {selectedSession.status}
                    </span>
                  </div>
                </div>

                <div style={actionsRow}>
                  <button onClick={exportVarianceReport} style={secondaryBtnStyle}>
                    Export Variance Report
                  </button>

                  <button onClick={saveProgress} style={secondaryBtnStyle}>
                    Save Progress
                  </button>

                  <button onClick={closeSession} style={dangerBtnStyle}>
                    Close Session
                  </button>
                </div>

                <div style={varianceGrid}>
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

                <div style={compareCard}>
                  <div style={compareHeader}>
                    <div>
                      <div style={sectionEyebrow}>Bulk Compare</div>
                      <div style={compareTitle}>Compare Two Files</div>
                      <div style={compareSub}>
                        Upload one file for system stock and one file for counted stock.
                        Matching supports <strong>drug_code</strong>, then <strong>barcode</strong>,
                        then <strong>drug_name</strong>.
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        void runTwoFileComparison();
                      }}
                      style={primaryBtnStyle}
                      disabled={isComparingFiles || selectedSession.status === "closed"}
                    >
                      {isComparingFiles ? "Running Comparison..." : "Run File Comparison"}
                    </button>
                  </div>

                  {selectedSession.status === "closed" ? (
                    <div style={compareDisabledBox}>
                      This session is closed. Bulk compare is disabled. Select or create an open
                      session to continue.
                    </div>
                  ) : null}

                  {compareFeedback.message ? (
                    <div
                      style={{
                        ...compareFeedbackStyle,
                        borderRadius: 14,
                        padding: "12px 14px",
                        marginBottom: 14,
                        fontWeight: 700,
                      }}
                    >
                      {compareFeedback.message}
                    </div>
                  ) : null}

                  <div style={compareGrid}>
                    <div style={fileCard}>
                      <div style={fileCardLabel}>System Stock File</div>
                      <div style={fileCardHint}>
                        Preferred columns: drug_code, drug_name, system_qty, unit_price, barcode
                      </div>
                      <input
                        ref={systemFileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        disabled={selectedSession.status === "closed" || isComparingFiles}
                        style={fileInputStyle}
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setSystemCompareFile(file);
                          setSystemCompareFileName(file?.name || "");
                          setCompareFeedback({ type: "", message: "" });
                        }}
                      />
                      {systemCompareFileName ? (
                        <div style={fileNamePill}>Selected: {systemCompareFileName}</div>
                      ) : null}
                    </div>

                    <div style={fileCard}>
                      <div style={fileCardLabel}>Counted Stock File</div>
                      <div style={fileCardHint}>
                        Preferred columns: drug_code, drug_name, counted_qty, barcode
                      </div>
                      <input
                        ref={countedFileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        disabled={selectedSession.status === "closed" || isComparingFiles}
                        style={fileInputStyle}
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setCountedCompareFile(file);
                          setCountedCompareFileName(file?.name || "");
                          setCompareFeedback({ type: "", message: "" });
                        }}
                      />
                      {countedCompareFileName ? (
                        <div style={fileNamePill}>Selected: {countedCompareFileName}</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div style={scannerCard}>
                  <div style={scannerTitle}>Barcode Scan</div>
                  <div style={scannerSub}>
                    Scan a barcode, then press Enter to increment the counted quantity.
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
                    style={barcodeInputStyle}
                  />

                  {lastScanned ? (
                    <div style={lastScannedCard}>
                      Last scanned: {lastScanned.drug_name} | Barcode:{" "}
                      {lastScanned.barcode || "-"} | Counted Qty:{" "}
                      {lastScanned.counted_qty}
                    </div>
                  ) : null}
                </div>

                {sessionItems.length === 0 ? (
                  <div style={emptyStateCard}>No items found in this session.</div>
                ) : (
                  <div style={tableWrap}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Drug</th>
                          <th style={thStyle}>Barcode</th>
                          <th style={thStyle}>System Qty</th>
                          <th style={thStyle}>Counted Qty</th>
                          <th style={thStyle}>Difference</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Unit Price</th>
                          <th style={thStyle}>Value Difference</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionItems.map((item, index) => (
                          <tr key={item.id} style={index % 2 === 0 ? rowStyle : rowAltStyle}>
                            <td style={tdStrongStyle}>{item.drug_name}</td>
                            <td style={tdStyle}>{item.barcode || "-"}</td>
                            <td style={tdStyle}>{item.system_qty}</td>
                            <td style={tdStyle}>
                              <input
                                type="number"
                                min="0"
                                value={item.counted_qty}
                                disabled={selectedSession.status === "closed"}
                                onChange={(e) => updateLocalItem(item.id, e.target.value)}
                                style={qtyInputStyle}
                              />
                            </td>
                            <td
                              style={{
                                ...tdStrongStyle,
                                color: getVarianceQtyColor(item.difference_qty),
                              }}
                            >
                              {item.difference_qty}
                            </td>
                            <td style={tdStyle}>
                              <span style={getVarianceStatusStyle(item)}>
                                {getVarianceStatusLabel(item)}
                              </span>
                            </td>
                            <td style={tdStyle}>{formatCurrency(item.unit_price)}</td>
                            <td
                              style={{
                                ...tdStrongStyle,
                                color: getVarianceQtyColor(item.value_difference),
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
            <div style={modalEyebrow}>New Session</div>
            <h2 style={modalTitle}>Start New Stocktaking Session</h2>

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

            <div style={modalActions}>
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

      {loading ? <div style={loadingText}>Loading...</div> : null}
    </div>
  );
}

function MetricCard({ label, value, valueColor = "#0f172a" }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricAccentBar} />
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color: valueColor }}>{value}</div>
    </div>
  );
}

const pageShell = {
  background: "#f5f7fb",
  padding: 28,
};

const pageWrap = {
  display: "grid",
  gap: 18,
  maxWidth: 1280,
  margin: "0 auto",
};

const heroCard = {
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  border: "1px solid #dbe7f5",
  borderRadius: 24,
  padding: 28,
  boxShadow: "0 18px 34px rgba(15,23,42,0.07)",
};

const heroTopRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
};

const heroContent = {
  maxWidth: 780,
};

const heroEyebrow = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#64748b",
  marginBottom: 8,
};

const heroTitle = {
  margin: 0,
  fontSize: 36,
  lineHeight: 1.1,
  color: "#0f172a",
  letterSpacing: "-0.03em",
};

const heroSub = {
  color: "#475569",
  fontSize: 16,
  marginTop: 12,
  marginBottom: 0,
  lineHeight: 1.65,
};

const metricGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16,
};

const workspaceGrid = {
  display: "grid",
  gridTemplateColumns: "360px 1fr",
  gap: 20,
  alignItems: "start",
};

const sessionsCard = {
  background: "#fff",
  border: "1px solid #dbe7f5",
  borderRadius: 20,
  padding: 22,
  minHeight: 420,
  boxShadow: "0 12px 24px rgba(15,23,42,0.05)",
};

const workspaceCard = {
  background: "#fff",
  border: "1px solid #dbe7f5",
  borderRadius: 20,
  padding: 22,
  minHeight: 420,
  boxShadow: "0 12px 24px rgba(15,23,42,0.05)",
};

const sectionHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 16,
};

const sectionEyebrow = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#64748b",
  marginBottom: 6,
};

const sectionTitle = {
  margin: 0,
  fontSize: 20,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const sectionBadge = {
  fontSize: 12,
  fontWeight: 800,
  color: "#1d4ed8",
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: 999,
  padding: "8px 12px",
  textTransform: "capitalize",
};

const emptyStateCard = {
  border: "1px dashed #cbd5e1",
  borderRadius: 18,
  padding: 28,
  textAlign: "center",
  color: "#64748b",
  lineHeight: 1.7,
  background: "#fcfdff",
};

const sessionsList = {
  display: "grid",
  gap: 12,
};

const sessionCard = {
  textAlign: "left",
  border: "1px solid #dbe7f5",
  background: "#fff",
  borderRadius: 14,
  padding: 14,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(15,23,42,0.03)",
};

const sessionCardActive = {
  textAlign: "left",
  border: "2px solid #2563eb",
  background: "#eff6ff",
  borderRadius: 14,
  padding: 14,
  cursor: "pointer",
  boxShadow: "0 8px 16px rgba(37,99,235,0.16)",
};

const sessionCardHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 10,
  marginBottom: 8,
};

const sessionName = {
  fontWeight: 800,
  color: "#0f172a",
  fontSize: 18,
};

const sessionStatusOpen = {
  fontSize: 11,
  fontWeight: 800,
  padding: "5px 9px",
  borderRadius: 999,
  color: "#137333",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  textTransform: "uppercase",
};

const sessionStatusClosed = {
  fontSize: 11,
  fontWeight: 800,
  padding: "5px 9px",
  borderRadius: 999,
  color: "#b42318",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  textTransform: "uppercase",
};

const sessionMetaLine = {
  fontSize: 13,
  color: "#64748b",
  marginBottom: 8,
};

const sessionDate = {
  fontSize: 12,
  color: "#94a3b8",
};

const sessionInfoCard = {
  border: "1px solid #dbe7f5",
  borderRadius: 16,
  padding: 16,
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  marginBottom: 18,
};

const sessionInfoTitle = {
  fontWeight: 800,
  color: "#0f172a",
  fontSize: 22,
  marginBottom: 8,
};

const sessionInfoText = {
  color: "#64748b",
  fontSize: 15,
  lineHeight: 1.6,
};

const inlineStatusOpen = {
  color: "#137333",
  fontWeight: 800,
};

const inlineStatusClosed = {
  color: "#b42318",
  fontWeight: 800,
};

const actionsRow = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 18,
};

const varianceGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 12,
  marginBottom: 18,
};

const compareCard = {
  border: "1px solid #dbe7f5",
  borderRadius: 18,
  padding: 18,
  marginBottom: 18,
  background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
  boxShadow: "0 6px 14px rgba(15,23,42,0.04)",
};

const compareHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 14,
  flexWrap: "wrap",
  marginBottom: 14,
};

const compareTitle = {
  fontSize: 18,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 6,
};

const compareSub = {
  color: "#64748b",
  fontSize: 13,
  lineHeight: 1.7,
  maxWidth: 720,
};

const compareGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14,
};

const compareDisabledBox = {
  marginBottom: 14,
  borderRadius: 14,
  padding: "12px 14px",
  background: "#fff7ed",
  color: "#9a3412",
  border: "1px solid #fed7aa",
  fontWeight: 700,
};

const fileCard = {
  border: "1px solid #dbe7f5",
  borderRadius: 16,
  padding: 14,
  background: "#ffffff",
};

const fileCardLabel = {
  fontSize: 13,
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: 6,
};

const fileCardHint = {
  fontSize: 12,
  color: "#64748b",
  lineHeight: 1.6,
  marginBottom: 10,
};

const fileInputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #d4dfef",
  background: "#ffffff",
  boxSizing: "border-box",
};

const fileNamePill = {
  marginTop: 10,
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid #dbe7f5",
  background: "#f8fbff",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 700,
};

const scannerCard = {
  border: "1px solid #dbe7f5",
  borderRadius: 18,
  padding: 16,
  marginBottom: 18,
  background: "#fff",
  boxShadow: "0 6px 14px rgba(15,23,42,0.04)",
};

const scannerTitle = {
  fontWeight: 800,
  marginBottom: 6,
  color: "#0f172a",
  fontSize: 18,
};

const scannerSub = {
  color: "#64748b",
  fontSize: 13,
  marginBottom: 12,
};

const barcodeInputStyle = {
  width: "100%",
  maxWidth: 520,
  padding: "13px 15px",
  borderRadius: 12,
  border: "1px solid #d4dfef",
  outline: "none",
  fontSize: 15,
  boxShadow: "0 2px 6px rgba(15,23,42,0.03)",
  boxSizing: "border-box",
};

const lastScannedCard = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  background: "#eff6ff",
  color: "#1e3a8a",
  fontWeight: 700,
  border: "1px solid #bfdbfe",
};

const tableWrap = {
  overflowX: "auto",
  border: "1px solid #dbe7f5",
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: 14,
  minWidth: 1080,
  background: "#fff",
};

const thStyle = {
  textAlign: "left",
  padding: "12px 10px",
  borderBottom: "1px solid #dbe7f5",
  fontWeight: 800,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  background: "#f8fbff",
  color: "#334155",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "12px 10px",
  color: "#0f172a",
  verticalAlign: "middle",
  borderBottom: "1px solid #edf2fa",
};

const tdStrongStyle = {
  ...tdStyle,
  fontWeight: 700,
};

const rowStyle = {
  background: "#ffffff",
};

const rowAltStyle = {
  background: "#fbfdff",
};

const qtyInputStyle = {
  width: 90,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #d4dfef",
  boxSizing: "border-box",
};

const metricCardStyle = {
  position: "relative",
  overflow: "hidden",
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  padding: 18,
  minHeight: 110,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  boxShadow: "0 10px 22px rgba(15,23,42,0.05)",
};

const metricAccentBar = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 4,
  background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
};

const metricLabelStyle = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  color: "#64748b",
  marginBottom: 14,
  textAlign: "center",
};

const metricValueStyle = {
  fontSize: 28,
  fontWeight: 900,
  textAlign: "center",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #d4dfef",
  marginBottom: 14,
  fontSize: 15,
  boxSizing: "border-box",
  boxShadow: "0 2px 6px rgba(15,23,42,0.03)",
};

const labelStyle = {
  display: "block",
  marginBottom: 8,
  color: "#334155",
  fontWeight: 700,
};

const primaryBtnStyle = {
  background: "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 10px 20px rgba(37,99,235,0.25)",
};

const secondaryBtnStyle = {
  background: "#fff",
  color: "#0f172a",
  border: "1px solid #d4dfef",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
};

const dangerBtnStyle = {
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "12px 18px",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 10px 20px rgba(239,68,68,0.18)",
};

const statusBadgeBase = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 28,
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.05em",
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.42)",
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
  border: "1px solid #dbe7f5",
  padding: 26,
  boxShadow: "0 30px 54px rgba(15,23,42,0.22)",
};

const modalEyebrow = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "#64748b",
  marginBottom: 8,
};

const modalTitle = {
  marginTop: 0,
  marginBottom: 22,
  color: "#0f172a",
  textAlign: "center",
  fontSize: 28,
  letterSpacing: "-0.02em",
};

const modalActions = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 18,
};

const loadingText = {
  marginTop: 14,
  color: "#64748b",
  fontWeight: 600,
  textAlign: "center",
};