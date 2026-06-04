/* Chip — small pill-shaped label. Tones:
     default → no background, just text (used in header chip row)
     pill    → muted-bg pill (used for status/info)
     sage    → sage-tinted pill (used for streak / success)
     warn    → warn-tinted pill (used for stale/warning state)
   Sizes:
     sm → 11px font, 2px/6px padding
     md → 12px font, 3px/8px padding
   Icon (optional) renders inline before the children. */
export default function Chip({
  tone = "default",
  size = "sm",
  icon,
  children,
  className = "",
}) {
  return (
    <span
      className={`ui-chip ui-chip--${tone} ui-chip--${size} ${className}`.trim()}
    >
      {icon && <span className="ui-chip-icon" aria-hidden="true">{icon}</span>}
      <span className="ui-chip-text">{children}</span>
    </span>
  );
}
