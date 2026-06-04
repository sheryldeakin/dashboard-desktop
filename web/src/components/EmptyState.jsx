/* Empty state — used anywhere we'd otherwise show "Nothing here" plain
   text. Has three render slots: icon (optional), message (required),
   hint (optional sub-line), action (optional button/link/whatever).
   Variants:
     default → center-aligned, has padding, used for section-level empty
     inline  → no padding, left-aligned, used inside compact contexts
                (rail cards, list rows)
   The icon prop accepts a React node — pass an inline SVG to match the
   page's iconography. */
export default function EmptyState({
  icon,
  message,
  hint,
  action,
  variant = "default",
}) {
  return (
    <div className={`empty-state empty-state--${variant}`}>
      {icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
      <div className="empty-state-message">{message}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
