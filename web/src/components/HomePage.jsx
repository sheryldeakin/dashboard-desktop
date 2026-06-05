import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
  persistContent,
  normalizeContentRecord,
  newId,
  parseIsoMs,
  createDefaultTask,
  createHistoryEntry,
  removeLatestHistoryEntry,
  MAX_TASK_HISTORY_ITEMS,
} from "../utils/taskUtils.js";
import EmptyState from "./EmptyState.jsx";
import Tooltip from "./Tooltip.jsx";
import Stat from "./Stat.jsx";
import StatGrid from "./StatGrid.jsx";
import RailCard from "./RailCard.jsx";
import RelativeTime from "./RelativeTime.jsx";
import WeekRecap from "./WeekRecap.jsx";
import ClaudeProjectBucket, { buildClaudeBuckets } from "./ClaudeProjectBucket.jsx";
import Chip from "./Chip.jsx";

/* Icon-button glyphs for UnfinishedSection row actions. Replaces the
   four "carry · done · promote · drop" text buttons. Each icon is paired
   with a Tooltip so the action name + intent show on hover. */
const UNFINISHED_ICONS = {
  carry: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8h9" />
      <path d="M8.5 4.5L12 8l-3.5 3.5" />
    </svg>
  ),
  done: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  ),
  promote: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h7" />
      <path d="M3 8h10" />
      <path d="M3 4h10" />
      <path d="M11.5 10.5L13.5 12l-2 1.5" />
    </svg>
  ),
  drop: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 4l10 9" />
      <path d="M13 4L3 13" />
    </svg>
  ),
};

/* Small icon set for EmptyState components. Stroke-based, currentColor,
   matching the rail icon set's visual weight (1.8px strokes). Defined
   once here so the empty states across the page read as siblings. */
const EMPTY_ICONS = {
  // Yesterday's loose ends, when nothing is left open.
  pageClean: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h9l4 4v12H6z" />
      <path d="M15 4v4h4" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  ),
  // No upcoming tasks
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4M16 4v4M4 11h16" />
    </svg>
  ),
  // No focused time
  hourglass: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10M7 20h10" />
      <path d="M7 4c0 5 5 5 5 8s-5 3-5 8" />
      <path d="M17 4c0 5-5 5-5 8s5 3 5 8" />
    </svg>
  ),
  // No active task / right now
  pulse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </svg>
  ),
  // No chats pinned
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v11h-9l-4 3v-3H4z" />
    </svg>
  ),
  // No projects today
  projects: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </svg>
  ),
};

/* /home — daily-driver landing.
   Sections: header (date + deadline countdown), today's Top 3 (editable),
   unfinished from yesterday (carry/done/promote/drop actions).
   Other sections (peak hour, resume, up next) queued for follow-up turns.

   State pattern matches useTasks: pristineRef holds the full loaded content
   so save bodies preserve fields HomePage doesn't manage (workSessions,
   todaysTasks, etc.). Without it, every Top 3 edit would clobber those. */

const MS_PER_MIN = 60 * 1000;
const MS_PER_HR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HR;
const TOP3_TAG = "carried-from-top3";

function todayKey() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * MS_PER_MIN;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const tz = d.getTimezoneOffset() * MS_PER_MIN;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function dayCountUntil(iso) {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const now = Date.now();
  const days = Math.ceil((target - now) / MS_PER_DAY);
  return days;
}

