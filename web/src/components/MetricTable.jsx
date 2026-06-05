/* MetricTable — compact comparison grid: rows = metrics, columns =
   time windows (or any other comparison axis). Used on /stats below
   each tab's snapshot strip to show the supporting breakdown data
   that didn't fit in the headline.

   Props:
     headers — array of column labels (strings or nodes), excluding
               the left label column. e.g. ["Today", "Past 7 days", "All-time"]
     rows    — array of { label, cells }:
                 label — the row label (string or node)
                 cells — array of values matching headers length
     className — applied to the outer container

   Layout: a grid where the first column is the row label, and the
   remaining N columns hold the per-window values. Header row sits on
   top with a hairline below. Numeric values use tabular-nums so
   columns of digits align vertically. */

export default function MetricTable({ headers = [], rows = [], className = "" }) {
  // Build grid-template-columns: label column auto, value columns equal
  const cols = `minmax(120px, 1.4fr) ${headers.map(() => "minmax(0, 1fr)").join(" ")}`;
  return (
    <div
      className={`ui-metric-table ${className}`.trim()}
      style={{ gridTemplateColumns: cols }}
    >
      <span className="ui-metric-table-corner" aria-hidden="true" />
      {headers.map((h, i) => (
        <span key={i} className="ui-metric-table-header">{h}</span>
      ))}
      {rows.map((r, ri) => (
        // Each row is a chain of cells inside the same parent grid via
        // <> fragment — keeps the markup simple and lets all rows share
        // the same column tracks.
        <Fragment key={r.label || ri} cells={[
          <span key={`${ri}-label`} className="ui-metric-table-row-label">
            {r.label}
          </span>,
          ...r.cells.map((c, ci) => (
            <span key={`${ri}-${ci}`} className="ui-metric-table-cell">
              {c}
            </span>
          )),
        ]} />
      ))}
    </div>
  );
}

// Tiny inline helper — React's <></> can't take a key, but we need the
// row label + cells to live as siblings of the parent grid. This just
// renders them inline.
function Fragment({ cells }) {
  return <>{cells}</>;
}
