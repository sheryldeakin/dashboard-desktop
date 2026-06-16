/* Tabs — horizontal tab bar with active state.
   tabs: [{ id, label, icon?, count? }]
     count — optional numeric badge rendered after the label. Falsy (0
     included) is omitted so counts only appear when meaningful.
   active: id of the active tab
   onChange: (id) => void
   Used wherever a page needs to switch between dimensions (Stats page
   already has its own implementation that this should replace on
   migration). */

export default function Tabs({ tabs, active, onChange, className = "" }) {
  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`ui-tab${isActive ? " is-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.icon && <span className="ui-tab-icon" aria-hidden="true">{t.icon}</span>}
            <span className="ui-tab-label">{t.label}</span>
            {t.count ? <span className="ui-tab-count">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
