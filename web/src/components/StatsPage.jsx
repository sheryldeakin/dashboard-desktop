import { useEffect, useMemo, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
} from "../utils/taskUtils.js";

/* Stats page — pure read view across pomodoro.history + taskHistory +
   todaysTasks + workSessions. Four tabs (Overview / Focus / Claude / Tasks).
   "Total deep work" = task_timer time + Claude time that didn't overlap any
   task_timer interval. No double-counting (Option 1 from the brainstorm). */

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

function extractTaskTimerIntervals(tasks) {
  const out = [];
  for (const t of tasks || []) {
    const sessions = t.timer?.sessions || [];
    for (const s of sessions) {
      if (s.type !== "work") continue;
      const start = Date.parse(s.start);
      const end = Date.parse(s.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      out.push({
        start,
        end,
        durationMs: end - start,
        projectId: t.projectId,
        taskId: t.id,
        tags: t.tags || [],
      });
    }
  }
  return out;
}

function extractClaudeIntervals(workSessions) {
  const out = [];
  for (const ws of workSessions || []) {
    if (ws.source !== "claude_code") continue;
    const start = Date.parse(ws.startedAt);
    const end = Date.parse(ws.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    out.push({
      start,
      end,
      durationMs: ws.activeMs || Math.max(0, end - start),
      projectId: ws.projectId,
      tags: ws.tags || [],
      messageCount: ws.messageCount || 0,
      id: ws.id,
      transcriptId: ws.transcriptId,
      cwd: ws.cwd,
    });
  }
  return out;
}

function intervalIntersectionMs(a, intervals) {
  let total = 0;
  for (const b of intervals) {
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end > start) total += end - start;
  }
  return total;
}

function computeStats(content) {
  const tasks = content.todaysTasks || [];
  const projects = content.projects || [];
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const taskTimer = extractTaskTimerIntervals(tasks);
  const claude = extractClaudeIntervals(content.workSessions);
  const focusPomos = (content.pomodoro?.history || []).filter((e) => e.type === "focus");

  // Index task_timer intervals by day so overlap math is O(claude × tasks_in_day),
  // not O(claude × all_tasks_ever).
  const taskByDay = new Map();
  for (const t of taskTimer) {
    const key = ymd(new Date(t.start));
    if (!taskByDay.has(key)) taskByDay.set(key, []);
    taskByDay.get(key).push(t);
  }

  // Per-Claude-session: how much fell inside any task_timer interval (absorbed)
  // vs how much sat outside (the bit that adds to total deep work).
  for (const c of claude) {
    const day = ymd(new Date(c.start));
    const sameDayTasks = taskByDay.get(day) || [];
    c.absorbedMs = intervalIntersectionMs(c, sameDayTasks);
    c.outsideMs = Math.max(0, c.durationMs - c.absorbedMs);
  }

  const todayStart = todayStartMs();
  const weekStart = rangeStartMs(7);

  function rangeFor(startMs) {
    let task_ms = 0;
    let claude_total_ms = 0;
    let claude_outside_ms = 0;
    let claude_sessions = 0;
    let claude_msgs = 0;
    for (const t of taskTimer) if (t.start >= startMs) task_ms += t.durationMs;
    for (const c of claude) {
      if (c.start >= startMs) {
        claude_total_ms += c.durationMs;
        claude_outside_ms += c.outsideMs;
        claude_sessions += 1;
        claude_msgs += c.messageCount;
      }
    }
    return {
      task_ms,
      claude_total_ms,
      claude_outside_ms,
      deep_work_ms: task_ms + claude_outside_ms,
      claude_sessions,
      claude_msgs,
    };
  }

  function pomosSince(startMs) {
    return focusPomos.filter((e) => {
      const t = Date.parse(e.startedAt);
      return Number.isFinite(t) && t >= startMs;
    }).length;
  }

  const today = { ...rangeFor(todayStart), pomos: pomosSince(todayStart) };
  const week = { ...rangeFor(weekStart), pomos: pomosSince(weekStart) };
  const all = { ...rangeFor(0), pomos: focusPomos.length };

  // Daily two-tone (last 14 days): bottom = task_timer ms, top = claude_outside ms.
  const dailyDeep = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dStart = d.getTime();
    const dEnd = dStart + MS_PER_DAY;
    let dayTask = 0;
    let dayClaudeOutside = 0;
    for (const t of taskTimer) if (t.start >= dStart && t.start < dEnd) dayTask += t.durationMs;
    for (const c of claude) if (c.start >= dStart && c.start < dEnd) dayClaudeOutside += c.outsideMs;
    dailyDeep.push({
      day: ymd(d),
      label: String(d.getDate()),
      taskMs: dayTask,
      claudeOutsideMs: dayClaudeOutside,
      totalMs: dayTask + dayClaudeOutside,
      isToday: i === 0,
    });
  }

  // Focus pomo streak (consecutive days with ≥1 focus pomo)
  const focusDays = new Set();
  for (const e of focusPomos) {
    const t = Date.parse(e.startedAt);
    if (Number.isFinite(t)) focusDays.add(ymd(new Date(t)));
  }
  let currentStreak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!focusDays.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (focusDays.has(ymd(cursor))) {
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Claude by project: all-time totals
  const claudeByProjectMap = new Map();
  for (const c of claude) {
    if (!claudeByProjectMap.has(c.projectId))
      claudeByProjectMap.set(c.projectId, { ms: 0, sessions: 0, messages: 0 });
    const slot = claudeByProjectMap.get(c.projectId);
    slot.ms += c.durationMs;
    slot.sessions += 1;
    slot.messages += c.messageCount;
  }
  const claudeByProject = [...claudeByProjectMap.entries()]
    .map(([pid, x]) => ({
      label: projectName.get(pid) || "Unknown",
      ms: x.ms,
      sessions: x.sessions,
      avgMsgs: x.sessions ? Math.round(x.messages / x.sessions) : 0,
      avgMin: x.sessions ? Math.round(x.ms / MS_PER_MIN / x.sessions) : 0,
    }))
    .sort((a, b) => b.ms - a.ms);

  // Claude by tag (top 15)
  const tagMs = new Map();
  for (const c of claude) {
    for (const tag of c.tags) tagMs.set(tag, (tagMs.get(tag) || 0) + c.durationMs);
  }
  const claudeByTag = [...tagMs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, ms]) => ({ label: `#${tag}`, value: ms }));

  // Task-timer focus by project (so Focus tab can also break down by project)
  const focusByProjectMap = new Map();
  for (const t of taskTimer) {
    focusByProjectMap.set(t.projectId, (focusByProjectMap.get(t.projectId) || 0) + t.durationMs);
  }
  const focusByProject = [...focusByProjectMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pid, ms]) => ({ label: projectName.get(pid) || "Unknown", value: ms }));

  // Per-project "% Claude-assisted" — of total task_timer ms for project P,
  // what fraction overlapped with any Claude session in project P?
  const projectAssist = new Map();
  for (const t of taskTimer) {
    const pid = t.projectId;
    const projectClaude = claude.filter((c) => c.projectId === pid);
    const overlap = intervalIntersectionMs(t, projectClaude);
    if (!projectAssist.has(pid)) projectAssist.set(pid, { totalMs: 0, assistedMs: 0 });
    const slot = projectAssist.get(pid);
    slot.totalMs += t.durationMs;
    slot.assistedMs += overlap;
  }

  // Tasks by project + per-tag (current state)
  const tasksByProjectMap = new Map();
  for (const t of tasks) {
    if (!tasksByProjectMap.has(t.projectId))
      tasksByProjectMap.set(t.projectId, { open: 0, done: 0 });
    const slot = tasksByProjectMap.get(t.projectId);
    if (t.done) slot.done += 1;
    else slot.open += 1;
  }
  const tasksByProject = [...tasksByProjectMap.entries()]
    .map(([pid, x]) => {
      const assist = projectAssist.get(pid);
      return {
        label: projectName.get(pid) || "Unknown",
        open: x.open,
        done: x.done,
        total: x.open + x.done,
        assistPct:
          assist && assist.totalMs > 0
            ? Math.round((assist.assistedMs / assist.totalMs) * 100)
            : null,
        focusMs: assist ? assist.totalMs : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const tasksTagMap = new Map();
  for (const t of tasks) {
    if (t.done) continue;
    for (const tag of t.tags || []) tasksTagMap.set(tag, (tasksTagMap.get(tag) || 0) + 1);
  }
  const tasksByTag = [...tasksTagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, n]) => ({ label: `#${tag}`, value: n }));

  // Recent Claude sessions (top 20 by recency)
  const recentClaude = [...claude]
    .sort((a, b) => b.start - a.start)
    .slice(0, 20)
    .map((c) => ({
      ...c,
      projectName: projectName.get(c.projectId) || "Unknown",
      startStr: new Date(c.start).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));

  // Per-project rollup for the grid-card view on Overview. One row per project
  // that has any activity (task_timer OR claude). combinedMs uses the no-double-
  // count formula (task absorbing concurrent claude + claude-outside).
  const cardMap = new Map();
  function slot(pid) {
    if (!cardMap.has(pid)) {
      cardMap.set(pid, {
        projectId: pid,
        taskMs: 0, claudeMs: 0, absorbedMs: 0, claudeOutsideMs: 0,
        taskSessions: 0, claudeSessions: 0,
        lastActivityMs: 0, lastActivitySource: null,
      });
    }
    return cardMap.get(pid);
  }
  for (const t of taskTimer) {
    const s = slot(t.projectId);
    s.taskMs += t.durationMs;
    s.taskSessions += 1;
    if (t.end > s.lastActivityMs) { s.lastActivityMs = t.end; s.lastActivitySource = "task"; }
  }
  for (const c of claude) {
    const s = slot(c.projectId);
    s.claudeMs += c.durationMs;
    s.absorbedMs += c.absorbedMs;
    s.claudeOutsideMs += c.outsideMs;
    s.claudeSessions += 1;
    if (c.end > s.lastActivityMs) { s.lastActivityMs = c.end; s.lastActivitySource = "claude"; }
  }
  const projectCards = [...cardMap.values()]
    .map((s) => ({
      ...s,
      projectName: projectName.get(s.projectId) || "Unknown",
      combinedMs: s.taskMs + s.claudeOutsideMs,
      assistPct: s.taskMs > 0 ? Math.round((s.absorbedMs / s.taskMs) * 100) : null,
    }))
    .filter((s) => s.combinedMs > 0 || s.claudeMs > 0)
    .sort((a, b) => b.combinedMs + b.claudeMs - (a.combinedMs + a.claudeMs));

  return {
    today, week, all,
    currentStreak,
    dailyDeep,
    claudeByProject,
    claudeByTag,
    focusByProject,
    tasksByProject,
    tasksByTag,
    recentClaude,
    taskHistoryCount: (content.taskHistory || []).length,
    tasksOpen: tasks.filter((t) => !t.done).length,
    // Raw intervals + project list — passed to HeatmapGrid so it can re-bucket
    // based on its own filter/period state without re-running computeStats.
    taskTimer,
    claude,
    projects: [...projectName.entries()].map(([id, name]) => ({ id, name })),
    projectCards,
  };
}

/* ── Reusable bits ── */

function Card({ label, children }) {
  return (
    <div className="stats-card">
      <div className="stats-card-label">{label}</div>
      {children}
    </div>
  );
}

function CardRow({ value, unit }) {
  return (
    <div className="stats-card-row">
      <span className="stats-num">{value}</span>
      <span className="stats-card-unit">{unit}</span>
    </div>
  );
}

function DailyDeepChart({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.totalMs));
  return (
    <div className="stats-daily">
      {bars.map((b) => {
        const taskPct = (b.taskMs / max) * 100;
        const clPct = (b.claudeOutsideMs / max) * 100;
        const tip =
          `${b.day} — ${fmtDuration(b.totalMs)} total\n` +
          `  Task timer: ${fmtDuration(b.taskMs)}\n` +
          `  Claude (outside timer): ${fmtDuration(b.claudeOutsideMs)}`;
        return (
          <div
            key={b.day}
            className={`stats-daily-col${b.isToday ? " is-today" : ""}`}
            title={tip}
          >
            <div className="stats-daily-stack">
              {b.claudeOutsideMs > 0 && (
                <div className="stats-daily-bar stats-daily-bar-claude" style={{ height: `${clPct}%` }} />
              )}
              {b.taskMs > 0 && (
                <div className="stats-daily-bar stats-daily-bar-task" style={{ height: `${taskPct}%` }} />
              )}
            </div>
            <div className="stats-daily-label">{b.label}</div>
          </div>
        );
      })}
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
            <div className="stats-breakdown-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="stats-breakdown-value">{formatRight(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectTaskSplit({ rows }) {
  if (!rows.length) return <p className="stats-empty">No tasks yet</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => (
        <div key={r.label} className="stats-breakdown-row">
          <span className="stats-breakdown-label" title={r.label}>{r.label}</span>
          <div className="stats-breakdown-bar-wrap stats-split-bar-wrap">
            {r.open > 0 && (
              <div className="stats-split-open" style={{ width: `${(r.open / max) * 100}%` }} title={`${r.open} open`} />
            )}
            {r.done > 0 && (
              <div className="stats-split-done" style={{ width: `${(r.done / max) * 100}%` }} title={`${r.done} done`} />
            )}
          </div>
          <span className="stats-breakdown-value">
            {r.open}<span className="stats-breakdown-mute"> / </span>{r.done}
            {r.assistPct !== null && (
              <span className="stats-assist-pct" title="% of this project's focus time that overlapped a Claude session">
                {" · "}{r.assistPct}% AI-assist
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function ClaudeProjectRows({ rows }) {
  if (!rows.length) return <p className="stats-empty">No Claude sessions yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => (
        <div key={r.label} className="stats-breakdown-row stats-breakdown-row-2line">
          <span className="stats-breakdown-label">{r.label}</span>
          <div className="stats-breakdown-bar-wrap">
            <div className="stats-breakdown-bar" style={{ width: `${(r.ms / max) * 100}%` }} />
          </div>
          <span className="stats-breakdown-value">
            {fmtDuration(r.ms)}
            <span className="stats-breakdown-sub">
              {" "}· {r.sessions} ses · avg {r.avgMin}m / {r.avgMsgs} msgs
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function RecentClaudeList({ rows }) {
  if (!rows.length) return <p className="stats-empty">No recent Claude sessions.</p>;
  return (
    <ul className="stats-session-list">
      {rows.map((c) => {
        const sub = c.absorbedMs > 0
          ? `${fmtDuration(c.absorbedMs)} absorbed by task timer`
          : "outside any task timer";
        return (
          <li key={c.id} className="stats-session-row">
            <span className="stats-session-time">{c.startStr}</span>
            <span className="stats-session-proj">{c.projectName}</span>
            <span className="stats-session-tags">
              {c.tags.slice(0, 3).map((t) => `#${t}`).join(" ")}
            </span>
            <span className="stats-session-dur">{fmtDuration(c.durationMs)}</span>
            <span className="stats-session-meta">{c.messageCount} msgs · {sub}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Heatmap (Overview tab) ── */

const HEATMAP_PERIODS = [
  { id: "4w", label: "4 weeks", weeks: 4 },
  { id: "8w", label: "8 weeks", weeks: 8 },
  { id: "12w", label: "12 weeks", weeks: 12 },
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildHeatmapGrid(taskTimer, claude, periodWeeks, projectId) {
  const cutoff = Date.now() - periodWeeks * 7 * MS_PER_DAY;
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ taskMs: 0, claudeOutsideMs: 0 }))
  );

  // Distribute a session's contribution across the hour cells it spans.
  // factor lets us scale (used for Claude's outsideMs which is < durationMs).
  function distribute(startMs, endMs, totalMs, key) {
    if (endMs <= startMs || totalMs <= 0) return;
    const wallMs = endMs - startMs;
    const factor = totalMs / wallMs;
    let cursor = startMs;
    while (cursor < endMs) {
      const d = new Date(cursor);
      const dow = d.getDay();
      const hr = d.getHours();
      const nextBoundary = new Date(
        d.getFullYear(), d.getMonth(), d.getDate(), hr + 1, 0, 0
      ).getTime();
      const segEnd = Math.min(endMs, nextBoundary);
      grid[dow][hr][key] += (segEnd - cursor) * factor;
      cursor = segEnd;
    }
  }

  for (const t of taskTimer) {
    if (t.start < cutoff) continue;
    if (projectId !== "all" && t.projectId !== projectId) continue;
    distribute(t.start, t.end, t.durationMs, "taskMs");
  }
  for (const c of claude) {
    if (c.start < cutoff) continue;
    if (projectId !== "all" && c.projectId !== projectId) continue;
    if (c.outsideMs <= 0) continue;
    distribute(c.start, c.end, c.outsideMs, "claudeOutsideMs");
  }

  let max = 0;
  for (const row of grid) for (const cell of row) {
    const total = cell.taskMs + cell.claudeOutsideMs;
    if (total > max) max = total;
  }
  return { grid, max };
}

function HeatmapGrid({ stats }) {
  const [period, setPeriod] = useState("8w");
  const [projectId, setProjectId] = useState("all");
  const weeks = HEATMAP_PERIODS.find((p) => p.id === period)?.weeks || 8;
  const { grid, max } = useMemo(
    () => buildHeatmapGrid(stats.taskTimer, stats.claude, weeks, projectId),
    [stats.taskTimer, stats.claude, weeks, projectId]
  );
  const projectOptions = useMemo(
    () => [{ id: "all", name: "All projects" }, ...stats.projects],
    [stats.projects]
  );

  return (
    <div className="stats-heatmap">
      <div className="stats-heatmap-controls">
        <select
          className="stats-heatmap-select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="stats-heatmap-period">
          {HEATMAP_PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`stats-heatmap-period-btn${period === p.id ? " is-active" : ""}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {max === 0 ? (
        <p className="stats-empty">No activity in this window.</p>
      ) : (
        <div className="stats-heatmap-table">
          <div className="stats-heatmap-row stats-heatmap-row-hdr">
            <span className="stats-heatmap-dow" />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="stats-heatmap-hour-label">
                {h % 3 === 0 ? h : ""}
              </span>
            ))}
          </div>
          {grid.map((row, dow) => (
            <div key={dow} className="stats-heatmap-row">
              <span className="stats-heatmap-dow">{DOW_LABELS[dow]}</span>
              {row.map((cell, hr) => {
                const total = cell.taskMs + cell.claudeOutsideMs;
                const intensity = total / max;
                const taskShare = total > 0 ? cell.taskMs / total : 0;
                // Two-channel cell: tan (task) on bottom + slate (claude) on top,
                // each weighted by share of total. Total opacity scales with intensity.
                const bg = total === 0
                  ? "rgba(0,0,0,0.04)"
                  : `linear-gradient(180deg, rgba(74,90,112,${0.18 + 0.78 * intensity * (1 - taskShare)}) ${(1 - taskShare) * 100}%, rgba(138,105,64,${0.18 + 0.78 * intensity * taskShare}) ${(1 - taskShare) * 100}%)`;
                const tooltip = total === 0
                  ? `${DOW_LABELS[dow]} ${hr}:00 — no activity`
                  : `${DOW_LABELS[dow]} ${hr}:00 — ${fmtDuration(total)} total
  Task timer: ${fmtDuration(cell.taskMs)}
  Claude outside: ${fmtDuration(cell.claudeOutsideMs)}`;
                return (
                  <span
                    key={hr}
                    className="stats-heatmap-cell"
                    style={{ background: bg }}
                    title={tooltip}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      <p className="stats-footnote">
        Hour-of-day intensity ({weeks} weeks). Each cell:{" "}
        <span className="stats-swatch stats-swatch-task" /> task timer +{" "}
        <span className="stats-swatch stats-swatch-claude" /> Claude outside (stacked, intensity scaled to busiest cell).
        Hover for the breakdown.
      </p>
    </div>
  );
}

/* ── Per-project grid cards (Overview tab) ── */

function ProjectGridCard({ card }) {
  const maxBarMs = Math.max(card.taskMs, card.claudeMs, 1);
  const taskPct = (card.taskMs / maxBarMs) * 100;
  const claudePct = (card.claudeMs / maxBarMs) * 100;
  const bothPct = (card.absorbedMs / maxBarMs) * 100;
  const lastDelta = card.lastActivityMs ? Date.now() - card.lastActivityMs : null;
  let lastAgo = "—";
  if (lastDelta !== null) {
    const m = Math.floor(lastDelta / MS_PER_MIN);
    if (m < 1) lastAgo = "just now";
    else if (m < 60) lastAgo = `${m}m ago`;
    else if (m < 60 * 24) lastAgo = `${Math.floor(m / 60)}h ago`;
    else lastAgo = `${Math.floor(m / (60 * 24))}d ago`;
  }
  return (
    <div className="stats-pcard">
      <div className="stats-pcard-head">
        <span className="stats-pcard-name">{card.projectName}</span>
        <span className="stats-pcard-total">{fmtDuration(card.combinedMs)}</span>
      </div>
      <div className="stats-pcard-bars">
        <div className="stats-pcard-bar-row">
          <span className="stats-pcard-bar-label">Task timer</span>
          <div className="stats-pcard-bar-track">
            <div className="stats-pcard-bar stats-pcard-bar-task" style={{ width: `${taskPct}%` }} />
          </div>
          <span className="stats-pcard-bar-val">
            {fmtDuration(card.taskMs)} <span className="stats-pcard-bar-sub">({card.taskSessions} ses)</span>
          </span>
        </div>
        <div className="stats-pcard-bar-row">
          <span className="stats-pcard-bar-label">Claude</span>
          <div className="stats-pcard-bar-track">
            <div className="stats-pcard-bar stats-pcard-bar-claude" style={{ width: `${claudePct}%` }} />
          </div>
          <span className="stats-pcard-bar-val">
            {fmtDuration(card.claudeMs)} <span className="stats-pcard-bar-sub">({card.claudeSessions} ses)</span>
          </span>
        </div>
        {card.absorbedMs > 0 && (
          <div className="stats-pcard-bar-row">
            <span className="stats-pcard-bar-label">Both</span>
            <div className="stats-pcard-bar-track">
              <div className="stats-pcard-bar stats-pcard-bar-both" style={{ width: `${bothPct}%` }} />
            </div>
            <span className="stats-pcard-bar-val">{fmtDuration(card.absorbedMs)}</span>
          </div>
        )}
      </div>
      <div className="stats-pcard-foot">
        <span>Combined: <strong>{fmtDuration(card.combinedMs)}</strong></span>
        {card.assistPct !== null && (
          <span>{card.assistPct}% AI-assisted</span>
        )}
        <span className="stats-pcard-last">
          last {card.lastActivitySource === "claude" ? "Claude" : "task"}: {lastAgo}
        </span>
      </div>
    </div>
  );
}

function ProjectGrid({ cards }) {
  if (!cards.length) return <p className="stats-empty">No project activity yet.</p>;
  return (
    <div className="stats-pcard-grid">
      {cards.map((c) => <ProjectGridCard key={c.projectId} card={c} />)}
    </div>
  );
}

/* ── Triage banner (currently always-hidden — count is 0 until the importer
       starts pushing triage entries to the backend). ── */

function TriageBanner({ count }) {
  if (!count) return null;
  return (
    <div className="stats-triage-banner">
      <div className="stats-triage-text">
        <strong>{count}</strong> Claude session{count === 1 ? "" : "s"} need triage
        <span className="stats-triage-sub">{" "}— couldn't auto-attribute to a project.</span>
      </div>
      <button type="button" className="stats-triage-btn" disabled>
        Triage queue (coming soon)
      </button>
    </div>
  );
}

/* ── Tab views ── */

function OverviewTab({ stats }) {
  return (
    <>
      <TriageBanner count={stats.triageCount || 0} />

      <section className="stats-cards">
        {[["Today", stats.today], ["This week", stats.week], ["All-time", stats.all]].map(([label, r]) => (
          <Card key={label} label={label}>
            <CardRow value={fmtDuration(r.deep_work_ms)} unit="total deep work" />
            <CardRow value={fmtDuration(r.task_ms)} unit="task timer" />
            <CardRow value={fmtDuration(r.claude_outside_ms)} unit="claude (outside)" />
          </Card>
        ))}
      </section>

      <section className="stats-section">
        <h2>Last 14 days — total deep work</h2>
        <DailyDeepChart bars={stats.dailyDeep} />
        <p className="stats-footnote">
          <span className="stats-swatch stats-swatch-task" /> Task timer (absorbs concurrent Claude)
          {"  "}
          <span className="stats-swatch stats-swatch-claude" /> Claude outside any task timer
        </p>
      </section>

      <section className="stats-section">
        <h2>By project</h2>
        <ProjectGrid cards={stats.projectCards} />
      </section>

      <section className="stats-section">
        <h2>Hour-of-day heatmap</h2>
        <HeatmapGrid stats={stats} />
      </section>

      <section className="stats-section">
        <h2>Focus streak</h2>
        <div className="stats-streak">
          <div>
            <span className="stats-num">{stats.currentStreak}</span>
            <span className="stats-card-unit"> day{stats.currentStreak === 1 ? "" : "s"} current</span>
          </div>
          <div>
            <span className="stats-num">{stats.all.pomos}</span>
            <span className="stats-card-unit"> total pomodoros</span>
          </div>
        </div>
      </section>
    </>
  );
}

function buildTodayData(stats) {
  const todayStart = todayStartMs();
  const todayEnd = todayStart + MS_PER_DAY;
  const yStart = todayStart - MS_PER_DAY;

  const tt = stats.taskTimer.filter((t) => t.start >= todayStart && t.start < todayEnd);
  const cc = stats.claude.filter((c) => c.start >= todayStart && c.start < todayEnd);
  const ttY = stats.taskTimer.filter((t) => t.start >= yStart && t.start < todayStart);
  const ccY = stats.claude.filter((c) => c.start >= yStart && c.start < todayStart);

  const taskMs = tt.reduce((s, t) => s + t.durationMs, 0);
  const claudeMs = cc.reduce((s, c) => s + c.durationMs, 0);
  const claudeOutsideMs = cc.reduce((s, c) => s + c.outsideMs, 0);
  const deepMs = taskMs + claudeOutsideMs;
  const absorbedMs = cc.reduce((s, c) => s + c.absorbedMs, 0);

  const yTaskMs = ttY.reduce((s, t) => s + t.durationMs, 0);
  const yClaudeOutsideMs = ccY.reduce((s, c) => s + c.outsideMs, 0);
  const yDeepMs = yTaskMs + yClaudeOutsideMs;

  // Hour-by-hour today: a 24-element row of {taskMs, claudeOutsideMs}. We split
  // sessions across hour boundaries with the same proportional-interval slicing
  // the heatmap uses, so a 14:50–15:20 session credits the right hours.
  const hours = Array.from({ length: 24 }, () => ({ taskMs: 0, claudeOutsideMs: 0 }));
  function distribute(startMs, endMs, totalMs, key) {
    if (endMs <= startMs || totalMs <= 0) return;
    const factor = totalMs / (endMs - startMs);
    let cursor = Math.max(startMs, todayStart);
    const stop = Math.min(endMs, todayEnd);
    while (cursor < stop) {
      const d = new Date(cursor);
      const hr = d.getHours();
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr + 1, 0, 0).getTime();
      const segEnd = Math.min(stop, next);
      hours[hr][key] += (segEnd - cursor) * factor;
      cursor = segEnd;
    }
  }
  for (const t of tt) distribute(t.start, t.end, t.durationMs, "taskMs");
  for (const c of cc) if (c.outsideMs > 0) distribute(c.start, c.end, c.outsideMs, "claudeOutsideMs");
  const hoursMax = Math.max(1, ...hours.map((h) => h.taskMs + h.claudeOutsideMs));

  // Per-project today
  const projectName = new Map(stats.projects.map((p) => [p.id, p.name]));
  const byProjMap = new Map();
  const projSlot = (pid) => {
    if (!byProjMap.has(pid)) byProjMap.set(pid, { taskMs: 0, claudeMs: 0, absorbedMs: 0, sessions: 0 });
    return byProjMap.get(pid);
  };
  for (const t of tt) { const s = projSlot(t.projectId); s.taskMs += t.durationMs; s.sessions += 1; }
  for (const c of cc) { const s = projSlot(c.projectId); s.claudeMs += c.durationMs; s.absorbedMs += c.absorbedMs; s.sessions += 1; }
  const byProject = [...byProjMap.entries()]
    .map(([pid, x]) => ({
      label: projectName.get(pid) || "Unknown",
      taskMs: x.taskMs,
      claudeMs: x.claudeMs,
      claudeOutsideMs: x.claudeMs - x.absorbedMs,
      combinedMs: x.taskMs + (x.claudeMs - x.absorbedMs),
      sessions: x.sessions,
    }))
    .sort((a, b) => b.combinedMs - a.combinedMs);

  // Chronological session list (task + claude interleaved)
  const sessions = [];
  for (const t of tt) sessions.push({
    type: "task",
    start: t.start, end: t.end, durationMs: t.durationMs,
    projectName: projectName.get(t.projectId) || "Unknown",
    tags: t.tags || [],
    msgs: 0,
  });
  for (const c of cc) sessions.push({
    type: "claude",
    start: c.start, end: c.end, durationMs: c.durationMs,
    projectName: projectName.get(c.projectId) || "Unknown",
    tags: c.tags || [],
    msgs: c.messageCount,
    absorbedMs: c.absorbedMs,
  });
  sessions.sort((a, b) => a.start - b.start);

  // Tag totals today
  const tagMs = new Map();
  for (const t of tt) for (const tg of t.tags || []) tagMs.set(tg, (tagMs.get(tg) || 0) + t.durationMs);
  for (const c of cc) for (const tg of c.tags || []) tagMs.set(tg, (tagMs.get(tg) || 0) + c.durationMs);
  const tags = [...tagMs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, ms]) => ({ label: `#${t}`, value: ms }));

  return {
    taskMs, claudeMs, claudeOutsideMs, absorbedMs, deepMs,
    yTaskMs, yClaudeOutsideMs, yDeepMs,
    deepDelta: deepMs - yDeepMs,
    sessions, byProject, hours, hoursMax, tags,
    todayPomos: stats.today.pomos,
  };
}

function HourBar({ hours, max }) {
  // 24-cell single row showing today's hour-by-hour intensity. Each cell is
  // stacked: tan task on bottom, slate Claude on top. Same color logic as the
  // weekly heatmap but for one day.
  return (
    <div className="stats-hourbar">
      <div className="stats-hourbar-row">
        {hours.map((h, i) => {
          const total = h.taskMs + h.claudeOutsideMs;
          if (total === 0) {
            return (
              <span key={i} className="stats-hourbar-cell" title={`${i}:00 — no activity`}>
                <span className="stats-hourbar-label">{i}</span>
              </span>
            );
          }
          const intensity = total / max;
          const taskShare = h.taskMs / total;
          const bg = `linear-gradient(180deg,
            rgba(74,90,112,${0.25 + 0.7 * intensity * (1 - taskShare)}) ${(1 - taskShare) * 100}%,
            rgba(138,105,64,${0.25 + 0.7 * intensity * taskShare}) ${(1 - taskShare) * 100}%)`;
          const tip = `${i}:00 — ${fmtDuration(total)}\n  Task: ${fmtDuration(h.taskMs)}\n  Claude outside: ${fmtDuration(h.claudeOutsideMs)}`;
          return (
            <span
              key={i}
              className="stats-hourbar-cell stats-hourbar-cell-active"
              style={{ background: bg }}
              title={tip}
            >
              <span className="stats-hourbar-label">{i}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TodaySessionRow({ s }) {
  const startStr = new Date(s.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const endStr = new Date(s.end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const tagsLine = s.tags.slice(0, 4).map((t) => `#${t}`).join(" ");
  const sourceBadge = s.type === "task" ? "Task timer" : "Claude";
  const sourceClass = s.type === "task" ? "is-task" : "is-claude";
  const meta = s.type === "claude"
    ? `${s.msgs} msgs${s.absorbedMs > 0 ? ` · ${fmtDuration(s.absorbedMs)} absorbed` : ""}`
    : "pomodoro / manual";
  return (
    <li className="stats-today-session-row">
      <span className="stats-today-session-time">{startStr}–{endStr}</span>
      <span className={`stats-today-session-source ${sourceClass}`}>{sourceBadge}</span>
      <span className="stats-today-session-proj">{s.projectName}</span>
      <span className="stats-today-session-tags">{tagsLine}</span>
      <span className="stats-today-session-dur">{fmtDuration(s.durationMs)}</span>
      <span className="stats-today-session-meta">{meta}</span>
    </li>
  );
}

function TodayProjectRow({ row, max }) {
  const taskPct = max ? (row.taskMs / max) * 100 : 0;
  const claudePct = max ? (row.claudeOutsideMs / max) * 100 : 0;
  return (
    <div className="stats-today-project-row">
      <span className="stats-today-project-name">{row.label}</span>
      <div className="stats-today-project-track">
        {row.taskMs > 0 && (
          <div className="stats-today-project-bar stats-today-project-bar-task" style={{ width: `${taskPct}%` }} title={`${fmtDuration(row.taskMs)} task timer`} />
        )}
        {row.claudeOutsideMs > 0 && (
          <div className="stats-today-project-bar stats-today-project-bar-claude" style={{ width: `${claudePct}%` }} title={`${fmtDuration(row.claudeOutsideMs)} Claude outside`} />
        )}
      </div>
      <span className="stats-today-project-val">
        {fmtDuration(row.combinedMs)}
        <span className="stats-breakdown-sub"> · {row.sessions} ses</span>
      </span>
    </div>
  );
}

function TodayTab({ stats }) {
  const t = useMemo(() => buildTodayData(stats), [stats]);
  const noActivity = t.deepMs === 0 && t.sessions.length === 0;
  const maxProjectMs = Math.max(1, ...t.byProject.map((r) => r.combinedMs));
  const deltaMin = Math.round(t.deepDelta / MS_PER_MIN);
  const deltaSign = deltaMin > 0 ? "+" : "";

  if (noActivity) {
    return (
      <section className="stats-section">
        <h2>Today</h2>
        <p className="stats-empty">No work sessions logged yet today.</p>
        <p className="stats-footnote">
          Sessions populate as the hourly importer picks up new Claude transcripts
          and as task timers run. Yesterday: {fmtDuration(t.yDeepMs)} total deep work.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="stats-cards">
        <Card label="Total today">
          <CardRow value={fmtDuration(t.deepMs)} unit="deep work" />
          <CardRow value={fmtDuration(t.taskMs)} unit="task timer" />
          <CardRow value={fmtDuration(t.claudeOutsideMs)} unit="claude (outside)" />
        </Card>
        <Card label="Sessions">
          <CardRow value={t.sessions.length} unit="total" />
          <CardRow value={t.todayPomos} unit="pomodoros done" />
          <CardRow
            value={t.sessions.length ? fmtDuration(Math.round(t.deepMs / t.sessions.length)) : "—"}
            unit="avg deep work / session"
          />
        </Card>
        <Card label="Claude breakdown">
          <CardRow value={fmtDuration(t.claudeMs)} unit="total claude" />
          <CardRow value={fmtDuration(t.absorbedMs)} unit="absorbed by task timer" />
          <CardRow
            value={t.claudeMs > 0 ? `${Math.round((t.absorbedMs / t.claudeMs) * 100)}%` : "—"}
            unit="overlap rate"
          />
        </Card>
        <Card label="vs yesterday">
          <CardRow value={`${deltaSign}${deltaMin}m`} unit="vs yesterday's deep work" />
          <CardRow value={fmtDuration(t.yDeepMs)} unit="yesterday's total" />
        </Card>
      </section>

      <section className="stats-section">
        <h2>Hour by hour</h2>
        <HourBar hours={t.hours} max={t.hoursMax} />
        <p className="stats-footnote">
          <span className="stats-swatch stats-swatch-task" /> Task timer{" "}
          <span className="stats-swatch stats-swatch-claude" /> Claude outside any task timer.
          Hover any hour cell for the breakdown.
        </p>
      </section>

      <section className="stats-section">
        <h2>By project — today</h2>
        {t.byProject.length === 0 ? (
          <p className="stats-empty">No project activity yet today.</p>
        ) : (
          <div className="stats-today-project-list">
            {t.byProject.map((r) => (
              <TodayProjectRow key={r.label} row={r} max={maxProjectMs} />
            ))}
          </div>
        )}
      </section>

      <section className="stats-section">
        <h2>Sessions today — chronological</h2>
        {t.sessions.length === 0 ? (
          <p className="stats-empty">No sessions logged today.</p>
        ) : (
          <ul className="stats-today-session-list">
            {t.sessions.map((s, i) => (
              <TodaySessionRow key={i} s={s} />
            ))}
          </ul>
        )}
      </section>

      <section className="stats-section">
        <h2>By tag — today</h2>
        <BreakdownBars
          rows={t.tags.slice(0, 12)}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No tags on today's sessions."
        />
      </section>
    </>
  );
}

function FocusTab({ stats }) {
  return (
    <>
      <section className="stats-cards">
        {[["Today", stats.today], ["This week", stats.week], ["All-time", stats.all]].map(([label, r]) => (
          <Card key={label} label={label}>
            <CardRow value={r.pomos} unit="pomodoros completed" />
            <CardRow value={fmtDuration(r.task_ms)} unit="focus time" />
          </Card>
        ))}
      </section>

      <section className="stats-section">
        <h2>Focus streak</h2>
        <div className="stats-streak">
          <div>
            <span className="stats-num">{stats.currentStreak}</span>
            <span className="stats-card-unit"> day{stats.currentStreak === 1 ? "" : "s"} current</span>
          </div>
        </div>
      </section>

      <section className="stats-section">
        <h2>Focus time by project — all time</h2>
        <BreakdownBars
          rows={stats.focusByProject}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No task-timer sessions yet."
        />
      </section>
    </>
  );
}

function ClaudeTab({ stats }) {
  return (
    <>
      <section className="stats-cards">
        {[["Today", stats.today], ["This week", stats.week], ["All-time", stats.all]].map(([label, r]) => (
          <Card key={label} label={label}>
            <CardRow value={r.claude_sessions} unit="claude sessions" />
            <CardRow value={fmtDuration(r.claude_total_ms)} unit="active time" />
            <CardRow value={r.claude_sessions ? Math.round(r.claude_msgs / r.claude_sessions) : 0} unit="msgs / session" />
          </Card>
        ))}
      </section>

      <section className="stats-section">
        <h2>Claude time by project — all time</h2>
        <ClaudeProjectRows rows={stats.claudeByProject} />
      </section>

      <section className="stats-section">
        <h2>Claude time by tag — top 15</h2>
        <BreakdownBars
          rows={stats.claudeByTag.slice(0, 15)}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No tags yet."
        />
      </section>

      <section className="stats-section">
        <h2>Recent Claude sessions</h2>
        <RecentClaudeList rows={stats.recentClaude} />
      </section>
    </>
  );
}

function TasksTab({ stats }) {
  return (
    <>
      <section className="stats-section">
        <h2>Tasks by project — current</h2>
        <ProjectTaskSplit rows={stats.tasksByProject} />
        <p className="stats-footnote">
          Open <span className="stats-swatch stats-swatch-open" /> / Done <span className="stats-swatch stats-swatch-done" />{" "}
          · "AI-assist" = % of focus time that overlapped a Claude session in the same project.
        </p>
      </section>

      <section className="stats-section">
        <h2>Open tasks by tag — top 15</h2>
        <BreakdownBars
          rows={stats.tasksByTag.slice(0, 15)}
          formatRight={(v) => v}
          emptyMsg="No tags on open tasks."
        />
      </section>

      <section className="stats-footer">
        <p className="stats-footnote">
          {stats.tasksOpen} open · {stats.taskHistoryCount} completed in app history. Vault-side
          completions (synced via /sync-todos) don't currently create history entries, so this is
          an under-count of total throughput.
        </p>
      </section>
    </>
  );
}

/* ── Page shell ── */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "today", label: "Today" },
  { id: "focus", label: "Focus" },
  { id: "claude", label: "Claude" },
  { id: "tasks", label: "Tasks" },
];

function SnapshotIndicator({ loadedAtMs }) {
  // Tells the user how stale this view is. /stats is a snapshot at page-load
  // time — no live polling — so when the schedules ran for the last time can
  // matter as much as when the page loaded. Both lines printed.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  function rel(min) {
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`;
    return `${Math.floor(min / 60 / 24)}d ago`;
  }
  const loadedMin = Math.floor((now - loadedAtMs) / 60000);
  return (
    <div className="stats-snapshot">
      <span className="stats-snapshot-label">Snapshot loaded {rel(loadedMin)}</span>
      <button
        type="button"
        className="stats-snapshot-refresh"
        onClick={() => window.location.reload()}
        title="Reload to fetch the latest data from the server"
      >
        ↻ refresh
      </button>
    </div>
  );
}

export default function StatsPage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("overview");
  const [loadedAtMs, setLoadedAtMs] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent().then((c) => {
      if (mounted) {
        setContent(c);
        setLoadedAtMs(Date.now());
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
      <div className="stats-title-row">
        <h1 className="stats-title">Stats</h1>
        <SnapshotIndicator loadedAtMs={loadedAtMs} />
      </div>

      <nav className="stats-tabs" aria-label="Stats sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`stats-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="stats-tab-body">
        {tab === "overview" && <OverviewTab stats={stats} />}
        {tab === "today" && <TodayTab stats={stats} />}
        {tab === "focus" && <FocusTab stats={stats} />}
        {tab === "claude" && <ClaudeTab stats={stats} />}
        {tab === "tasks" && <TasksTab stats={stats} />}
      </div>
    </main>
  );
}
