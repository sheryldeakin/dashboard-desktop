/* WeekRecap — N-day focused-time bar chart, segmented by project color.
   Originally lived inline in HomePage.jsx as "This week"; extracted here
   when /stats Overview needed the same pattern for the 14-day window.

   Two variants:
     placement="main"  full section with title row + bar grid + legend
     placement="rail"  compact rail-card chrome (title + bars + hover-meta)

   Props:
     weekDays         [{ dayKey, dayLabel, fullLabel, focusedMs, isToday, segments: [...] }]
     weekTotalMs      sum of all weekDays focusedMs
     weekActiveDays   number of weekDays with focusedMs > 0
     weekLegend       [{ id, name, color, ms }] — top N projects this window
     title            section title (default: "This week")
     href             optional click-through href; wraps bars in <a>
     icon             optional icon node for rail variant title
     placement        "main" | "rail" (default "main")

   The same component handles both /home (7 days, "This week") and /stats
   Overview (14 days, "Last 14 days") — only the data and title differ.

   Also exports buildWeekRecap(content, opts) that produces the data shape
   directly from a content document (workSessions + projects), so callers
   don't need to know the internal aggregation. Both /home and /stats now
   go through this helper for color/segment computation, which guarantees
   the same project shows up in the same color on both pages. */

import { useState } from "react";
import EmptyState from "./EmptyState.jsx";
import { parseIsoMs } from "../utils/taskUtils.js";

const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

// 7-color palette used as a fallback when a project's stored color is the
// app default or missing. Same set used by HomePage's projectMix card so
// the colors stay consistent app-wide. (If we ever want a single source
// of truth, move this to utils — but right now both copies are identical
// and stable.)
const PROJMIX_PALETTE = [
  "#5a7e5f", // sage
  "#8a6940", // tan
  "#4a5a70", // slate
  "#c45c4a", // warn / coral
  "#7a5b9c", // muted purple
  "#5c8aa8", // muted blue
  "#8aa05c", // olive
];

const PROJMIX_DEFAULT_COLORS = new Set([
  "#b66e35", // app-wide default accent — treat as "no real color set"
  "",
  null,
  undefined,
]);

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function fmtHrMin(ms) {
  const min = Math.floor(ms / MS_PER_MIN);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function localDayKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* Mix `color` toward white by `amount` (0 = original, 1 = pure white).
   Returns a solid rgb() so adjacent segments don't bleed through each
   other. Falls back to the original string if format isn't hex/rgb. */
function softenColor(color, amount = 0.45) {
  if (!color || typeof color !== "string") return color;
  let r, g, b;
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return color;
    }
  } else if (color.startsWith("rgb")) {
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return color;
    r = parseInt(m[1], 10);
    g = parseInt(m[2], 10);
    b = parseInt(m[3], 10);
  } else {
    return color;
  }
  const mR = Math.round(r + (255 - r) * amount);
  const mG = Math.round(g + (255 - g) * amount);
  const mB = Math.round(b + (255 - b) * amount);
  return `rgb(${mR}, ${mG}, ${mB})`;
}

/* buildWeekRecap(content, { days })
   Walk content.workSessions for the last `days` days and produce the
   data shape WeekRecap renders. Project color resolution: use the
   project's stored color if it's a non-default custom color, otherwise
   assign a palette slot based on the project's rank within the window
   by total focused ms (most-focused project gets the first slot, etc).
   Legend is top 5 projects by ms in the window. */
