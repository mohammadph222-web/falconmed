function resolveCellValue(column, row, rowIndex) {
  if (typeof column.render === "function") {
    return column.render(row, rowIndex);
  }
  if (column.key) {
    return row?.[column.key];
  }
  return null;
}

export default function DataTable({
  columns = [],
  rows = [],
  rowKey = "id",
  emptyText = "No records found.",
  className = "",
  style,
}) {
  return (
    <div className={`ui-data-table-wrap ${className}`.trim()} style={style}>
      <table className="ui-data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.header || column.key}
                className={column.align === "right" ? "ui-th-right" : ""}
                style={column.headerStyle}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length || 1} className="ui-empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={row?.[rowKey] ?? rowIndex} className="ui-data-table-row">
                {columns.map((column) => (
                  <td
                    key={column.header || column.key}
                    className={column.align === "right" ? "ui-td-right" : ""}
                    style={column.cellStyle}
                  >
                    {resolveCellValue(column, row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
