import { useEffect, useMemo, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
} from "../utils/taskUtils.js";

/* Stats page — pure read view of pomodoro.history + taskHistory + current
   todaysTasks. All aggregation happens client-side in computeStats; charts are
   CSS divs (no chart library dependency). */

const MS_PER_MIN = 60 * 1000;
const MS_PER_HR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HR;

function ymd(d) {
  const tz = d.getTimezoneOffset() * MS_PER_MIN;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function fmtDuration(ms) {
  if (!ms || ms < MS_PER_MIN) return "0m";
  const h = Math.floor(ms / MS_PER_HR);
  const m = Math.round((ms % MS_PER_HR) / MS_PER_MIN);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function todayStartMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rangeStartMs(days) {
  return todayStartMs() - (days - 1) * MS_PER_DAY;
}

function computeStats(content) {
  const pomoHistory = content.pomodoro?.history || [];
  const taskHistory = content.taskHistory || [];
  const tasks = content.todaysTasks || [];
  const projects = content.projects || [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const focusEntries = pomoHistory.filter((e) => e.type === "focus");

  const todayStart = todayStartMs();
  const weekStart = rangeStartMs(7);

  const rangeFocus = (startMs) => {
    let pomos = 0;
    let ms = 0;
    for (const e of focusEntries) {
      const t = Date.parse(e.startedAt);
      if (Number.isFinite(t) && t >= startMs) {
        pomos += 1;
        ms += e.durationMs || 0;
      }
    }
    return { focusPomos: pomos, focusMs: ms };
  };

  const today = rangeFocus(todayStart);
  const week = rangeFocus(weekStart);
  const all = rangeFocus(0);

  // Daily focus minutes for the last 14 days (oldest → newest)
  const dailyFocus = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = ymd(d);
    let ms = 0;
    for (const e of focusEntries) {
      if (ymd(new Date(e.startedAt)) === key) ms += e.durationMs || 0;
    }
    dailyFocus.push({
      day: key,
      value: ms,
      label: String(d.getDate()),
      isToday: i === 0,
    });
  }

  // Streak: consecutive days with ≥1 focus pomo. If today has none, start from
  // yesterday — the streak is still "alive" until a full day passes empty.
  const focusDays = new Set(focusEntries.map((e) => ymd(new Date(e.startedAt))));
  let currentStreak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!focusDays.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (focusDays.has(ymd(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  // Longest streak: scan unique sorted days for the longest consecutive run.
  let longestStreak = 0;
  const sorted = [...focusDays].sort();
  let runStart = null;
  let prev = null;
  const oneDay = MS_PER_DAY;
  for (const day of sorted) {
    if (prev) {
      const expected = new Date(Date.parse(prev) + oneDay);
      if (ymd(expected) !== day) {
        const run = Math.round((Date.parse(prev) - Date.parse(runStart)) / oneDay) + 1;
        longestStreak = Math.max(longestStreak, run);
        runStart = day;
      }
    } else {
      runStart = day;
    }
    prev = day;
  }
  if (runStart && prev) {
    const run = Math.round((Date.parse(prev) - Date.parse(runStart)) / oneDay) + 1;
    longestStreak = Math.max(longestStreak, run);
  }

  // Map taskId → projectId from current tasks + history so old pomos still tag.
  const taskProjectMap = new Map();
  for (const t of tasks) taskProjectMap.set(t.id, t.projectId);
  for (const h of taskHistory) taskProjectMap.set(h.sourceTaskId, h.projectId);
  const focusByProject = new Map();
  for (const e of focusEntries) {
    const pid = taskProjectMap.get(e.taskId);
    if (!pid) continue;
    focusByProject.set(pid, (focusByProject.get(pid) || 0) + (e.durationMs || 0));
  }
  const focusByProjectRows = [...focusByProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pid, ms]) => ({ label: projectName.get(pid) || "Unknown", value: ms }));

  // Current tasks broken down by project (open / done) and by tag (open only).
  const tasksByProjectMap = new Map();
  for (const t of tasks) {
    const pid = t.projectId;
    if (!tasksByProjectMap.has(pid)) tasksByProjectMap.set(pid, { open: 0, done: 0 });
    const slot = tasksByProjectMap.get(pid);
    if (t.done) slot.done += 1;
    else slot.open += 1;
  }
  const tasksByProject = [...tasksByProjectMap.entries()]
    .map(([pid, x]) => ({
      label: projectName.get(pid) || "Unknown",
      open: x.open,
      done: x.done,
      total: x.open + x.done,
    }))
    .sort((a, b) => b.total - a.total);

  const tagCount = new Map();
  for (const t of tasks) {
    if (t.done) continue;
    for (const tag of t.tags || []) {
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    }
  }
  const tasksByTag = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => ({ label: `#${tag}`, value: n }));

  const tasksDoneAllTime = taskHistory.length;
  const tasksOpenNow = tasks.filter((t) => !t.done).length;

  return {
    today,
    week,
    all,
    currentStreak,
    longestStreak,
    dailyFocus,
    focusByProject: focusByProjectRows,
    tasksByProject,
    tasksByTag,
    tasksDoneAllTime,
    tasksOpenNow,
  };
}

function StatCard({ label, pomos, ms }) {
  return (
    <div className="stats-card">
      <div className="stats-card-label">{label}</div>
      <div className="stats-card-row">
        <span className="stats-num">{pomos}</span>
        <span className="stats-card-unit">focus pomos</span>
      </div>
      <div className="stats-card-row">
        <span className="stats-num">{fmtDuration(ms)}</span>
        <span className="stats-card-unit">focused</span>
      </div>
    </div>
  );
}

function DailyChart({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="stats-daily">
      {bars.map((b) => (
        <div
          key={b.day}
          className={`stats-daily-col${b.isToday ? " is-today" : ""}`}
          title={`${b.day}: ${fmtDuration(b.value)}`}
        >
          <div
            className="stats-daily-bar"
            style={{ height: `${(b.value / max) * 100}%` }}
          />
          <div className="stats-daily-label">{b.label}</div>
        </div>
      ))}
    </div>
  );
}

function BreakdownBars({ rows, formatRight, emptyMsg }) {
  if (!rows.length) return <p className="stats-empty">{emptyMsg}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => (
        <div key={r.label} className="stats-breakdown-row">
          <span className="stats-breakdown-label" title={r.label}>{r.label}</span>
          <div className="stats-breakdown-bar-wrap">
            <div
              className="stats-breakdown-bar"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="stats-breakdown-value">{formatRight(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectSplit({ rows }) {
  if (!rows.length) return <p className="stats-empty">No tasks yet</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => (
        <div key={r.label} className="stats-breakdown-row">
          <span className="stats-breakdown-label" title={r.label}>{r.label}</span>
          <div className="stats-breakdown-bar-wrap stats-split-bar-wrap">
            {r.open > 0 && (
              <div
                className="stats-split-open"
                style={{ width: `${(r.open / max) * 100}%` }}
                title={`${r.open} open`}
              />
            )}
            {r.done > 0 && (
              <div
                className="stats-split-done"
                style={{ width: `${(r.done / max) * 100}%` }}
                title={`${r.done} done`}
              />
            )}
          </div>
          <span className="stats-breakdown-value">
            {r.open}<span className="stats-breakdown-mute"> / </span>{r.done}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function StatsPage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent().then((c) => {
      if (mounted) {
        setContent(c);
        setLoaded(true);
      }
    });
    return () => { mounted = false; };
  }, []);

  const stats = useMemo(() => computeStats(content), [content]);

  if (!loaded) {
    return (
      <main className="stats-page">
        <p className="stats-empty">Loading…</p>
      </main>
    );
  }

  return (
    <main className="stats-page">
      <h1 className="stats-title">Stats</h1>

      <section className="stats-cards">
        <StatCard label="Today" pomos={stats.today.focusPomos} ms={stats.today.focusMs} />
        <StatCard label="This week" pomos={stats.week.focusPomos} ms={stats.week.focusMs} />
        <StatCard label="All-time" pomos={stats.all.focusPomos} ms={stats.all.focusMs} />
      </section>

      <section className="stats-section">
        <h2>Focus streak</h2>
        <div className="stats-streak">
          <div>
            <span className="stats-num">{stats.currentStreak}</span>
            <span className="stats-card-unit"> day{stats.currentStreak === 1 ? "" : "s"} current</span>
          </div>
          <div>
            <span className="stats-num">{stats.longestStreak}</span>
            <span className="stats-card-unit"> day{stats.longestStreak === 1 ? "" : "s"} longest</span>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <h2>Focus minutes — last 14 days</h2>
        <DailyChart bars={stats.dailyFocus} />
      </section>

      <section className="stats-section">
        <h2>Focus minutes by project — all time</h2>
        <BreakdownBars
          rows={stats.focusByProject}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No focus sessions yet — start a pomodoro on a task to populate this."
        />
      </section>

      <section className="stats-section">
        <h2>Tasks by project — current</h2>
        <ProjectSplit rows={stats.tasksByProject} />
        <p className="stats-footnote">
          Open <span className="stats-swatch stats-swatch-open" /> / Done <span className="stats-swatch stats-swatch-done" />
        </p>
      </section>

      <section className="stats-section">
        <h2>Open tasks by tag — top 12</h2>
        <BreakdownBars
          rows={stats.tasksByTag.slice(0, 12)}
          formatRight={(v) => v}
          emptyMsg="No tags on open tasks yet."
        />
      </section>

      <section className="stats-footer">
        <p className="stats-footnote">
          {stats.tasksOpenNow} open · {stats.tasksDoneAllTime} completed in app history. Note: tasks
          marked done in Obsidian (synced via /sync-todos) don't currently create a history entry,
          so the "completed" count is an under-count of total productivity.
        </p>
      </section>
    </main>
  );
}
