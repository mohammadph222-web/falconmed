export default function PageHeader({ title, subtitle, actions = null, style }) {
  return (
    <div className="ui-page-header" style={style}>
      <div>
        <h2 className="ui-page-header-title">{title}</h2>
        {subtitle ? <p className="ui-page-header-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </div>
  );
}
