/* PageHeader — the H1 + metadata-chips pattern from /home, made
   reusable. Pass `title` as a string or node; `chips` as an array of
   nodes (Chip components are the obvious fit but anything works);
   `actions` for right-side buttons (e.g. settings, export).

   Layout:
     [ Title              ] [ actions ]
     [ chip · chip · chip ]
*/

export default function PageHeader({
  title,
  chips,
  actions,
  className = "",
}) {
  return (
    <header className={`ui-page-header ${className}`.trim()}>
      <div className="ui-page-header-top">
        <h1 className="ui-page-header-title">{title}</h1>
        {actions && <div className="ui-page-header-actions">{actions}</div>}
      </div>
      {chips && chips.length > 0 && (
        <div className="ui-page-header-chips" role="group">
          {chips.map((chip, i) => (
            <span key={i} className="ui-page-header-chip-slot">
              {chip}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