export function buildWeekRecap(content, { days = 7 } = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const windowStartMs = todayMs - (days - 1) * MS_PER_DAY;

  const projectMap = new Map(
    (content?.projects || []).map((p) => [p.id, { name: p.name, color: p.color }])
  );

  const msByDay = new Map();           // dayKey → total active ms across all projects
  const msByDayProject = new Map();    // dayKey → Map(projectId → ms)

  for (const ws of content?.workSessions || []) {
    const start = parseIsoMs(ws.startedAt);
    const end = parseIsoMs(ws.endedAt);
    if (start === null || end === null) continue;
    if (start < windowStartMs || start >= todayMs + MS_PER_DAY) continue;

    const active = ws.activeMs || Math.max(0, end - start);
    const pid = ws.projectId || "";
    const startKey = localDayKey(start);

    msByDay.set(startKey, (msByDay.get(startKey) || 0) + active);

    let dayProjects = msByDayProject.get(startKey);
    if (!dayProjects) {
      dayProjects = new Map();
      msByDayProject.set(startKey, dayProjects);
    }
    dayProjects.set(pid, (dayProjects.get(pid) || 0) + active);
  }

  // Project totals across the whole window — used to (a) rank for palette
  // assignment and (b) build the legend.
  const weekProjectTotals = new Map();
  for (const [, dayProjects] of msByDayProject) {
    for (const [pid, ms] of dayProjects) {
      weekProjectTotals.set(pid, (weekProjectTotals.get(pid) || 0) + ms);
    }
  }

  // Color resolution: stored color wins if non-default; else palette by rank.
  const weekProjectColors = new Map();
  [...weekProjectTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([pid], idx) => {
      const stored = projectMap.get(pid)?.color;
      const useStored = !PROJMIX_DEFAULT_COLORS.has(stored);
      weekProjectColors.set(
        pid,
        useStored ? stored : PROJMIX_PALETTE[idx % PROJMIX_PALETTE.length]
      );
    });

  // Build day rows oldest → today (so the bar grid reads left-to-right).
  const weekDays = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayMs = todayMs - i * MS_PER_DAY;
    const key = localDayKey(dayMs);
    const d = new Date(dayMs);
    const dayProjects = msByDayProject.get(key);
    // Sort segments largest → smallest so the dominant project anchors
    // the bottom of the bar (CSS uses column-reverse for stacking).
    const segments = dayProjects
      ? [...dayProjects.entries()]
          .map(([pid, ms]) => {
            const baseColor = weekProjectColors.get(pid) || "rgba(0,0,0,0.25)";
            return {
              id: pid,
              name: projectMap.get(pid)?.name || "Unassigned",
              color: softenColor(baseColor, 0.45),
              // Full-saturation copy kept so per-segment hover can re-saturate
              // just that segment without re-running softenColor per render.
              fullColor: baseColor,
              ms,
            };
          })
          .sort((a, b) => b.ms - a.ms)
      : [];
    weekDays.push({
      dayKey: key,
      dayLabel: WEEKDAY_LETTERS[d.getDay()],
      fullLabel: d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      focusedMs: msByDay.get(key) || 0,
      isToday: i === 0,
      segments,
    });
  }

  const weekTotalMs = weekDays.reduce((sum, d) => sum + d.focusedMs, 0);
  const weekActiveDays = weekDays.filter((d) => d.focusedMs > 0).length;

  const weekLegend = [...weekProjectTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, ms]) => ({
      id: pid,
      name: projectMap.get(pid)?.name || "Unassigned",
      color: weekProjectColors.get(pid),
      ms,
    }));

  return { weekDays, weekTotalMs, weekActiveDays, weekLegend };
}

