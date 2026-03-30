import React from "react";

export default function StatCard({
  label,
  value,
  accentColor,
  hint,
  children,
  className,
  style,
  labelStyle,
  valueStyle,
  hintStyle,
  accentBorderWidth,
}) {
  const resolvedStyle = accentColor
    ? {
        ...style,
        borderTop: `${accentBorderWidth || 3}px solid ${accentColor}`,
      }
    : style;

  return (
    <div className={className} style={resolvedStyle}>
      {label != null ? <div style={labelStyle}>{label}</div> : null}
      {value != null ? <div style={valueStyle}>{value}</div> : null}
      {hint != null ? <div style={hintStyle}>{hint}</div> : null}
      {children}
    </div>
  );
}
