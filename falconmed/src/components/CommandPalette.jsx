import { useEffect, useMemo, useRef, useState } from "react";
import { getDrugDisplayName, loadDrugMaster } from "../utils/drugMasterLoader";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

// Higher score means better fuzzy match.
function fuzzyScore(candidate, query) {
  const text = normalizeText(candidate);
  const q = normalizeText(query);

  if (!q) return 0;
  if (!text) return -Infinity;

  const directIndex = text.indexOf(q);
  if (directIndex >= 0) {
    return 1000 - directIndex * 2 - (text.length - q.length) * 0.05;
  }

  let qi = 0;
  let ti = 0;
  let gaps = 0;

  while (qi < q.length && ti < text.length) {
    if (q[qi] === text[ti]) {
      qi += 1;
    } else if (qi > 0) {
      gaps += 1;
    }
    ti += 1;
  }

  if (qi !== q.length) return -Infinity;

  return 500 - gaps - (text.length - q.length) * 0.08;
}

function matchAndRank(items, query) {
  if (!query) {
    return items;
  }

  return items
    .map((item) => {
      const score = Math.max(
        fuzzyScore(item.label, query),
        fuzzyScore(item.subtitle, query),
        ...(Array.isArray(item.keywords)
          ? item.keywords.map((keyword) => fuzzyScore(keyword, query))
          : [-Infinity])
      );

      return { ...item, score };
    })
    .filter((item) => item.score > -Infinity)
    .sort((a, b) => b.score - a.score);
}

export default function CommandPalette({
  isOpen,
  onClose,
  navigationItems,
  onSelectPage,
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [drugs, setDrugs] = useState([]);
  const [loadingDrugs, setLoadingDrugs] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    setQuery("");
    setActiveIndex(0);

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || drugs.length > 0 || loadingDrugs) return;

    setLoadingDrugs(true);

    loadDrugMaster()
      .then((rows) => {
        setDrugs(rows || []);
      })
      .catch((error) => {
        console.error("Command palette drug load failed:", error);
        setDrugs([]);
      })
      .finally(() => {
        setLoadingDrugs(false);
      });
  }, [drugs.length, isOpen, loadingDrugs]);

  const pageResults = useMemo(
    () =>
      (navigationItems || []).map((item) => ({
        id: `page-${item.page}-${item.label}`,
        type: "page",
        icon: item.icon || "◻",
        label: item.label,
        subtitle: item.subtitle || "Navigate",
        page: item.page,
        pdssView: item.pdssView,
        locked: !!item.locked,
        requiredPlanLabel: item.requiredPlanLabel || "",
        keywords: item.keywords || [],
      })),
    [navigationItems]
  );

  const drugResults = useMemo(
    () =>
      (drugs || []).slice(0, 300).map((drug, index) => ({
        id: `drug-${drug.drug_code || index}`,
        type: "drug",
        icon: "💊",
        label: getDrugDisplayName(drug) || "Unnamed Drug",
        subtitle: drug.generic_name || drug.brand_name || "Drug Master",
        page: "drugsearch",
        keywords: [drug.brand_name, drug.generic_name, drug.strength].filter(Boolean),
      })),
    [drugs]
  );

  const results = useMemo(() => {
    const combined = [...pageResults, ...drugResults];
    const ranked = matchAndRank(combined, query).slice(0, 12);
    return ranked;
  }, [pageResults, drugResults, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex < results.length) return;
    setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);

  if (!isOpen) return null;

  const handleSelect = (item) => {
    if (!item) return;

    onSelectPage?.({
      page: item.page,
      pdssView: item.pdssView,
      type: item.type,
      label: item.label,
    });

    onClose?.();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (results.length === 0 ? 0 : Math.min(prev + 1, results.length - 1)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      handleSelect(results[activeIndex]);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(event) => event.stopPropagation()}>
        <div style={searchRow}>
          <span style={searchIcon}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages or drugs..."
            style={inputStyle}
          />
          <span style={hintBadge}>Ctrl/Cmd + K</span>
        </div>

        <div style={resultsWrap}>
          {loadingDrugs && (
            <div style={emptyText}>Loading drug master...</div>
          )}

          {!loadingDrugs && results.length === 0 && (
            <div style={emptyText}>No matching commands found.</div>
          )}

          {!loadingDrugs &&
            results.map((item, index) => (
              <button
                key={item.id}
                style={{
                  ...resultItem,
                  ...(item.locked ? resultItemLocked : null),
                  ...(index === activeIndex ? resultItemActive : null),
                }}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(item)}
              >
                <span style={resultIcon}>{item.icon}</span>
                <span style={resultTextWrap}>
                  <span style={resultTitle}>{item.label}</span>
                  <span style={resultSubtitle}>
                    {item.locked && item.requiredPlanLabel
                      ? `${item.subtitle} • ${item.requiredPlanLabel} plan`
                      : item.subtitle}
                  </span>
                </span>
                <span style={item.locked ? resultTypeLocked : resultType}>
                  {item.locked ? "Locked" : item.type === "drug" ? "Drug" : "Page"}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.35)",
  backdropFilter: "blur(2px)",
  zIndex: 9999,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "10vh",
};

const modal = {
  width: "min(760px, 92vw)",
  background: "#ffffff",
  borderRadius: "16px",
  border: "1px solid #dbe3ee",
  boxShadow: "0 25px 60px rgba(15, 23, 42, 0.28)",
  overflow: "hidden",
  fontFamily: "'Segoe UI', Arial, sans-serif",
};

const searchRow = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "14px 14px 12px",
  borderBottom: "1px solid #e8edf5",
  background: "#f8fafc",
};

const searchIcon = {
  width: "32px",
  height: "32px",
  borderRadius: "10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#e2e8f0",
  color: "#475569",
  fontWeight: 700,
  flexShrink: 0,
};

const inputStyle = {
  flex: 1,
  border: "1.5px solid #dbe3ee",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "15px",
  color: "#0f172a",
  background: "white",
  outline: "none",
};

const hintBadge = {
  fontSize: "11px",
  color: "#64748b",
  background: "#e2e8f0",
  borderRadius: "999px",
  padding: "5px 9px",
  letterSpacing: "0.02em",
  flexShrink: 0,
};

const resultsWrap = {
  maxHeight: "58vh",
  overflowY: "auto",
  padding: "8px",
};

const resultItem = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 10px",
  borderRadius: "10px",
  border: "1px solid transparent",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
};

const resultItemActive = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
};

const resultItemLocked = {
  opacity: 0.8,
};

const resultIcon = {
  width: "32px",
  height: "32px",
  borderRadius: "10px",
  background: "#f1f5f9",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "16px",
  flexShrink: 0,
};

const resultTextWrap = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  minWidth: 0,
  flex: 1,
};

const resultTitle = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#0f172a",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const resultSubtitle = {
  fontSize: "12px",
  color: "#64748b",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const resultType = {
  fontSize: "11px",
  color: "#475569",
  background: "#f1f5f9",
  border: "1px solid #e2e8f0",
  borderRadius: "999px",
  padding: "4px 8px",
  flexShrink: 0,
};

const resultTypeLocked = {
  ...resultType,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fde68a",
};

const emptyText = {
  color: "#64748b",
  fontSize: "14px",
  textAlign: "center",
  padding: "26px 12px",
};