export default function WeekRecap({
  weekDays,
  weekTotalMs,
  weekActiveDays,
  weekLegend,
  title = "This week",
  href = null,
  icon = null,
  placement = "main",
}) {
  const peak = Math.max(...weekDays.map((d) => d.focusedMs), 1);
  const hasAny = weekTotalMs > 0;
  const isRail = placement === "rail";

  // Hover state — { dayIdx, segIdx, day, seg } or null. Drives the
  // contextual meta line at the top of the section without re-deriving
  // anything inline.
  const [hover, setHover] = useState(null);

  const metaContent = hover
    ? (
        <span className="home-section-meta is-hover">
          <span className="home-week-meta-dot" style={{ background: hover.seg.fullColor }} />
          <strong>{hover.seg.name}</strong>
          <span className="home-section-meta-sep" aria-hidden="true">·</span>
          {fmtHrMin(hover.seg.ms)}
          <span className="home-section-meta-sep" aria-hidden="true">·</span>
          <span className="home-section-meta-day">{hover.day.fullLabel}</span>
        </span>
      )
    : hasAny && !isRail
      ? (
          <span className="home-section-meta">
            <strong>{fmtHrMin(weekTotalMs)}</strong> across {weekActiveDays}
            {weekActiveDays === 1 ? " day" : " days"}
          </span>
        )
      : null;

  const bars = (
    <div
      className="home-week-bars"
      onMouseLeave={() => setHover(null)}
    >
      {weekDays.map((d, dayIdx) => {
        const heightPct = (d.focusedMs / peak) * 100;
        return (
          <div
            key={d.dayKey}
            className={`home-week-col${d.isToday ? " is-today" : ""}${d.focusedMs > 0 ? " has-any" : ""}`}
          >
            <div className="home-week-bar-wrap">
              <div
                className="home-week-bar"
                style={{ height: `${Math.max(3, heightPct)}%` }}
              >
                {d.segments.map((s, segIdx) => {
                  const isHovered =
                    hover && hover.dayIdx === dayIdx && hover.segIdx === segIdx;
                  const isFaded = hover && !isHovered;
                  return (
                    <div
                      key={s.id}
                      className={`home-week-bar-seg${isHovered ? " is-hovered" : ""}${isFaded ? " is-faded" : ""}`}
                      style={{
                        flexBasis: `${(s.ms / d.focusedMs) * 100}%`,
                        background: isHovered ? s.fullColor : s.color,
                      }}
                      onMouseEnter={() =>
                        setHover({ dayIdx, segIdx, day: d, seg: s })
                      }
                    />
                  );
                })}
              </div>
            </div>
            <div className="home-week-label">{d.dayLabel}</div>
            {!isRail && (
              <div className="home-week-time">
                {d.focusedMs > 0 ? fmtHrMin(d.focusedMs) : "—"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const legend = !isRail && hasAny && weekLegend.length > 0 && (
    <ul className="home-week-legend">
      {weekLegend.map((p) => (
        <li key={p.id} className="home-week-legend-row">
          <span className="home-week-legend-dot" style={{ background: p.color }} />
          <span className="home-week-legend-name">{p.name}</span>
          <span className="home-week-legend-ms">{fmtHrMin(p.ms)}</span>
        </li>
      ))}
    </ul>
  );

  const emptyState = !hasAny && (
    <div className="home-week-empty">
      <EmptyState
        variant="inline"
        message={`No focused time in the last ${weekDays.length} days`}
        hint="Start a timer on any task and the chart will fill in."
      />
    </div>
  );

  // Rail variant — compact rail-card chrome (used by /home rail).
  if (isRail) {
    return (
      <section className={`home-rail-card home-week-recap-card${hover ? " is-hovering" : ""}`}>
        <div className="home-rail-card-title home-rail-card-title-row">
          {icon && <span className="home-rail-icon-wrap">{icon}</span>}
          <span>{title}</span>
          {hasAny && (
            <span className="home-week-rail-total">{fmtHrMin(weekTotalMs)}</span>
          )}
        </div>
        {href ? (
          <a
            href={href}
            className="home-week-recap home-week-recap--rail"
            aria-label={`Open ${title.toLowerCase()} breakdown in stats`}
          >
            {bars}
            {emptyState}
          </a>
        ) : (
          <div className="home-week-recap home-week-recap--rail">
            {bars}
            {emptyState}
          </div>
        )}
        {/* Hover meta sits below the bars in rail mode (reserved height
            so the card doesn't jump when hover toggles). */}
        <div className="home-week-rail-meta">{metaContent}</div>
      </section>
    );
  }

  // Default (main column) variant.
  const inner = (
    <>
      {bars}
      {emptyState}
      {legend}
    </>
  );

  return (
    <section className={`home-section${hover ? " is-hovering" : ""}`}>
      <h2 className="home-section-title home-section-title-row">
        <span>{title}</span>
        {metaContent}
      </h2>
      {href ? (
        <a
          href={href}
          className="home-week-recap"
          aria-label={`Open ${title.toLowerCase()} breakdown in stats`}
        >
          {inner}
        </a>
      ) : (
        <div className="home-week-recap">{inner}</div>
      )}
    </section>
  );
}
