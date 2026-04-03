import { useMemo } from "react";

export default function WorkspacePharmacySelector({
  options,
  value,
  onChange,
  label = "Workspace Pharmacy",
}) {
  const selected = useMemo(
    () => (options || []).find((item) => item.id === value) || null,
    [options, value]
  );

  return (
    <div style={wrap}>
      <label style={labelStyle} htmlFor="workspace-pharmacy-selector">{label}</label>
      <select
        id="workspace-pharmacy-selector"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={selectStyle}
      >
        {(options || []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {selected?.location ? <div style={subText}>{selected.location}</div> : null}
    </div>
  );
}

const wrap = {
  display: "grid",
  gap: "6px",
  minWidth: "240px",
};

const labelStyle = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const selectStyle = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: "13px",
  padding: "9px 10px",
};

const subText = {
  fontSize: "12px",
  color: "#64748b",
};
