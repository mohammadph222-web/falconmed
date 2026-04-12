export default function ActionButton({
  variant = "primary",
  className = "",
  children,
  style,
  ...buttonProps
}) {
  const classes = `ui-action-button ui-action-button-${variant} ${className}`.trim();
  return (
    <button {...buttonProps} className={classes} style={style}>
      {children}
    </button>
  );
}
