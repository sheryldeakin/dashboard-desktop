/* Stat — large number + label + optional delta. The canonical
   building block for any "snapshot cell" / "rail hero stat" pattern.
   Sizes:
     md → rail hero stat (28px number) — used by CountdownCard, PeakHourCard
     lg → snapshot strip (~30px number) — used by TodaySnapshot cells
   delta shape: { sign: "up"|"down"|"neutral", label: string } | null
   If `href` is passed the whole component renders as a link — internal
   routes use <Link>, everything else stays as <a>. */

import { Link } from "react-router-dom";

function isInternalRoute(href) {
  return typeof href === "string" && href.startsWith("/");
}

export default function Stat({
  value,
  label,
  secondary,
  delta,
  size = "md",
  href,
  title,
  isText = false,
  className = "",
}) {
  const content = (
    <>
      <span className={`ui-stat-num${isText ? " ui-stat-num--text" : ""}`}>
        {value}
        {secondary && <span className="ui-stat-num-secondary">{secondary}</span>}
      </span>
      <span className="ui-stat-label">{label}</span>
      {delta && (
        <span className={`ui-stat-delta is-${delta.sign}`}>{delta.label}</span>
      )}
    </>
  );

  if (href) {
    const cls = `ui-stat ui-stat--${size} ${className}`.trim();
    if (isInternalRoute(href)) {
      return (
        <Link className={cls} to={href} title={title}>
          {content}
        </Link>
      );
    }
    return (
      <a className={cls} href={href} title={title}>
        {content}
      </a>
    );
  }
  return (
    <div className={`ui-stat ui-stat--${size} ${className}`.trim()} title={title}>
      {content}
    </div>
  );
}
