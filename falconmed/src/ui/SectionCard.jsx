export default function SectionCard({
  title,
  subtitle,
  actions = null,
  children,
  style,
  bodyStyle,
  className = "",
}) {
  return (
    <section className={`ui-section-card ${className}`.trim()} style={style}>
      {(title || subtitle || actions) && (
        <div className="ui-section-card-header">
          <div>
            {title ? <h3 className="ui-section-card-title">{title}</h3> : null}
            {subtitle ? <p className="ui-section-card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="ui-section-card-actions">{actions}</div> : null}
        </div>
      )}
      <div className="ui-section-card-body" style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}
