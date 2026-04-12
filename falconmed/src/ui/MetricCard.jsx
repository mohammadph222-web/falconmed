const accentMap = {
  primary: "#2563eb",
  success: "#10b981",
  info: "#0ea5e9",
  warning: "#f59e0b",
  danger: "#ef4444",
  neutral: "#64748b",
};

export default function MetricCard({
  label,
  value,
  helper,
  meta,
  icon,
  accent = "primary",
  className = "",
  style,
}) {
  const accentColor = accentMap[accent] || accentMap.primary;

  return (
    <article
      className={`ui-metric-card ${className}`.trim()}
      style={{ ...style, borderTopColor: accentColor }}
    >
      <div className="ui-metric-card-head">
        <div className="ui-metric-card-title-wrap">
          {icon ? <span className="ui-metric-card-icon">{icon}</span> : null}
          <div className="ui-metric-card-label">{label}</div>
        </div>
        {meta ? <div className="ui-metric-card-meta">{meta}</div> : null}
      </div>
      <div className="ui-metric-card-value">{value}</div>
      {helper ? <div className="ui-metric-card-helper">{helper}</div> : null}
    </article>
  );
}
