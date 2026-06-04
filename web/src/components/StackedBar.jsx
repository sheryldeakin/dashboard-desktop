/* StackedBar — single bar made of stacked project-colored segments.
   The chart-level component (week recap, hour ribbon) owns the layout
   of multiple bars + hover state; this primitive just renders one
   column.

   segments: array of { id, name, ms, color, fullColor }
              sorted desc by ms (largest first; visual bottom)
   total:    sum of segment ms (segments compute their flex-basis from this)
   heightPct: 0-100, the bar's height as % of its wrap container
   hoveredSegIdx: optional, which segment is hovered (re-saturate that one,
                  fade the rest)
   onSegEnter: (segIdx, seg) => void — mouse-enter on a segment

   Use case (week / hour stacked charts):
     <div className="home-week-bar-wrap">
       <StackedBar
         segments={d.segments}
         total={d.focusedMs}
         heightPct={(d.focusedMs / peak) * 100}
         hoveredSegIdx={hover?.dayIdx === dayIdx ? hover.segIdx : null}
         onSegEnter={(idx, s) => setHover({ dayIdx, segIdx: idx, seg: s })}
       />
     </div>

   Reuses the existing .home-week-bar / .home-week-bar-seg classes so it
   plugs into the current CSS without forcing a class rename. */

export default function StackedBar({
  segments,
  total,
  heightPct,
  hoveredSegIdx = null,
  onSegEnter,
  className = "",
  segClassName = "",
  minSegmentHeight = 0,
}) {
  return (
    <div
      className={`home-week-bar ${className}`.trim()}
      style={{ height: `${Math.max(3, heightPct)}%` }}
    >
      {segments.map((s, segIdx) => {
        const isHovered = hoveredSegIdx === segIdx;
        const isFaded = hoveredSegIdx !== null && !isHovered;
        return (
          <div
            key={s.id}
            className={`home-week-bar-seg${isHovered ? " is-hovered" : ""}${isFaded ? " is-faded" : ""} ${segClassName}`.trim()}
            style={{
              flexBasis: total > 0 ? `${(s.ms / total) * 100}%` : "0%",
              minHeight: minSegmentHeight ? `${minSegmentHeight}px` : undefined,
              background: isHovered ? s.fullColor : s.color,
            }}
            onMouseEnter={() => onSegEnter && onSegEnter(segIdx, s)}
          />
        );
      })}
    </div>
  );
}