function formatDateLong(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/* Mix a hex/rgb color toward white by `amount` (0 = original, 1 = pure
   white). Returns a solid rgb() string so adjacent segments don't bleed
   through each other (rgba alpha would let the bar's grey background show
   between them). Used for large-area fills like the week-recap bars,
   where the saturated palette reads as abrasive vs. small color dots.
   Falls back to the original color string if the format isn't hex/rgb. */
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

/* ── Schedule heartbeat status ── */
// Expected cadence per script + the multiplier at which we call it "stale".
// Stale threshold = expected × 2 — gives one missed run worth of grace before
// raising the alarm.
const HEARTBEAT_SPEC = [
  { key: "sync-top3",              label: "Top 3 sync",         expectedMin: 5 },
  { key: "sync-todos",             label: "Todos sync",         expectedMin: 15 },
  { key: "import-claude-sessions", label: "Claude import",      expectedMin: 60 },
  { key: "backup-dashboard",       label: "Daily backup",       expectedMin: 60 * 24 },
];

function relTime(ms) {
  const min = Math.floor(ms / MS_PER_MIN);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 60 / 24)}d ago`;
}

/* Shared hook so the banner (full-width, top of page) and the rail card
   (right column) read from the same computed rows. Ticks every 30s to keep
   "Xm ago" labels fresh. */
function useHeartbeatRows(heartbeats) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return HEARTBEAT_SPEC.map((s) => {
    const iso = heartbeats?.[s.key];
    const ts = iso ? Date.parse(iso) : null;
    const ageMs = ts ? now - ts : null;
    const stale = ts === null || ageMs > s.expectedMin * MS_PER_MIN * 2;
    return { ...s, iso, ts, ageMs, stale };
  });
}

/* ── Rail-card title icons ──
   Inline 14×14 SVGs, currentColor + 1.6px stroke. Sit before each card
   title so the rail can be scanned by shape instead of by reading every
   uppercase label. All paths designed to feel related (stroke-based,
   rounded caps/joins, same visual weight) — they read as a set. */
const RAIL_ICONS = {
  rightNow: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  ),
  deadline: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M3.5 2v12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.5 3h8l-2 2.5L11.5 8h-8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  projects: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M8 2a6 6 0 1 0 6 6H8V2z" fill="currentColor" opacity="0.45" />
      <path d="M8 2v6h6A6 6 0 0 0 8 2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  hours: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M2.5 13V7M6 13V4M9.5 13V8M13 13V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  peak: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path
        d="M8 2c.4 1.4-.8 2.6 0 4 .7 1.2 2.5.7 2.5 2.8 0 1.9-1.8 3.4-3.8 3.4S2.9 10.7 2.9 8.8c0-1.8 1.2-2.5 1.9-3.4C5.4 4.4 5.4 3.5 5 2.6c1.1.4 1.9 1.1 2.3 2.3"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  ),
  upNext: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  chats: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-5l-3 2.5v-2.5h-3v-7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  schedule: (
    <svg viewBox="0 0 16 16" className="home-rail-icon" aria-hidden="true">
      <path d="M1.5 8h2.5l1.5-3 2 6 1.5-3h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
    </svg>
  ),
};

function RailCardTitle({ icon, children, className = "" }) {
  return (
    <div className={`home-rail-card-title ${className}`.trim()}>
      {icon && <span className="home-rail-icon-wrap">{icon}</span>}
      <span>{children}</span>
    </div>
  );
}

/* Banner sits above the layout grid (full width). Only renders if at least
   one heartbeat is stale — otherwise the page should feel calm. */
function ScheduleBanner({ rows }) {
  const staleRows = rows.filter((r) => r.stale);
  if (staleRows.length === 0) return null;
  return (
    <section className="home-schedule-banner">
      <div className="home-schedule-banner-title">
        ⚠ Schedule issue: {staleRows.length} task{staleRows.length === 1 ? "" : "s"} not running
      </div>
      <ul className="home-schedule-banner-list">
        {staleRows.map((r) => (
          <li key={r.key}>
            <strong>{r.label}</strong> —{" "}
            {r.iso ? `last run ${relTime(r.ageMs)}` : "no run recorded"}
            {" "}(expected every {r.expectedMin < 60 ? `${r.expectedMin} min` : r.expectedMin === 60 ? "hour" : `${r.expectedMin / 60} hr`})
          </li>
        ))}
      </ul>
      <p className="home-schedule-banner-help">
        Run a script manually to diagnose, or check{" "}
        <code>schtasks /query /tn Dashboard{`<name>`} /v /fo LIST | findstr "Last Result"</code>
        {" "}— anything other than 0 means it crashed.
      </p>
    </section>
  );
}

/* Compact rail card. Headline = single status pill ("all running" / "X stale")
   with a fold-out detail list. Trades visibility-by-default for chrome. */
function ScheduleHealthCard({ rows }) {
  const staleCount = rows.filter((r) => r.stale).length;
  const [open, setOpen] = useState(staleCount > 0);
  return (
    <section className="home-rail-card">
      <button
        type="button"
        className="home-rail-card-toggle"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
      >
        <span className="home-rail-card-title home-rail-card-title-row">
          <span className="home-rail-icon-wrap">{RAIL_ICONS.schedule}</span>
          <span>Schedule</span>
        </span>
        <span className={`home-status-pill${staleCount === 0 ? " is-ok" : " is-warn"}`}>
          {staleCount === 0 ? "● all running" : `⚠ ${staleCount} stale`}
        </span>
      </button>
      {open && (
        <ul className="home-schedule-list">
          {rows.map((r) => (
            <li key={r.key} className={`home-schedule-row${r.stale ? " is-stale" : ""}`}>
              <span className="home-schedule-name">{r.label}</span>
              <span className="home-schedule-when">
                {r.iso ? relTime(r.ageMs) : "never"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Peak hour pattern (last 8 weeks) ── */
function computePeakHour(workSessions) {
  const cutoff = Date.now() - 8 * 7 * MS_PER_DAY;
  const hourMs = Array(24).fill(0);
  const hourDays = Array.from({ length: 24 }, () => new Set());
  for (const ws of workSessions || []) {
    const start = parseIsoMs(ws.startedAt);
    if (start === null || start < cutoff) continue;
    const end = parseIsoMs(ws.endedAt);
    if (end === null || end <= start) continue;
    const activeMs = ws.activeMs || end - start;
    const factor = activeMs / (end - start);
    let cursor = start;
    while (cursor < end) {
      const d = new Date(cursor);
      const hr = d.getHours();
      const nextBoundary = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        hr + 1,
        0,
        0
      ).getTime();
      const segEnd = Math.min(end, nextBoundary);
      hourMs[hr] += (segEnd - cursor) * factor;
      hourDays[hr].add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      cursor = segEnd;
    }
  }
  let peakHr = -1;
  let peakTotalMs = 0;
  for (let h = 0; h < 24; h++) {
    if (hourMs[h] > peakTotalMs) {
      peakTotalMs = hourMs[h];
      peakHr = h;
    }
  }
  if (peakHr === -1) return null;
  const activeDays = hourDays[peakHr].size;
  return {
    hour: peakHr,
    avgMinPerActiveDay: activeDays > 0 ? Math.round(peakTotalMs / activeDays / MS_PER_MIN) : 0,
    activeDays,
    totalMs: peakTotalMs,
  };
}

/* Compact rail card. Hero number = peak hour; sub-line = the contextual
   "when" hint based on current clock vs peak. */
function PeakHourCard({ workSessions }) {
  const peak = useMemo(() => computePeakHour(workSessions), [workSessions]);
  if (!peak) return null;
  const now = new Date();
  const currentHr = now.getHours();
  const currentMin = now.getMinutes();
  const diff = currentHr - peak.hour;
  let when;
  let whenTone = "neutral";
  if (currentHr === peak.hour) {
    when = "in your green window";
    whenTone = "good";
  } else if (currentHr === peak.hour - 1) {
    when = `opens in ${60 - currentMin} min`;
    whenTone = "good";
  } else if (diff >= 1 && diff <= 3) {
    when = `${diff}h past peak`;
  } else if (diff > 3) {
    when = "well past peak";
  } else {
    when = `opens in ${peak.hour - currentHr}h`;
  }
  return (
    <RailCard title="Peak hour" icon={RAIL_ICONS.peak}>
      <Stat
        value={`${peak.hour}:00`}
        label={`avg ${peak.avgMinPerActiveDay}m`}
      />
      <div className={`home-rail-hint home-rail-hint-${whenTone}`}>{when}</div>
    </RailCard>
  );
}

/* ── Up next (upcoming-due tasks) — compact rail card ── */
function UpNextCard({ tasks }) {
  const items = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return (tasks || [])
      .filter((t) => !t.done && t.dueDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5)
      .map((t) => {
        const dueMs = Date.parse(t.dueDate + "T00:00:00") || Date.parse(t.dueDate);
        const days = Number.isFinite(dueMs) ? Math.ceil((dueMs - todayMs) / MS_PER_DAY) : null;
        return { id: t.id, text: t.text, daysUntil: days, priority: t.priority, dueDate: t.dueDate };
      });
  }, [tasks]);

  if (!items.length) {
    return (
      <section className="home-rail-card">
        <RailCardTitle icon={RAIL_ICONS.upNext}>Up next</RailCardTitle>
        <EmptyState
          variant="inline"
          message="Nothing due"
          hint="Add a due date in /todo and it surfaces here."
        />
      </section>
    );
  }
  return (
    <section className="home-rail-card">
      <div className="home-rail-card-title">Up next</div>
      <ul className="home-upnext-list">
        {items.map((it) => {
          const overdue = it.daysUntil !== null && it.daysUntil < 0;
          const dueLabel =
            it.daysUntil === null   ? it.dueDate
            : it.daysUntil < 0      ? `${-it.daysUntil}d over`
            : it.daysUntil === 0    ? "today"
            : it.daysUntil === 1    ? "tmrw"
            : `${it.daysUntil}d`;
          const prioLabel =
            it.priority === "high"   ? "high priority"
            : it.priority === "medium" ? "medium priority"
            : it.priority === "low"  ? "low priority"
            : null;
          return (
            <li key={it.id} className={`home-upnext-row${overdue ? " is-overdue" : ""}`}>
              <span className="home-upnext-text">
                {prioLabel && (
                  <span
                    className={`home-prio-dot home-prio-dot-${it.priority}`}
                    title={prioLabel}
                    aria-label={prioLabel}
                  />
                )}
                {it.text}
              </span>
              <span className="home-upnext-due">{dueLabel}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Countdown card — top of rail, gracefully omitted if no deadline. ── */
function CountdownCard({ content }) {
  const daysLeft = dayCountUntil(content.deadlineDate);
  if (daysLeft === null) return null;
  const title = content.title || "submission";
  return (
    <RailCard title="Deadline" icon={RAIL_ICONS.deadline}>
      <Stat value={daysLeft} label={`${daysLeft === 1 ? "day" : "days"} left to ${title}`} />
    </RailCard>
  );
}

/* ── Today snapshot computation ──
   One pass over workSessions / tasks / pomodoro state, returns everything
   the rail cards + snapshot strip need. Keeps the components dumb-render-only
   and avoids walking workSessions five times.
   Also produces yesterday's mirror stats (focusedMs / sessionCount / done /
   topProject) for the snapshot strip's "vs yesterday" delta, plus a streak
   count of consecutive days ending today/yesterday with any focused time. */
function useTodayStats(content) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const tomorrowMs = todayMs + MS_PER_DAY;
    const yesterdayMs = todayMs - MS_PER_DAY;

    // Project lookup: id → {name, color}
    const projectMap = new Map(
      (content.projects || []).map((p) => [p.id, { name: p.name, color: p.color }])
    );

    // Local-day key (YYYY-MM-DD) for the start-of-local-day timestamp.
    // Used to build a histogram of focused ms by day, which feeds both the
    // yesterday comparison and the streak walk.
    function localDayKey(ms) {
      const d = new Date(ms);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    const todayKey = localDayKey(todayMs);
    const yesterdayKeyStr = localDayKey(yesterdayMs);
    const msByDay = new Map();  // dayKey → totalActiveMs across all projects
    const msByDayProject = new Map();  // dayKey → Map(projectId → ms) for stacked week bars

    // Yesterday accumulators (mirror of today's; same shape so the snapshot
    // strip can compute deltas uniformly).
    let yFocusedMs = 0;
    let ySessionCount = 0;
    const yByProject = new Map();

    // Today's work sessions
    let focusedMs = 0;
    let sessionCount = 0;
    const byProject = new Map();   // projectId → ms
    const byHour = Array(24).fill(0);  // ms per hour bucket
    // Per-(hour, project) ms — feeds the per-hour stacked segments in
    // HourRibbonCard. Mirror of byHour but bucketed by project.
    const byHourProject = Array.from({ length: 24 }, () => new Map());
    let lastSessionEnd = null;

    for (const ws of content.workSessions || []) {
      const start = parseIsoMs(ws.startedAt);
      const end = parseIsoMs(ws.endedAt);
      if (start === null || end === null) continue;

      const active = ws.activeMs || Math.max(0, end - start);
      const pid = ws.projectId || "";

      // Bucket the session into msByDay using its start-day. Good enough
      // for streak/yesterday roll-ups; cross-midnight sessions are rare
      // and we already break them into hour buckets for the ribbon below.
      const startKey = localDayKey(start);
      msByDay.set(startKey, (msByDay.get(startKey) || 0) + active);
      // Also bucket by (day, project) so the week-recap bars can be
      // stacked into project-colored segments without re-walking sessions.
      let dayProjects = msByDayProject.get(startKey);
      if (!dayProjects) {
        dayProjects = new Map();
        msByDayProject.set(startKey, dayProjects);
      }
      dayProjects.set(pid, (dayProjects.get(pid) || 0) + active);

      // Yesterday roll-up
      if (start >= yesterdayMs && start < todayMs) {
        yFocusedMs += active;
        ySessionCount += 1;
        yByProject.set(pid, (yByProject.get(pid) || 0) + active);
      }

      if (start >= tomorrowMs || end < todayMs) continue;

      focusedMs += active;
      sessionCount += 1;
      byProject.set(pid, (byProject.get(pid) || 0) + active);
      if (end > (lastSessionEnd || 0)) lastSessionEnd = end;

      // Distribute into hour buckets (proportional). Also splits the
      // contribution by project so the hour ribbon can stack project-
      // colored segments inside each bar.
      const factor = end > start ? active / (end - start) : 0;
      let cursor = Math.max(start, todayMs);
      const wsEnd = Math.min(end, tomorrowMs);
      while (cursor < wsEnd) {
        const d = new Date(cursor);
        const hr = d.getHours();
        const boundary = new Date(
          d.getFullYear(), d.getMonth(), d.getDate(), hr + 1, 0, 0
        ).getTime();
        const segEnd = Math.min(wsEnd, boundary);
        const slice = (segEnd - cursor) * factor;
        byHour[hr] += slice;
        byHourProject[hr].set(pid, (byHourProject[hr].get(pid) || 0) + slice);
        cursor = segEnd;
      }
    }

    // Top project today
    let topProject = null;
    for (const [pid, ms] of byProject) {
      if (!topProject || ms > topProject.ms) {
        topProject = { id: pid, name: projectMap.get(pid)?.name || "Unknown", ms };
      }
    }

    // Today's task progress
    const todays = content.todaysTasks || [];
    const total = todays.length;
    const done = todays.filter((t) => t.done).length;

    // Right now: pomodoro running > task timer running > task timer paused > idle
    let rightNow = null;
    const pomo = content.pomodoro || {};
    const runningTask = todays.find((t) => t.timer?.status === "running");
    const pausedTask = todays.find((t) => t.timer?.status === "paused");

    if (runningTask) {
      const startedAt = parseIsoMs(runningTask.timer?.startedAt);
      const elapsedMs = startedAt ? Date.now() - startedAt : 0;
      rightNow = {
        kind: "running",
        label: runningTask.text,
        detail: `${Math.floor(elapsedMs / MS_PER_MIN)}m in`,
      };
    } else if (pausedTask) {
      rightNow = { kind: "paused", label: pausedTask.text, detail: "paused" };
    } else if (lastSessionEnd) {
      const minSince = Math.floor((Date.now() - lastSessionEnd) / MS_PER_MIN);
      rightNow = {
        kind: "idle",
        label: `Last session ended ${minSince}m ago`,
        detail: null,
      };
    } else {
      rightNow = { kind: "idle", label: "No sessions yet today", detail: null };
    }

    // Project mix: top 4 + "Other" — for the rail mini-bar.
    // Most auto-created projects share the same default color, which made
    // the stacked bar look like one solid block. Assign palette colors by
    // position (after sorting) so segments are always visibly distinct.
    // Respect a stored color only if it's non-default; otherwise palette.
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
      "#b66e35",  // app-wide default accent — treat as "no real color set"
      "",
      null,
      undefined,
    ]);

    const projectMix = [...byProject.entries()]
      .map(([pid, ms]) => {
        const storedColor = projectMap.get(pid)?.color;
        return {
          id: pid,
          name: projectMap.get(pid)?.name || "Other",
          storedColor: PROJMIX_DEFAULT_COLORS.has(storedColor) ? null : storedColor,
          ms,
        };
      })
      .sort((a, b) => b.ms - a.ms)
      .map((p, i) => ({
        ...p,
        color: p.storedColor || PROJMIX_PALETTE[i % PROJMIX_PALETTE.length],
      }));
    const mixTop = projectMix.slice(0, 4);
    const mixRest = projectMix.slice(4);
    if (mixRest.length) {
      mixTop.push({
        id: "__other",
        name: "Other",
        color: "rgba(0,0,0,0.25)",
        ms: mixRest.reduce((sum, p) => sum + p.ms, 0),
      });
    }

    // Yesterday's top project (for snapshot's vs-yesterday in the "Top" cell)
    let yTopProject = null;
    for (const [pid, ms] of yByProject) {
      if (!yTopProject || ms > yTopProject.ms) {
        yTopProject = { id: pid, name: projectMap.get(pid)?.name || "Unknown", ms };
      }
    }

    // Yesterday's "done" count from taskHistory (workSessions don't track
    // completions; taskHistory does). Match entries by date string.
    const yDone = (content.taskHistory || []).filter(
      (h) => h.completedAtDate === yesterdayKeyStr
    ).length;

    // Streak: count consecutive prior days with any focused time. If today
    // already has focused time, the streak includes today. Otherwise we
    // start at yesterday so the streak doesn't drop just because you
    // haven't started yet — pro dashboards typically work this way.
    let streak = 0;
    let cursorMs = focusedMs > 0 ? todayMs : yesterdayMs;
    while (true) {
      const key = localDayKey(cursorMs);
      const ms = msByDay.get(key) || 0;
      if (ms <= 0) break;
      streak += 1;
      cursorMs -= MS_PER_DAY;
      // Safety: cap at 365 to avoid infinite loops if data is weird
      if (streak > 365) break;
    }

    // Past 7 days (oldest → today) for the week-recap section. Reuses the
    // msByDay histogram built above so we don't walk workSessions again.
    // Single-letter labels (M T W T F S S) since we have 7 columns to fit.
    const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];

    // Stable per-project colors across the 7 days. Computed once from the
    // total ms each project contributed all week so a project's color
    // doesn't flip if its rank shifts between days. Falls back to the
    // shared palette (same as today's project-mix card) for unset/default
    // project colors so the week and the today rail-card agree visually.
    const weekProjectTotals = new Map();
    for (let i = 6; i >= 0; i--) {
      const key = localDayKey(todayMs - i * MS_PER_DAY);
      const dayProjects = msByDayProject.get(key);
      if (!dayProjects) continue;
      for (const [pid, ms] of dayProjects) {
        weekProjectTotals.set(pid, (weekProjectTotals.get(pid) || 0) + ms);
      }
    }
    const weekProjectColors = new Map();
    [...weekProjectTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([pid], idx) => {
        const stored = projectMap.get(pid)?.color;
        const useStored = stored && !PROJMIX_DEFAULT_COLORS.has(stored);
        weekProjectColors.set(
          pid,
          useStored ? stored : PROJMIX_PALETTE[idx % PROJMIX_PALETTE.length]
        );
      });

    const weekDays = [];
    for (let i = 6; i >= 0; i--) {
      const dayMs = todayMs - i * MS_PER_DAY;
      const key = localDayKey(dayMs);
      const d = new Date(dayMs);
      const dayProjects = msByDayProject.get(key);
      // Sort segments largest → smallest so the most significant project
      // visually anchors the bottom of the bar (CSS uses column-reverse to
      // stack with first-in-array at the visual bottom).
      // Bar fills use softenColor() — saturated colors feel abrasive at
      // bar-fill scale vs. small-dot scale. The legend below the bars
      // keeps the full-saturation color as the "key" so users can match
      // a softened bar segment back to the saturated dot.
      const segments = dayProjects
        ? [...dayProjects.entries()]
            .map(([pid, ms]) => {
              const baseColor = weekProjectColors.get(pid) || "rgba(0,0,0,0.25)";
              return {
                id: pid,
                name: projectMap.get(pid)?.name || "Unassigned",
                color: softenColor(baseColor, 0.45),
                // Keep the full-saturation color so per-segment hover can
                // re-saturate just the hovered segment without re-running
                // softenColor on every render.
                fullColor: baseColor,
                ms,
              };
            })
            .sort((a, b) => b.ms - a.ms)
        : [];
      weekDays.push({
        dayKey: key,
        dayLabel: weekdayLetters[d.getDay()],
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

    // Project legend for the week (top projects by total week ms, with
    // their assigned colors). Lets the WeekRecap render a small key.
    const weekLegend = [...weekProjectTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pid, ms]) => ({
        id: pid,
        name: projectMap.get(pid)?.name || "Unassigned",
        color: weekProjectColors.get(pid),
        ms,
      }));

    // Per-hour stacked segments. Uses the SAME weekProjectColors map so
    // a given project shows the same color in the week recap, the today
    // project-mix card, and the hour ribbon. Soften for bar fills; keep
    // the saturated color for hover re-saturation.
    const byHourSegments = byHourProject.map((hourMap) => {
      return [...hourMap.entries()]
        .map(([pid, ms]) => {
          const baseColor = weekProjectColors.get(pid) || "rgba(0,0,0,0.25)";
          return {
            id: pid,
            name: projectMap.get(pid)?.name || "Unassigned",
            color: softenColor(baseColor, 0.45),
            fullColor: baseColor,
            ms,
          };
        })
        .sort((a, b) => b.ms - a.ms);
    });

    return {
      focusedMs,
      sessionCount,
      done,
      total,
      topProject,
      rightNow,
      projectMix: mixTop,
      byHour,
      byHourSegments,
      hasAnyToday: focusedMs > 0,
      // New: comparison data
      yesterday: {
        focusedMs: yFocusedMs,
        sessionCount: ySessionCount,
        done: yDone,
        topProject: yTopProject,
      },
      streak,
      // Week recap for the section under UnfinishedSection
      weekDays,
      weekTotalMs,
      weekActiveDays,
      weekLegend,
    };
  }, [content]);
}

function fmtHrMin(ms) {
  const min = Math.floor(ms / MS_PER_MIN);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/* ── Today snapshot strip (main column, above Top 3) ──
   4-cell grid with hairline dividers. Each cell is now its own link to a
   relevant /stats?tab=... drill-down. Numbers are bigger + lighter weight
   (dashboard energy) with a tiny "vs yesterday" delta beneath. Deltas use
   muted sage/coral so they read as supporting info, not alerts. */
function formatDeltaMs(todayMs, yMs) {
  const diff = todayMs - yMs;
  if (Math.abs(diff) < MS_PER_MIN) return { sign: "neutral", label: "same as yesterday" };
  const sign = diff > 0 ? "up" : "down";
  return { sign, label: `${diff > 0 ? "+" : "−"}${fmtHrMin(Math.abs(diff))} vs yesterday` };
}
function formatDeltaInt(today, y, singular = "") {
  const diff = today - y;
  if (diff === 0) return { sign: "neutral", label: "same as yesterday" };
  const sign = diff > 0 ? "up" : "down";
  const unit = singular ? ` ${Math.abs(diff) === 1 ? singular : singular + "s"}` : "";
  return { sign, label: `${diff > 0 ? "+" : "−"}${Math.abs(diff)}${unit} vs yesterday` };
}

function TodaySnapshot({ stats }) {
  const y = stats.yesterday;
  const topName = stats.topProject?.name || "—";
  const topMs = stats.topProject ? fmtHrMin(stats.topProject.ms) : "";

  // Per-cell deltas — only show when there's something to compare against.
  const focusedDelta = y.focusedMs > 0 || stats.focusedMs > 0
    ? formatDeltaMs(stats.focusedMs, y.focusedMs) : null;
  const sessionsDelta = y.sessionCount > 0 || stats.sessionCount > 0
    ? formatDeltaInt(stats.sessionCount, y.sessionCount, "session") : null;
  const doneDelta = y.done > 0 || stats.done > 0
    ? formatDeltaInt(stats.done, y.done, "task") : null;
  // Top-project delta is qualitative — show "same project" vs "switched"
  const topDelta = (() => {
    if (!y.topProject && !stats.topProject) return null;
    if (!y.topProject) return { sign: "up", label: "new today" };
    if (!stats.topProject) return { sign: "down", label: `was ${y.topProject.name}` };
    if (y.topProject.id === stats.topProject.id) return { sign: "neutral", label: "same as yesterday" };
    return { sign: "up", label: `was ${y.topProject.name}` };
  })();

  return (
    <section
      className="home-today-snapshot"
      aria-label="Today snapshot — each cell links to a stats drill-down"
    >
      <StatGrid
        variant="snapshot"
        columns={[
          {
            value: fmtHrMin(stats.focusedMs),
            label: "Focused",
            delta: focusedDelta,
            href: "/stats?tab=today",
          },
          {
            value: stats.sessionCount,
            label: stats.sessionCount === 1 ? "Session" : "Sessions",
            delta: sessionsDelta,
            href: "/stats?tab=today",
          },
          {
            value: stats.done,
            secondary: `/${stats.total}`,
            label: "Done",
            delta: doneDelta,
            href: "/stats?tab=today",
          },
          {
            value: topName,
            label: `Top${topMs ? ` · ${topMs}` : ""}`,
            delta: topDelta,
            isText: true,
            title: topName,
            href: "/stats?tab=today",
          },
        ]}
      />
    </section>
  );
}

/* ── Right now (rail) ── */
function RightNowCard({ rightNow }) {
  if (!rightNow) return null;
  const dotClass =
    rightNow.kind === "running" ? "is-running"
    : rightNow.kind === "paused" ? "is-paused"
    : "is-idle";
  return (
    <section className="home-rail-card">
      <RailCardTitle icon={RAIL_ICONS.rightNow}>Right now</RailCardTitle>
      <div className="home-rightnow">
        <span className={`home-rightnow-dot ${dotClass}`} />
        <span className="home-rightnow-text">{rightNow.label}</span>
      </div>
      {rightNow.detail && (
        <div className="home-rail-hint">{rightNow.detail}</div>
      )}
    </section>
  );
}

/* ── Today by project ──
   Renders with two chrome variants:
     - placement="rail"  → compact .home-rail-card with icon title
     - placement="main"  → full .home-section with header row (label + total)
   Same data, same bar/list inside; only the outer wrapper + title differ. */
function ProjectMixCard({ mix, totalMs, placement = "rail" }) {
  const hasAny = mix && mix.length > 0 && totalMs > 0;

  // In rail placement we hide the card entirely when empty (one fewer
  // distraction). In main placement we keep the section visible with an
  // empty state so the page structure stays predictable day to day.
  if (!hasAny && placement === "rail") return null;

  if (!hasAny && placement === "main") {
    return (
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Today by project</span>
        </h2>
        <EmptyState
          icon={EMPTY_ICONS.projects}
          message="No project time today"
          hint="Start a timer on a task to see how today's hours split by project."
        />
      </section>
    );
  }

  const inner = (
    <>
      <div className="home-projmix-bar">
        {mix.map((p) => (
          <div
            key={p.id}
            className="home-projmix-seg"
            style={{
              width: `${(p.ms / totalMs) * 100}%`,
              background: p.color,
            }}
            title={`${p.name}: ${fmtHrMin(p.ms)}`}
          />
        ))}
      </div>
      <ul className="home-projmix-list">
        {mix.map((p) => (
          <li key={p.id} className="home-projmix-row">
            <span className="home-projmix-dot" style={{ background: p.color }} />
            <span className="home-projmix-name">{p.name}</span>
            <span className="home-projmix-ms">{fmtHrMin(p.ms)}</span>
          </li>
        ))}
      </ul>
    </>
  );

  if (placement === "main") {
    return (
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Today by project</span>
          <span className="home-section-meta">
            <strong>{fmtHrMin(totalMs)}</strong> total
          </span>
        </h2>
        {inner}
      </section>
    );
  }
  return (
    <section className="home-rail-card">
      <RailCardTitle icon={RAIL_ICONS.projects}>Today by project</RailCardTitle>
      {inner}
    </section>
  );
}

/* ── Hour ribbon (adaptive width) ──
   Shows N hours centered around current; N adapts to container width via
   a ResizeObserver. Min 8 hours, max 16. Bar height ∝ activity that hour,
   normalized to today's peak. Bars are stacked project-colored segments
   (same palette as the week recap + project-mix card). Hovering a segment
   re-saturates that segment and fades the rest; in main placement the
   section meta surfaces the project/hour/duration on hover.
   Current hour outlined. */
function HourRibbonCard({ byHour, byHourSegments, placement = "rail" }) {
  const containerRef = useRef(null);
  const [hourCount, setHourCount] = useState(12);
  const [hover, setHover] = useState(null);  // { hr, segIdx, seg } | null
  const hasAny = byHour && byHour.some((m) => m > 0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        // ~16px per bar incl. gap is a comfortable minimum
        const n = Math.max(8, Math.min(16, Math.floor(w / 16)));
        setHourCount(n);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const peak = Math.max(...byHour, 1);
  const currentHr = new Date().getHours();
  const halfWindow = Math.floor(hourCount / 2);
  const startHr = Math.max(0, Math.min(24 - hourCount, currentHr - halfWindow));
  const endHr = startHr + hourCount;

  const bars = [];
  for (let h = startHr; h < endHr; h++) {
    const heightPct = (byHour[h] / peak) * 100;
    bars.push({ hr: h, heightPct, isCurrent: h === currentHr, hasAny: byHour[h] > 0 });
  }

  const ribbon = (
    <div
      className="home-hour-ribbon"
      ref={containerRef}
      onMouseLeave={() => setHover(null)}
    >
      {bars.map((b) => {
        const segments = (byHourSegments && byHourSegments[b.hr]) || [];
        const hourMs = byHour[b.hr];
        return (
          <div
            key={b.hr}
            className={`home-hour-col${b.isCurrent ? " is-current" : ""}${b.hasAny ? " has-any" : ""}`}
            title={hourMs > 0 ? `${b.hr}:00 — ${fmtHrMin(hourMs)}` : `${b.hr}:00`}
          >
            <div
              className="home-hour-bar"
              style={{ height: `${Math.max(4, b.heightPct)}%` }}
            >
              {segments.map((s, segIdx) => {
                const isHovered =
                  hover && hover.hr === b.hr && hover.segIdx === segIdx;
                const isFaded = hover && !isHovered;
                return (
                  <div
                    key={s.id}
                    className={`home-hour-bar-seg${isHovered ? " is-hovered" : ""}${isFaded ? " is-faded" : ""}`}
                    style={{
                      flexBasis: hourMs > 0 ? `${(s.ms / hourMs) * 100}%` : "0%",
                      background: isHovered ? s.fullColor : s.color,
                    }}
                    onMouseEnter={() =>
                      setHover({ hr: b.hr, segIdx, seg: s })
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Hover meta swap (main only — rail variant doesn't have a meta slot).
  // Default: "8:00 – 18:00" range. Hover: "Project · 45m · 14:00–15:00".
  const mainMeta = hover
    ? (
        <span className="home-section-meta is-hover">
          <span
            className="home-week-meta-dot"
            style={{ background: hover.seg.fullColor }}
          />
          <strong>{hover.seg.name}</strong>
          <span className="home-section-meta-sep" aria-hidden="true">·</span>
          {fmtHrMin(hover.seg.ms)}
          <span className="home-section-meta-sep" aria-hidden="true">·</span>
          <span className="home-section-meta-day">
            {hover.hr}:00–{hover.hr + 1}:00
          </span>
        </span>
      )
    : (
        <span className="home-section-meta">
          {startHr}:00 – {endHr - 1}:00
        </span>
      );

  if (placement === "main") {
    return (
      <section className={`home-section home-section--hour-ribbon${hover ? " is-hovering" : ""}`}>
        <h2 className="home-section-title home-section-title-row">
          <span>Today by hour</span>
          {hasAny && mainMeta}
        </h2>
        {hasAny ? ribbon : (
          <EmptyState
            icon={EMPTY_ICONS.hourglass}
            message="No focused time today yet"
            hint="When you start a timer, this ribbon fills in by the hour."
          />
        )}
      </section>
    );
  }
  return (
    <section className="home-rail-card">
      <RailCardTitle icon={RAIL_ICONS.hours}>Today by hour</RailCardTitle>
      {ribbon}
      <div className="home-hour-labels">
        <span>{startHr}:00</span>
        <span>{endHr - 1}:00</span>
      </div>
    </section>
  );
}

/* ── Chats card (rail) ──
   List of user-configured claude.ai/code remote-control session URLs.
   Each entry: { id, label, url }. Stored in localStorage so they're
   per-device — the URLs you bookmark on your work laptop are different
   from the ones on your home machine.

   Recommended usage: in a terminal, run `claude remote-control --name
   "<label>"` in the directory you want Claude to have context on
   (vault, dashboard repo, writing project, etc.). Copy the session URL
   it prints. Add it here. The chat stays available as long as that
   local process keeps running. Clicking opens it in a new tab.

   No auth on these links — anyone who can load /home can click them
   and join your live Claude session. GATE THE DASHBOARD with Vercel
   Password Protection (or Cloudflare Access) before relying on this. */

const CHATS_STORAGE_KEY = "dashboard_chat_links_v1";

function loadStoredChats() {
  try {
    const raw = localStorage.getItem(CHATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.url === "string" && typeof c.label === "string");
  } catch {
    return [];
  }
}

function saveStoredChats(chats) {
  try {
    localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats));
  } catch (e) {
    console.warn("Failed to persist chat links:", e);
  }
}

function ChatsCard() {
  const [chats, setChats] = useState(() => loadStoredChats());
  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ label: "", url: "" });

  function persist(next) {
    setChats(next);
    saveStoredChats(next);
  }

  function startAdd() {
    setDraft({ label: "", url: "" });
    setEditingId(null);
    setAddingOpen(true);
  }

  function startEdit(chat) {
    setDraft({ label: chat.label, url: chat.url });
    setEditingId(chat.id);
    setAddingOpen(true);
  }

  function commitDraft(e) {
    e?.preventDefault();
    const label = draft.label.trim();
    const url = draft.url.trim();
    if (!label || !url) return;
    if (!/^https?:\/\//i.test(url)) {
      alert("URL must start with http:// or https://");
      return;
    }
    if (editingId) {
      persist(chats.map((c) => (c.id === editingId ? { ...c, label, url } : c)));
    } else {
      persist([...chats, { id: `chat-${Date.now()}`, label, url }]);
    }
    setAddingOpen(false);
    setEditingId(null);
    setDraft({ label: "", url: "" });
  }

  function remove(id) {
    if (!window.confirm("Remove this chat link?")) return;
    persist(chats.filter((c) => c.id !== id));
  }

  return (
    <section className="home-rail-card">
      <div className="home-rail-card-title home-rail-card-title-row">
        <span className="home-rail-icon-wrap">{RAIL_ICONS.chats}</span>
        <span>Chats</span>
        <Tooltip content="Pin a chat link">
          <button
            type="button"
            className="home-chats-add"
            onClick={startAdd}
            aria-label="Pin a chat link"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
              <path
                d="M8 3.5v9M3.5 8h9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </Tooltip>
      </div>

      {chats.length === 0 && !addingOpen && (
        <EmptyState
          icon={EMPTY_ICONS.chat}
          message="No chats pinned"
          hint="Paste a claude.ai/code session URL to keep it one click away."
          action={
            <button
              type="button"
              className="home-chats-btn home-chats-btn-ghost"
              onClick={startAdd}
            >
              Pin one
            </button>
          }
        />
      )}

      {chats.length > 0 && (
        <ul className="home-chats-list">
          {chats.map((c) => (
            <li key={c.id} className="home-chats-row">
              <Tooltip content={c.url}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-chats-link"
                >
                  <span className="home-chats-dot" aria-hidden="true" />
                  {c.label}
                </a>
              </Tooltip>
              <Tooltip content="Edit">
                <button
                  type="button"
                  className="home-chats-edit"
                  onClick={() => startEdit(c)}
                  aria-label={`Edit ${c.label}`}
                >
                  ✎
                </button>
              </Tooltip>
              <Tooltip content="Remove">
                <button
                  type="button"
                  className="home-chats-edit home-chats-remove"
                  onClick={() => remove(c.id)}
                  aria-label={`Remove ${c.label}`}
                >
                  ×
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}

      {addingOpen && (
        <form className="home-chats-form" onSubmit={commitDraft}>
          <input
            type="text"
            className="home-chats-input"
            placeholder="Label (e.g. Vault chat)"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            autoFocus
          />
          <input
            type="url"
            className="home-chats-input home-chats-input-url"
            placeholder="https://claude.ai/code/…"
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <div className="home-chats-form-actions">
            <button type="submit" className="home-chats-btn">
              {editingId ? "Update" : "Add"}
            </button>
            <button
              type="button"
              className="home-chats-btn home-chats-btn-ghost"
              onClick={() => { setAddingOpen(false); setEditingId(null); }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ── Header — "Today" headline + a row of metadata chips.
   Chips are: weekday · date · focused-so-far (when > 0) · streak (when ≥ 2).
   Streak is the small motivation hook — a flame icon + day count. The
   focused-so-far chip is the quiet "you've already done X" reinforcement
   that pro dashboards use as the implicit headline metric.
   Countdown lives in the rail's CountdownCard so the header stays calm. */
function FlameIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5c.5 1.5-1 3 0 5 .8 1.6 3 .8 3 3.5 0 2.5-2.3 4.5-5 4.5S1 12.5 1 10c0-2.4 1.6-3.3 2.5-4.5C4.4 4.3 4.5 3 4 2c1.5.5 2.5 1.5 3 3 .5-1.5 1-2.5 1-3.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function HomeHeader({ stats }) {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const date = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const focusedSoFar = stats?.focusedMs > 0 ? fmtHrMin(stats.focusedMs) : null;
  const streak = stats?.streak >= 2 ? stats.streak : null;

  // Canary use of the new Chip component. The home-header / home-page-title
  // layout is preserved so we don't tackle the PageHeader migration yet
  // (that involves moving the streak chip alongside an `actions` slot —
  // worth doing when there's a reason to add page-level actions).
  return (
    <header className="home-header">
      <h1 className="home-page-title">Today</h1>
      <div className="home-header-chips" role="group" aria-label="Today summary">
        <Chip>{weekday}</Chip>
        <span className="home-chip-sep" aria-hidden="true">·</span>
        <Chip>{date}</Chip>
        {focusedSoFar && (
          <>
            <span className="home-chip-sep" aria-hidden="true">·</span>
            <Chip><strong>{focusedSoFar}</strong> focused</Chip>
          </>
        )}
        {streak && (
          <Tooltip content={`${streak} consecutive days with focused time`}>
            <Chip tone="sage" icon={<FlameIcon />}>
              <strong>{streak}</strong> day streak
            </Chip>
          </Tooltip>
        )}
      </div>
    </header>
  );
}

/* ── Snapshot pill — fixed bottom-right so it doesn't fight the header anchor.
   Stays available, but quiet. ── */
function SnapshotPill({ loadedAtMs }) {
  return (
    <div className="home-snapshot home-snapshot-fixed">
      <span className="home-snapshot-label">
        Loaded <RelativeTime since={loadedAtMs} />
      </span>
      <button
        type="button"
        className="home-snapshot-refresh"
        onClick={() => window.location.reload()}
        title="Reload to fetch the latest data"
      >
        ↻ refresh
      </button>
    </div>
  );
}

/* ── Today's intent ──
   One-line "theme" / north star for the day. Lives below the Top 3 list,
   above the footnote. Stored in localStorage keyed by date — per-device,
   no backend round-trip, no schema change. Survives reloads, rolls over
   at midnight when the date key changes. Empty state = placeholder
   prompt, not a wall of UI. */
const INTENT_STORAGE_PREFIX = "home_intent_";

function loadIntent(dateKey) {
  try {
    return localStorage.getItem(INTENT_STORAGE_PREFIX + dateKey) || "";
  } catch {
    return "";
  }
}
function saveIntent(dateKey, value) {
  try {
    if (value) localStorage.setItem(INTENT_STORAGE_PREFIX + dateKey, value);
    else localStorage.removeItem(INTENT_STORAGE_PREFIX + dateKey);
  } catch (e) {
    console.warn("Failed to persist today's intent:", e);
  }
}

function TodayIntent() {
  const dateKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [value, setValue] = useState(() => loadIntent(dateKey));

  function onChange(e) {
    const next = e.target.value;
    setValue(next);
    saveIntent(dateKey, next);
  }

  return (
    <div className="home-intent">
      <label className="home-intent-label" htmlFor="home-intent-input">
        Theme
      </label>
      <input
        id="home-intent-input"
        type="text"
        className="home-intent-input"
        placeholder="What's the thread that ties today together?"
        value={value}
        onChange={onChange}
        maxLength={120}
      />
    </div>
  );
}

/* ── Today's Top 3 (editable) ── */
function Top3Editor({ dailyTop3, tasks, onSlotChange }) {
  const slots = dailyTop3.slots;
  // Quick lookup from taskId → task so we can render running/paused state
  // for each slot's backing task and color the dot accordingly.
  const taskById = useMemo(
    () => new Map((tasks || []).map((t) => [t.id, t])),
    [tasks]
  );
  const filled = slots.filter((s) => s.text && s.text.trim()).length;
  const done = slots.filter((s) => s.done).length;
  return (
    <section className="home-section">
      <h2 className="home-section-title home-section-title-row">
        <span>Today's Top 3</span>
        {filled > 0 && (
          <span className="home-section-meta">
            <strong>{done}</strong>/{filled} done
          </span>
        )}
      </h2>
      <ul className="home-top3-list">
        {[0, 1, 2].map((i) => {
          const s = slots[i];
          const linkedTask = s.promotedTaskId ? taskById.get(s.promotedTaskId) : null;
          const timerStatus = linkedTask?.timer?.status;
          const isRunning = timerStatus === "running";
          const isPaused = timerStatus === "paused";
          return (
            <li key={i} className={`home-top3-slot${s.done ? " is-done" : ""}`}>
              <span className="home-top3-num">{i + 1}.</span>
              <input
                type="checkbox"
                className="home-top3-check"
                checked={!!s.done}
                onChange={(e) =>
                  onSlotChange(i, {
                    done: e.target.checked,
                    completedAt: e.target.checked ? new Date().toISOString() : null,
                  })
                }
                aria-label={`Mark Top 3 slot ${i + 1} done`}
              />
              <input
                type="text"
                className="home-top3-input"
                placeholder={
                  i === 0
                    ? "What's your first priority today?"
                    : `Priority ${i + 1}…`
                }
                value={s.text}
                onChange={(e) => onSlotChange(i, { text: e.target.value })}
              />
              {linkedTask && (isRunning || isPaused) && (
                <span
                  className={`home-top3-timerdot${isRunning ? " is-running" : " is-paused"}`}
                  title={isRunning ? "Timer running" : "Timer paused"}
                  aria-label={isRunning ? "Timer running" : "Timer paused"}
                />
              )}
              {linkedTask && !s.done && (
                <a
                  href={`/todo?focus=1&taskId=${encodeURIComponent(linkedTask.id)}`}
                  className="home-top3-focus"
                  title="Open in focus mode"
                  aria-label={`Focus on "${s.text}"`}
                >
                  Focus →
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <TodayIntent />
      <p className="home-top3-footnote">
        Each filled slot becomes a task tagged <code>#top-3</code> — focus, timer,
        and history work like any other task. Edits sync to today's daily
        note <code>## Top 3</code> section.
      </p>
    </section>
  );
}

/* ── Unfinished from yesterday ── */
function isSlotOpen(s) {
  return s.text && !s.done && !s.dropped && !s.carriedToDate && !s.promoted;
}

function UnfinishedSection({
  history,
  todaysSlots,
  onCarry,
  onDone,
  onPromote,
  onDrop,
}) {
  const yKey = yesterdayKey();
  const yesterdayEntry = history.find((h) => h.date === yKey);
  const yesterdayOpen = useMemo(
    () =>
      yesterdayEntry
        ? yesterdayEntry.slots
            .map((s, i) => ({ ...s, slotIdx: i }))
            .filter(isSlotOpen)
        : [],
    [yesterdayEntry]
  );

  const [showAll, setShowAll] = useState(false);
  const allOpen = useMemo(() => {
    const out = [];
    for (const h of history) {
      if (h.date === yKey) continue; // already in the yesterday section
      for (let i = 0; i < h.slots.length; i++) {
        const s = h.slots[i];
        if (isSlotOpen(s)) out.push({ ...s, slotIdx: i, dayDate: h.date });
      }
    }
    return out;
  }, [history, yKey]);

  // Always render the section — even when empty — so the affordance is
  // discoverable. Empty state lives below.
  const hasEmptySlotToday = todaysSlots.some((s) => !s.text);

  function renderRow(item, dayDate, dayLabel) {
    return (
      <li key={`${dayDate}-${item.slotIdx}`} className="home-unfinished-row">
        <span className="home-unfinished-text">{item.text}</span>
        {dayLabel && <span className="home-unfinished-date">{dayLabel}</span>}
        <span className="home-unfinished-actions">
          <Tooltip content={
            hasEmptySlotToday
              ? "Carry to today's first empty Top 3 slot"
              : "All Top 3 slots are filled"
          }>
            <button
              type="button"
              className="home-unf-action"
              disabled={!hasEmptySlotToday}
              onClick={() => onCarry(dayDate, item.slotIdx)}
              aria-label="Carry to today"
            >
              {UNFINISHED_ICONS.carry}
            </button>
          </Tooltip>
          <Tooltip content="Mark done (app-only — doesn't rewrite yesterday's daily note)">
            <button
              type="button"
              className="home-unf-action"
              onClick={() => onDone(dayDate, item.slotIdx)}
              aria-label="Mark done"
            >
              {UNFINISHED_ICONS.done}
            </button>
          </Tooltip>
          <Tooltip content="Promote to a task in your task list">
            <button
              type="button"
              className="home-unf-action"
              onClick={() => onPromote(dayDate, item.slotIdx)}
              aria-label="Promote to task"
            >
              {UNFINISHED_ICONS.promote}
            </button>
          </Tooltip>
          <Tooltip content="Drop — not done, not carried forward">
            <button
              type="button"
              className="home-unf-action home-unf-action-drop"
              onClick={() => onDrop(dayDate, item.slotIdx)}
              aria-label="Drop"
            >
              {UNFINISHED_ICONS.drop}
            </button>
          </Tooltip>
        </span>
      </li>
    );
  }

  return (
    <section className="home-section">
      <h2 className="home-section-title home-section-title-row">
        <span>Unfinished from yesterday</span>
        {yesterdayOpen.length > 0 && (
          <span className="home-section-meta">
            <strong>{yesterdayOpen.length}</strong>
            {yesterdayOpen.length === 1 ? " item" : " items"}
          </span>
        )}
      </h2>
      {yesterdayOpen.length === 0 ? (
        <EmptyState
          icon={EMPTY_ICONS.pageClean}
          message="All caught up"
          hint="Nothing from yesterday left open. Yesterday's wins are in History."
        />
      ) : (
        <ul className="home-unfinished-list">
          {yesterdayOpen.map((s) => renderRow(s, yKey, null))}
        </ul>
      )}
      {allOpen.length > 0 && (
        <>
          <button
            type="button"
            className="home-link-btn"
            onClick={() => setShowAll((p) => !p)}
          >
            {showAll ? "Hide" : `View all open intents (${allOpen.length})`}
          </button>
          {showAll && (
            <ul className="home-unfinished-list home-unfinished-list-older">
              {allOpen.map((s) => renderRow(s, s.dayDate, s.dayDate))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* This week recap ── extracted to components/WeekRecap.jsx so /stats
   Overview can reuse the same chart for its 14-day view. The component
   is the same; /home passes placement="rail", icon=RAIL_ICONS.hours,
   and href="/stats?tab=time" at the call site below. */

/* ── Loading skeleton ──
   Mimics the real /home layout so the eye lands in the right place when
   content arrives — no layout shift, no "Loading…" text staring at you.
   Skeleton blocks are pale grey rectangles with a gentle pulse. They use
   approximate sizing/spacing of the real elements (snapshot cells, Top 3
   rows, rail cards). Aim is "you can tell what's coming" without being a
   pixel-perfect copy of the loaded state. */
function Skel({ w, h, style, className = "" }) {
  return (
    <div
      className={`skel ${className}`.trim()}
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
        ...style,
      }}
    />
  );
}

function HomeSkeleton() {
  return (
    <main className="home-page" aria-busy="true" aria-label="Loading dashboard">
      <header className="home-header">
        <Skel w={120} h={36} style={{ marginBottom: 12 }} />
        <div className="home-header-chips">
          <Skel w={70} h={14} />
          <Skel w={55} h={14} />
          <Skel w={120} h={14} />
        </div>
      </header>

      <div className="home-layout">
        <div className="home-main">
          {/* Snapshot strip — 4-cell grid skeleton */}
          <section className="home-today-snapshot home-today-snapshot--skel">
            <div className="home-today-grid">
              {[0, 1, 2, 3].map((i) => (
                <div className="home-today-cell home-today-cell--skel" key={i}>
                  <Skel w="60%" h={32} />
                  <Skel w="40%" h={11} style={{ marginTop: 6 }} />
                  <Skel w="65%" h={11} style={{ marginTop: 6 }} />
                </div>
              ))}
            </div>
          </section>

          {/* Top 3 section skeleton */}
          <section className="home-section">
            <Skel w={90} h={12} style={{ marginBottom: 24 }} />
            <ul className="home-top3-list">
              {[0, 1, 2].map((i) => (
                <li className="home-top3-slot home-top3-slot--skel" key={i}>
                  <Skel w={14} h={14} />
                  <Skel w={18} h={18} />
                  <Skel w="65%" h={17} />
                </li>
              ))}
            </ul>
          </section>

          {/* Unfinished section skeleton */}
          <section className="home-section">
            <Skel w={160} h={12} style={{ marginBottom: 16 }} />
            <Skel w="80%" h={14} />
          </section>

          {/* Week recap skeleton */}
          <section className="home-section">
            <Skel w={100} h={12} style={{ marginBottom: 24 }} />
            <div className="home-week-bars" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div className="home-week-col" key={i}>
                  <div className="home-week-bar-wrap">
                    <Skel
                      w="100%"
                      h={`${20 + ((i * 17) % 60)}%`}
                      style={{ alignSelf: "flex-end" }}
                    />
                  </div>
                  <Skel w={10} h={11} style={{ marginTop: 6 }} />
                  <Skel w={28} h={11} style={{ marginTop: 4 }} />
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="home-rail">
          {[0, 1, 2, 3, 4].map((i) => (
            <section className="home-rail-card" key={i}>
              <Skel w={90} h={12} style={{ marginBottom: 14 }} />
              <Skel w="55%" h={28} />
              <Skel w="35%" h={12} style={{ marginTop: 8 }} />
            </section>
          ))}
        </aside>
      </div>
    </main>
  );
}

/* ── Page ── */
export default function HomePage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);
  const [loadedAtMs, setLoadedAtMs] = useState(Date.now());
  const pristineRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent().then((c) => {
      if (!mounted) return;
      pristineRef.current = c;
      setContent(c);
      setLoadedAtMs(Date.now());
      setLoaded(true);
    });
    return () => {
      mounted = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Lazy rollover: if dailyTop3.date is older than today (post-midnight
  // load), push the old day into history and reset dailyTop3 to today.
  // Without this, the carry-from-yesterday UX writes today's text into a
  // dailyTop3 still stamped with yesterday's date — and sync-top3 then
  // wipes it on its next run via the date-mismatch wholesale replace.
  // Runs once after load when condition is true; the patchContent inside
  // updates dailyTop3.date so the condition stops firing.
  useEffect(() => {
    if (!loaded) return;
    const today = todayKey();
    const currentDate = content.dailyTop3?.date;
    if (!currentDate || currentDate === today) return;

    const slotsHaveContent = (content.dailyTop3.slots || []).some(
      (s) => (s.text || "").trim(),
    );
    const alreadyInHistory = (content.dailyTop3History || []).some(
      (h) => h.date === currentDate,
    );
    const newHistory = slotsHaveContent && !alreadyInHistory
      ? [
          ...(content.dailyTop3History || []),
          {
            date: currentDate,
            slots: content.dailyTop3.slots,
            updatedAt: content.dailyTop3.updatedAt,
          },
        ]
      : content.dailyTop3History;

    const nowIso = new Date().toISOString();
    const freshSlots = Array.from({ length: 3 }, () => ({
      text: "",
      done: false,
      updatedAt: nowIso,
      completedAt: null,
      dropped: false,
      droppedAt: null,
      carriedToDate: null,
      promoted: false,
      promotedTaskId: null,
    }));

    patchContent({
      dailyTop3: { date: today, slots: freshSlots, updatedAt: nowIso },
      dailyTop3History: newHistory,
    });
  }, [loaded, content.dailyTop3?.date]);

  // Save: merge incoming patch into pristineRef base, normalize, persist
  // (debounced) and update local state. The pristine merge ensures we don't
  // wipe fields HomePage doesn't track (workSessions, todaysTasks, etc.).
  function patchContent(patch) {
    const next = normalizeContentRecord({
      ...(pristineRef.current || {}),
      ...content,
      ...patch,
    });
    pristineRef.current = next;
    setContent(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistContent(next), 400);
  }

  function updateSlot(idx, partial) {
    const nowIso = new Date().toISOString();
    const today = todayKey();
    const slot = content.dailyTop3.slots[idx];
    let newSlot = { ...slot, ...partial, updatedAt: nowIso };

    // ── Auto-promote each Top 3 slot to a real task ──
    // The first edit that gives a slot text creates a task with #top-3
    // tag, lands it in todaysTasks, and stores the task id on the slot.
    // Subsequent edits sync slot.text/done to the linked task so vault
    // sync + history rollup + timer + focus mode all work transparently.
    //
    // If the slot is cleared (text → ""), we un-link from the task but
    // DO NOT delete it — user might have time logged or want to find it
    // in /todo. They can delete from there if they really want it gone.
    let nextTasks = content.todaysTasks || [];
    let nextHistory = content.taskHistory || [];

    const cleared = partial.text !== undefined && partial.text.trim() === "";
    if (cleared && newSlot.promotedTaskId) {
      newSlot.promotedTaskId = null;
    } else if (newSlot.text && newSlot.text.trim() && !newSlot.promotedTaskId) {
      // First time this slot has text — create the backing task.
      const defaultProjectId =
        (content.projects && content.projects[0] && content.projects[0].id) || "";
      const newTask = createDefaultTask({
        id: newId("task"),
        text: newSlot.text.trim(),
        projectId: defaultProjectId,
        done: !!newSlot.done,
        inTodayQueue: true,
        tags: ["top-3", `from-${today}`],
        completedAt: newSlot.done ? nowIso : null,
      });
      newSlot.promotedTaskId = newTask.id;
      nextTasks = [...nextTasks, newTask];
      // If created already-done (rare), archive immediately.
      if (newSlot.done) {
        nextHistory = [createHistoryEntry(newTask, nowIso, today), ...nextHistory]
          .slice(0, MAX_TASK_HISTORY_ITEMS);
      }
    } else if (newSlot.promotedTaskId) {
      // Slot already linked — sync text + done to the task.
      // We capture the post-update task so we can archive it if needed.
      let updatedTask = null;
      nextTasks = nextTasks.map((t) => {
        if (t.id !== newSlot.promotedTaskId) return t;
        const next = { ...t };
        if (partial.text !== undefined) next.text = newSlot.text.trim();
        if (partial.done !== undefined) {
          next.done = !!newSlot.done;
          if (next.done && !t.completedAt) next.completedAt = nowIso;
          if (!next.done) {
            if (t.completedAt) next.completedAt = null;
            // CRITICAL: also demote timer.status. normalizeTaskRecord
            // re-derives `done = doneFromData || timer.status === "completed"`,
            // so leaving timer.status = "completed" silently re-marks the
            // task done on the next save → the slot reconcile useEffect
            // then re-checks the slot, making "uncheck" appear broken.
            if (t.timer?.status === "completed") {
              next.timer = { ...t.timer, status: "stopped" };
            }
          }
        }
        updatedTask = next;
        return next;
      });

      // Archive on the done transition. Was the bug behind "Top 3
      // completions don't show up in History." Mirrors how
      // handleTaskCheckbox in App.jsx does it: push a history entry on
      // the false→true transition; remove the latest entry on true→false
      // so the history stays consistent with the task state.
      if (partial.done === true && updatedTask && updatedTask.done) {
        // Only archive if this is a transition (task wasn't already done).
        const wasAlreadyDone = (content.todaysTasks || []).some(
          (t) => t.id === newSlot.promotedTaskId && t.done
        );
        if (!wasAlreadyDone) {
          nextHistory = [createHistoryEntry(updatedTask, nowIso, today), ...nextHistory]
            .slice(0, MAX_TASK_HISTORY_ITEMS);
        }
      } else if (partial.done === false && updatedTask) {
        nextHistory = removeLatestHistoryEntry(nextHistory, updatedTask.id);
      }
    }

    const slots = content.dailyTop3.slots.map((s, i) => (i === idx ? newSlot : s));
    patchContent({
      dailyTop3: { ...content.dailyTop3, date: today, slots, updatedAt: nowIso },
      todaysTasks: nextTasks,
      taskHistory: nextHistory,
    });
  }

  // ── Lazy backfill + reconcile of slot ↔ task linkage ──
  //
  // BACKFILL: slots that existed before the auto-task feature shipped
  // have text but no promotedTaskId. Create the backing task once so
  // Focus + Timer + history rollup just start working.
  //
  // RECONCILE: if the task got marked done in /todo (or its timer
  // rolled it into history), the slot.done should reflect that on the
  // next /home load. Same for text edits made directly on the task.
  //
  // Runs after every content load; patchContent inside re-renders, but
  // the second pass sees no work to do and exits early. Stable.
  useEffect(() => {
    if (!loaded) return;
    const slots = content.dailyTop3?.slots || [];
    const tasksById = new Map((content.todaysTasks || []).map((t) => [t.id, t]));
    const today = todayKey();
    const defaultProjectId =
      (content.projects && content.projects[0] && content.projects[0].id) || "";

    let drift = false;
    let nextTasks = content.todaysTasks || [];
    const nextSlots = slots.map((s) => {
      const slotText = (s.text || "").trim();

      // BACKFILL: filled slot with no linked task → create one
      if (slotText && !s.promotedTaskId) {
        const newTask = createDefaultTask({
          id: newId("task"),
          text: slotText,
          projectId: defaultProjectId,
          done: !!s.done,
          inTodayQueue: true,
          tags: ["top-3", `from-${today}`],
          completedAt: s.done ? new Date().toISOString() : null,
        });
        drift = true;
        nextTasks = [...nextTasks, newTask];
        return {
          ...s,
          promotedTaskId: newTask.id,
          updatedAt: new Date().toISOString(),
        };
      }

      // RECONCILE: slot is linked; if task drifted from slot, pull task state in.
      if (s.promotedTaskId) {
        const t = tasksById.get(s.promotedTaskId);
        if (!t) return s; // task missing (deleted) — leave slot alone
        const taskDone = !!t.done;
        const slotDone = !!s.done;
        if (taskDone === slotDone && (t.text || "").trim() === slotText) return s;
        drift = true;
        return {
          ...s,
          done: taskDone,
          text: (t.text || "").trim() || s.text,
          completedAt: taskDone ? (t.completedAt || s.completedAt) : null,
          updatedAt: new Date().toISOString(),
        };
      }

      return s;
    });

    if (drift) {
      patchContent({
        dailyTop3: { ...content.dailyTop3, slots: nextSlots, updatedAt: new Date().toISOString() },
        todaysTasks: nextTasks,
      });
    }
  }, [loaded, content.todaysTasks]);

  function updateHistorySlot(dayDate, slotIdx, partial) {
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx ? { ...s, ...partial, updatedAt: new Date().toISOString() } : s
            ),
          }
        : h
    );
    patchContent({ dailyTop3History: history });
  }

  function handleCarry(dayDate, slotIdx) {
    const entry = content.dailyTop3History.find((h) => h.date === dayDate);
    if (!entry) return;
    const fromSlot = entry.slots[slotIdx];
    if (!fromSlot || !fromSlot.text) return;
    const emptyIdx = content.dailyTop3.slots.findIndex((s) => !s.text);
    if (emptyIdx === -1) return;
    const nowIso = new Date().toISOString();
    const todayKeyStr = todayKey();
    // 1) fill today's empty slot
    const slots = content.dailyTop3.slots.map((s, i) =>
      i === emptyIdx
        ? { ...s, text: fromSlot.text, updatedAt: nowIso }
        : s
    );
    // 2) mark history slot as carried to today
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx
                ? { ...s, carriedToDate: todayKeyStr, updatedAt: nowIso }
                : s
            ),
          }
        : h
    );
    patchContent({
      dailyTop3: { ...content.dailyTop3, date: todayKeyStr, slots, updatedAt: nowIso },
      dailyTop3History: history,
    });
  }

  function handleDone(dayDate, slotIdx) {
    updateHistorySlot(dayDate, slotIdx, {
      done: true,
      completedAt: new Date().toISOString(),
    });
  }

  function handleDrop(dayDate, slotIdx) {
    updateHistorySlot(dayDate, slotIdx, {
      dropped: true,
      droppedAt: new Date().toISOString(),
    });
  }

  function handlePromote(dayDate, slotIdx) {
    const entry = content.dailyTop3History.find((h) => h.date === dayDate);
    if (!entry) return;
    const slot = entry.slots[slotIdx];
    if (!slot || !slot.text) return;
    // Create a new task in todaysTasks tagged carried-from-top3
    const defaultProjectId =
      (content.projects && content.projects[0] && content.projects[0].id) || "";
    const newTask = createDefaultTask({
      id: newId("task"),
      text: slot.text,
      projectId: defaultProjectId,
      done: false,
      inTodayQueue: true,
      tags: [TOP3_TAG, `from-${dayDate}`],
    });
    const todaysTasks = [...(content.todaysTasks || []), newTask];
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx
                ? {
                    ...s,
                    promoted: true,
                    promotedTaskId: newTask.id,
                    updatedAt: new Date().toISOString(),
                  }
                : s
            ),
          }
        : h
    );
    patchContent({ todaysTasks, dailyTop3History: history });
  }

  // Hook order: this MUST run on every render (Rules of Hooks). The default
  // content from DEFAULT_CONTENT has scheduledTaskHeartbeats normalized, so
  // the call is safe before the loaded-guard below.
  const heartbeatRows = useHeartbeatRows(content.scheduledTaskHeartbeats);
  const todayStats = useTodayStats(content);

  // Today's Claude sessions grouped by project — drill-down view of
  // today's actual work, same component /stats Today + /history use.
  // Filter window: today's local midnight → tomorrow's local midnight.
  const todayClaudeBuckets = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return buildClaudeBuckets(
      content?.workSessions || [],
      content?.projects || [],
      { since: startMs, until: startMs + MS_PER_DAY }
    );
  }, [content?.workSessions, content?.projects]);

  if (!loaded) {
    return <HomeSkeleton />;
  }

  return (
    <main className="home-page home-page--loaded">
      {/* Banner sits full-width above the grid — only renders on failure. */}
      <ScheduleBanner rows={heartbeatRows} />

      <HomeHeader stats={todayStats} />

      <div className="home-layout">
        <div className="home-main">
          <TodaySnapshot stats={todayStats} />

          <Top3Editor
            dailyTop3={content.dailyTop3}
            tasks={content.todaysTasks}
            onSlotChange={updateSlot}
          />

          <UnfinishedSection
            history={content.dailyTop3History}
            todaysSlots={content.dailyTop3.slots}
            onCarry={handleCarry}
            onDone={handleDone}
            onPromote={handlePromote}
            onDrop={handleDrop}
          />

          {/* Today's Claude sessions grouped by project, with collapsible
              drill-down for per-session AI summaries + completions.
              Same component /stats Today + /history use — keeps the
              "what did I actually do today" view consistent app-wide. */}
          {todayClaudeBuckets.length > 0 && (
            <section className="home-section">
              <h2 className="home-section-title home-section-title-row">
                <span>Today's work</span>
                <span className="home-section-meta">
                  <strong>{todayClaudeBuckets.length}</strong>{" "}
                  {todayClaudeBuckets.length === 1 ? "project" : "projects"}
                </span>
              </h2>
              <div className="home-today-claude-buckets">
                {todayClaudeBuckets.map((bucket) => (
                  <ClaudeProjectBucket key={bucket.projectId} bucket={bucket} />
                ))}
              </div>
            </section>
          )}

          {/* "Today's focus" data lives in the main column now —
              project mix and hour ribbon are about today, so they
              belong here next to Top 3 / Unfinished, not in the rail. */}
          <ProjectMixCard
            mix={todayStats.projectMix}
            totalMs={todayStats.focusedMs}
            placement="main"
          />
          <HourRibbonCard
            byHour={todayStats.byHour}
            byHourSegments={todayStats.byHourSegments}
            placement="main"
          />
        </div>

        <aside className="home-rail">
          <ChatsCard />
          <RightNowCard rightNow={todayStats.rightNow} />
          <CountdownCard content={content} />
          {/* Week recap moves to the rail — longer-horizon context, not
              today-specific, so it sits with deadline + peak-hour. */}
          <WeekRecap
            weekDays={todayStats.weekDays}
            weekTotalMs={todayStats.weekTotalMs}
            weekActiveDays={todayStats.weekActiveDays}
            weekLegend={todayStats.weekLegend}
            title="This week"
            href="/stats?tab=overview"
            icon={RAIL_ICONS.hours}
            placement="rail"
          />
          <PeakHourCard workSessions={content.workSessions} />
          <UpNextCard tasks={content.todaysTasks} />
          <ScheduleHealthCard rows={heartbeatRows} />
        </aside>
      </div>

      <SnapshotPill loadedAtMs={loadedAtMs} />
    </main>
  );
}
