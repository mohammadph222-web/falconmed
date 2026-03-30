export default function FeatureGate({
  allowed,
  title,
  message,
  children,
}) {
  if (allowed) {
    return children;
  }

  return (
    <div style={lockedWrap}>
      <div style={lockedBadge}>Upgrade Required</div>
      <h3 style={lockedTitle}>{title || "Feature Locked"}</h3>
      <p style={lockedText}>{message}</p>
    </div>
  );
}

const lockedWrap = {
  display: "grid",
  gap: "10px",
  padding: "16px 4px 6px",
};

const lockedBadge = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  padding: "6px 10px",
  borderRadius: "999px",
  background: "#eff6ff",
  color: "#1d4ed8",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  border: "1px solid #bfdbfe",
};

const lockedTitle = {
  margin: 0,
  fontSize: "24px",
  fontWeight: 700,
  color: "#0f172a",
  letterSpacing: "-0.02em",
};

const lockedText = {
  margin: 0,
  color: "#475569",
  fontSize: "15px",
  lineHeight: 1.7,
};
