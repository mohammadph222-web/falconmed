import React from "react";

const tones = {
  info: {
    background: "#eff6ff",
    border: "#bfdbfe",
    iconBg: "#dbeafe",
    iconColor: "#1d4ed8",
    title: "#1e3a8a",
    text: "#1e40af",
  },
  warning: {
    background: "#fffbeb",
    border: "#fde68a",
    iconBg: "#fef3c7",
    iconColor: "#b45309",
    title: "#92400e",
    text: "#a16207",
  },
  danger: {
    background: "#fef2f2",
    border: "#fecaca",
    iconBg: "#fee2e2",
    iconColor: "#dc2626",
    title: "#991b1b",
    text: "#b91c1c",
  },
  success: {
    background: "#ecfdf5",
    border: "#bbf7d0",
    iconBg: "#dcfce7",
    iconColor: "#15803d",
    title: "#166534",
    text: "#15803d",
  },
};

export default function InsightCard({
  title,
  message,
  icon = "i",
  tone = "info",
  style,
}) {
  if (!title || !message) return null;

  const palette = tones[tone] || tones.info;

  return (
    <div
      style={{
        background: palette.background,
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
        padding: "10px 12px",
        marginBottom: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        ...style,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          background: palette.iconBg,
          color: palette.iconColor,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {icon}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: palette.title,
            marginBottom: 3,
            letterSpacing: "0.01em",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: palette.text,
          }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}
