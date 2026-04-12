const variantStyles = {
  success: {
    color: "#166534",
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
  },
  warning: {
    color: "#92400e",
    background: "#fffbeb",
    border: "1px solid #fde68a",
  },
  danger: {
    color: "#991b1b",
    background: "#fef2f2",
    border: "1px solid #fecaca",
  },
  info: {
    color: "#1d4ed8",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  },
  neutral: {
    color: "#334155",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
  },
};

export default function StatusPill({ variant = "neutral", children, style, className = "" }) {
  const tone = variantStyles[variant] || variantStyles.neutral;
  return (
    <span className={`ui-status-pill ${className}`.trim()} style={{ ...tone, ...style }}>
      {children}
    </span>
  );
}
