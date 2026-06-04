/* Section — wraps a chunk of page content with the standardized
   header pattern used on /home: hairline divider above, uppercase
   muted label, optional icon, optional right-side meta slot.

   Two variants share the same JSX shape so consumers don't have to
   pick between two components:
     default → "section level" — used in main columns. Hairline above,
               larger margin-top, title bottom-rule.
     card    → "rail level" — used inside rail columns. Tighter
               padding, hairline between cards.

   Pass `title` as a string or node. `meta` is rendered right-aligned
   in the title row (use it for counts, totals, hover-meta swaps).
   `icon` renders before the title text. */

export default function Section({
  title,
  icon,
  meta,
  variant = "default",
  className = "",
  titleClassName = "",
  children,
}) {
  const isCard = variant === "card";
  const sectionClass = isCard ? "home-rail-card" : "home-section";
  const titleBaseClass = isCard ? "home-rail-card-title" : "home-section-title";
  // Always use the row variant so meta + icon align on one line
  const fullTitleClass = `${titleBaseClass} ${isCard ? "home-rail-card-title-row" : "home-section-title-row"} ${titleClassName}`.trim();

  return (
    <section className={`${sectionClass} ${className}`.trim()}>
      <h2 className={fullTitleClass}>
        {icon && <span className={isCard ? "home-rail-icon-wrap" : "ui-section-icon"} aria-hidden="true">{icon}</span>}
        <span>{title}</span>
        {meta}
      </h2>
      {children}
    </section>
  );
}
