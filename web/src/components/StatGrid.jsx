/* StatGrid — N-cell grid of headline stats. Used for:
   - /home's TodaySnapshot (4 cells: Focused / Sessions / Done / Top)
   - /stats Tasks tab "Tasks shipped" (3 cells: Today / 7d / All-time)
   - Anywhere else we want a "row of big numbers + uppercase labels"

   Props:
     columns  — array of cell objects:
                { value, label, secondary?, delta?, href?, isText? }
     variant  — "default" (boxed cells) | "snapshot" (hairline-divided)
     className — applied to the outer container

   Each cell can optionally link to a deeper view (href) — same per-cell
   navigation pattern as /home's snapshot.

   Delta shape (same as Stat): { sign: "up"|"down"|"neutral", label } */

import Stat from "./Stat.jsx";

export default function StatGrid({
  columns = [],
  variant = "default",
  className = "",
}) {
  return (
    <div className={`ui-stat-grid ui-stat-grid--${variant} ${className}`.trim()}>
      {columns.map((c, i) => (
        <Stat
          key={c.id || i}
          value={c.value}
          label={c.label}
          secondary={c.secondary}
          delta={c.delta}
          href={c.href}
          isText={c.isText}
          title={c.title}
          size="lg"
          className="ui-stat-grid-cell"
        />
      ))}
    </div>
  );
}
