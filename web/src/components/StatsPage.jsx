import { useEffect, useMemo, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
} from "../utils/taskUtils.js";
import StatGrid from "./StatGrid.jsx";
import PageHeader from "./PageHeader.jsx";
import Tabs from "./Tabs.jsx";
import Section from "./Section.jsx";
import EmptyState from "./EmptyState.jsx";
import RelativeTime from "./RelativeTime.jsx";
import Tooltip from "./Tooltip.jsx";
import Dot from "./Dot.jsx";
import MetricTable from "./MetricTable.jsx";
import { buildWeekRecap, resolveProjectColors, softenColor } from "./WeekRecap.jsx";
import ClaudeProjectBucket, { buildClaudeBuckets } from "./ClaudeProjectBucket.jsx";
import Collapsible from "./Collapsible.jsx";

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
      // Carried for project-card "last activity" summary line.
      aiSummary: ws.aiSummary || "",
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

  // Project-color resolution. Use the stored color when it's a real
  // choice (not the app-default tan), else pick from the same palette
  // used by /home's project-mix card so colors stay consistent
  // app-wide. The migration on 2026-06-03 backfilled most projects, but
  // brand-new projects auto-created post-migration may still hit the
  // default until the script's pick_unused_color runs.
  const PROJECT_COLOR_PALETTE = [
    "#5a7e5f", "#8a6940", "#4a5a70", "#c45c4a",
    "#7a5b9c", "#5c8aa8", "#8aa05c", "#9c6a8a", "#a05c5c",
  ];
  const PROJECT_DEFAULT_COLORS = new Set(["#b66e35", "", null, undefined]);
  const projectColor = new Map(
    projects.map((p, i) => {
      const stored = p.color;
      const color = !PROJECT_DEFAULT_COLORS.has(stored)
        ? stored
        : PROJECT_COLOR_PALETTE[i % PROJECT_COLOR_PALETTE.length];
      return [p.id, color];
    })
  );
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
      color: projectColor.get(pid),
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
    .map(([pid, ms]) => ({
      label: projectName.get(pid) || "Unknown",
      color: projectColor.get(pid),
      value: ms,
    }));

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
        color: projectColor.get(pid),
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
        // Newest non-empty AI summary across the project's Claude
        // sessions. Filled in the claude loop below.
        lastAiSummary: "",
        lastAiSummaryMs: 0,
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
    // Track newest non-empty AI summary per project. Sessions without
    // summaries are skipped so we surface the most recent summarized
    // session even if newer sessions are missing one.
    const summary = (c.aiSummary || "").trim();
    if (summary && c.end > s.lastAiSummaryMs) {
      s.lastAiSummary = summary;
      s.lastAiSummaryMs = c.end;
    }
  }
  const projectCards = [...cardMap.values()]
    .map((s) => ({
      ...s,
      projectName: projectName.get(s.projectId) || "Unknown",
      color: projectColor.get(s.projectId),
      combinedMs: s.taskMs + s.claudeOutsideMs,
      assistPct: s.taskMs > 0 ? Math.round((s.absorbedMs / s.taskMs) * 100) : null,
    }))
    .filter((s) => s.combinedMs > 0 || s.claudeMs > 0)
    .sort((a, b) => b.combinedMs + b.claudeMs - (a.combinedMs + a.claudeMs));

  // ── Completion stats (from workSessions.completedTasks) ────────────
  // Powers the 5 new "tasks shipped" sections on the Tasks tab.
  // Each completion record: { subject, completedAt, projectId, sessionId }.
  const allCompletions = [];
  for (const ws of content.workSessions || []) {
    const cts = Array.isArray(ws.completedTasks) ? ws.completedTasks : [];
    for (const t of cts) {
      if (!t || !t.subject) continue;
      allCompletions.push({
        subject: t.subject,
        completedAt: t.completedAt,
        projectId: ws.projectId || "",
        sessionId: ws.id,
        sessionActiveMs: ws.activeMs || 0,
      });
    }
  }

  // Sort newest first
  allCompletions.sort((a, b) =>
    (b.completedAt || "").localeCompare(a.completedAt || "")
  );

  // Per-window completion counts (today / week / all)
  function completionsSince(startMs) {
    return allCompletions.filter((c) => {
      const t = Date.parse(c.completedAt);
      return Number.isFinite(t) && t >= startMs;
    }).length;
  }
  const completionCounts = {
    today: completionsSince(todayStart),
    week: completionsSince(weekStart),
    all: allCompletions.length,
  };

  // Daily completion count for the velocity chart — matches the
  // dailyDeep window (14 days, one per day with today marked).
  const dailyCompletions = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dStart = d.getTime();
    const dEnd = dStart + MS_PER_DAY;
    const count = allCompletions.filter((c) => {
      const t = Date.parse(c.completedAt);
      return Number.isFinite(t) && t >= dStart && t < dEnd;
    }).length;
    dailyCompletions.push({
      day: ymd(d),
      label: String(d.getDate()),
      count,
      isToday: i === 0,
    });
  }

  // Completions grouped by project (all-time). Sort by count desc.
  const completionsByProjectMap = new Map();
  for (const c of allCompletions) {
    completionsByProjectMap.set(c.projectId, (completionsByProjectMap.get(c.projectId) || 0) + 1);
  }
  const completionsByProject = [...completionsByProjectMap.entries()]
    .map(([pid, count]) => ({
      projectId: pid,
      name: projectName.get(pid) || "Unassigned",
      color: projectColor.get(pid),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Hours-per-completion ratio per project — focus time spent vs tasks
  // shipped. Noisy at small N; we surface this with a min-threshold
  // (≥3 completions) so single-completion projects don't dominate.
  // focusByProject already has per-project ms; join by projectId.
  const focusMsByProject = new Map();
  for (const row of focusByProject) {
    focusMsByProject.set(row.projectId || row.id, (row.ms || row.focusMs || 0));
  }
  const focusPerCompletion = completionsByProject
    .filter((p) => p.count >= 3)
    .map((p) => {
      const ms = focusMsByProject.get(p.projectId) || 0;
      return {
        ...p,
        focusMs: ms,
        msPerCompletion: p.count > 0 ? ms / p.count : 0,
      };
    })
    .sort((a, b) => a.msPerCompletion - b.msPerCompletion); // most efficient first

  // Recent completions feed — flat list of last 50 with project resolution.
  const recentCompletions = allCompletions.slice(0, 50).map((c) => ({
    ...c,
    projectName: projectName.get(c.projectId) || "Unassigned",
    color: projectColor.get(c.projectId),
  }));

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
    // New completion-based stats
    completionCounts,
    dailyCompletions,
    completionsByProject,
    focusPerCompletion,
    recentCompletions,
    // Raw intervals + project list — passed to HeatmapGrid so it can re-bucket
    // based on its own filter/period state without re-running computeStats.
    taskTimer,
    claude,
    projects: [...projectName.entries()].map(([id, name]) => ({ id, name })),
    projectCards,
  };
}

/* ── Reusable bits ── */

function DailyDeepChart({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.totalMs));
  return (
    <div className="stats-daily">
      {bars.map((b) => {
        const taskPct = (b.taskMs / max) * 100;
        const clPct = (b.claudeOutsideMs / max) * 100;
        const tip = (
          <>
            <strong>{b.day}</strong> — {fmtDuration(b.totalMs)} total
            <br />Task timer: {fmtDuration(b.taskMs)}
            <br />Claude (outside): {fmtDuration(b.claudeOutsideMs)}
          </>
        );
        return (
          <Tooltip key={b.day} content={tip}>
            <div className={`stats-daily-col${b.isToday ? " is-today" : ""}`}>
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
          </Tooltip>
        );
      })}
    </div>
  );
}

function BreakdownBars({ rows, formatRight, emptyMsg }) {
  if (!rows.length) return <EmptyState variant="inline" message={emptyMsg} />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => {
        // Project-based rows have `color`; tag-based rows don't (and
        // get the default bar color from the stylesheet).
        const barStyle = { width: `${(r.value / max) * 100}%` };
        if (r.color) barStyle.background = r.color;
        return (
          <div key={r.label} className="stats-breakdown-row">
            <span className="stats-breakdown-label" title={r.label}>
              {r.color && <span className="stats-project-dot" style={{ background: r.color }} />}
              {r.label}
            </span>
            <div className="stats-breakdown-bar-wrap">
              <div className="stats-breakdown-bar" style={barStyle} />
            </div>
            <span className="stats-breakdown-value">{formatRight(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProjectTaskSplit({ rows }) {
  if (!rows.length) return <EmptyState variant="inline" message="No tasks yet" />;
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => (
        <div key={r.label} className="stats-breakdown-row">
          <span className="stats-breakdown-label" title={r.label}>
            {r.color && <span className="stats-project-dot" style={{ background: r.color }} />}
            {r.label}
          </span>
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
  if (!rows.length) return <EmptyState variant="inline" message="No Claude sessions yet" />;
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => {
        const barStyle = { width: `${(r.ms / max) * 100}%` };
        if (r.color) barStyle.background = r.color;
        return (
        <div key={r.label} className="stats-breakdown-row stats-breakdown-row-2line">
          <span className="stats-breakdown-label">
            {r.color && <span className="stats-project-dot" style={{ background: r.color }} />}
            {r.label}
          </span>
          <div className="stats-breakdown-bar-wrap">
            <div className="stats-breakdown-bar" style={barStyle} />
          </div>
          <span className="stats-breakdown-value">
            {fmtDuration(r.ms)}
            <span className="stats-breakdown-sub">
              {" "}· {r.sessions} ses · avg {r.avgMin}m / {r.avgMsgs} msgs
            </span>
          </span>
        </div>
        );
      })}
    </div>
  );
}

function RecentClaudeList({ rows }) {
  if (!rows.length) return <EmptyState variant="inline" message="No recent Claude sessions" />;
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

function buildHeatmapGrid(taskTimer, claude, periodWeeks, projectId, projects) {
  const cutoff = Date.now() - periodWeeks * 7 * MS_PER_DAY;
  // Each cell tracks:
  //   - taskMs / claudeOutsideMs (used by task-vs-claude mode)
  //   - projectMs: Map<projectId, ms> (used by by-project mode)
  // Both are filled in the same single distribute pass below, so adding
  // by-project mode costs no extra session walk.
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      taskMs: 0,
      claudeOutsideMs: 0,
      projectMs: new Map(),
    }))
  );

  // Distribute a session's contribution across the hour cells it spans.
  // factor lets us scale (used for Claude's outsideMs which is < durationMs).
  // pid is the session's projectId so we can also bucket by project.
  function distribute(startMs, endMs, totalMs, key, pid) {
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
      const slice = (segEnd - cursor) * factor;
      grid[dow][hr][key] += slice;
      // Also track per-project so by-project mode can re-render without
      // another data pass when the user flips the dropdown.
      const cellProj = grid[dow][hr].projectMs;
      cellProj.set(pid, (cellProj.get(pid) || 0) + slice);
      cursor = segEnd;
    }
  }

  // Accumulate project totals across the heatmap window for palette
  // assignment (passed to resolveProjectColors below). Counts both
  // task_timer time and claude_outside time per project.
  const projectTotals = new Map();

  for (const t of taskTimer) {
    if (t.start < cutoff) continue;
    if (projectId !== "all" && t.projectId !== projectId) continue;
    distribute(t.start, t.end, t.durationMs, "taskMs", t.projectId || "");
    projectTotals.set(
      t.projectId || "",
      (projectTotals.get(t.projectId || "") || 0) + t.durationMs
    );
  }
  for (const c of claude) {
    if (c.start < cutoff) continue;
    if (projectId !== "all" && c.projectId !== projectId) continue;
    if (c.outsideMs <= 0) continue;
    distribute(c.start, c.end, c.outsideMs, "claudeOutsideMs", c.projectId || "");
    projectTotals.set(
      c.projectId || "",
      (projectTotals.get(c.projectId || "") || 0) + c.outsideMs
    );
  }

  let max = 0;
  for (const row of grid) for (const cell of row) {
    const total = cell.taskMs + cell.claudeOutsideMs;
    if (total > max) max = total;
  }

  // Project color resolution (matches buildWeekRecap so the same
  // project shows the same color on /home, the chart above, and here).
  const projectColors = resolveProjectColors(projects || [], projectTotals);

  return { grid, max, projectColors };
}

/* Parse a hex/rgb color string into "r, g, b" suitable for rgba(...)
   in a CSS gradient. Returns null if the format isn't recognized.
   Mirrors the parser in WeekRecap.jsx softenColor but returns the
   raw channel triplet instead of softening. Inline (vs imported) to
   keep this file's heatmap logic self-contained. */
function parseColorRgb(color) {
  if (!color || typeof color !== "string") return null;
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return `${parseInt(hex[0] + hex[0], 16)}, ${parseInt(hex[1] + hex[1], 16)}, ${parseInt(hex[2] + hex[2], 16)}`;
    }
    if (hex.length === 6) {
      return `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}`;
    }
    return null;
  }
  if (color.startsWith("rgb")) {
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return `${m[1]}, ${m[2]}, ${m[3]}`;
  }
  return null;
}

function HeatmapGrid({ stats }) {
  const [period, setPeriod] = useState("8w");
  const [projectId, setProjectId] = useState("all");
  // Coloring mode: mirrors the chart-mode dropdown above. Defaults to
  // "by-project" so the two charts on Overview are consistent without
  // the user having to flip both.
  const [mode, setMode] = useState("by-project");
  const weeks = HEATMAP_PERIODS.find((p) => p.id === period)?.weeks || 8;
  const { grid, max, projectColors } = useMemo(
    () => buildHeatmapGrid(stats.taskTimer, stats.claude, weeks, projectId, stats.projects),
    [stats.taskTimer, stats.claude, weeks, projectId, stats.projects]
  );
  const projectOptions = useMemo(
    () => [{ id: "all", name: "All projects" }, ...stats.projects],
    [stats.projects]
  );
  // Project name lookup for tooltip rendering in by-project mode.
  const projectNameById = useMemo(() => {
    const m = new Map();
    for (const p of stats.projects) m.set(p.id, p.name);
    return m;
  }, [stats.projects]);

  return (
    <div className="stats-heatmap">
      <div className="stats-heatmap-controls">
        <select
          className="stats-heatmap-select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="Heatmap coloring mode"
        >
          <option value="by-project">By project</option>
          <option value="task-vs-claude">Task timer vs Claude</option>
        </select>
        <select
          className="stats-heatmap-select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Filter to project"
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
        <EmptyState variant="inline" message="No activity in this window" />
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
                let bg;
                let tooltip;
                if (total === 0) {
                  bg = "rgba(0,0,0,0.04)";
                  tooltip = `${DOW_LABELS[dow]} ${hr}:00 — no activity`;
                } else if (mode === "by-project") {
                  // Sort segments largest → smallest, then stack TOP-down
                  // as a vertical gradient where each band's vertical
                  // size is its share of total. Each band's alpha is
                  // 0.18 baseline + intensity*share*0.78 — same scaling
                  // as task-vs-claude (busier cells = bolder colors,
                  // dominant segments = brighter within the cell).
                  const segs = [...cell.projectMs.entries()]
                    .filter(([, ms]) => ms > 0)
                    .sort((a, b) => b[1] - a[1]);
                  const stops = [];
                  let cum = 0;
                  for (const [pid, ms] of segs) {
                    const rgb = parseColorRgb(projectColors.get(pid) || "#888888")
                      || "136, 136, 136";
                    const share = ms / total;
                    const alpha = 0.18 + 0.78 * intensity * share;
                    const start = (cum / total) * 100;
                    cum += ms;
                    const end = (cum / total) * 100;
                    stops.push(`rgba(${rgb}, ${alpha}) ${start}%`);
                    stops.push(`rgba(${rgb}, ${alpha}) ${end}%`);
                  }
                  bg = `linear-gradient(180deg, ${stops.join(", ")})`;
                  tooltip = (
                    <>
                      <strong>{DOW_LABELS[dow]} {hr}:00</strong> — {fmtDuration(total)}
                      {segs.map(([pid, ms]) => (
                        <span key={pid}>
                          <br />
                          {projectNameById.get(pid) || "Unassigned"}: {fmtDuration(ms)}
                        </span>
                      ))}
                    </>
                  );
                } else {
                  // Legacy two-channel cell (task on bottom, claude on top).
                  // Each segment's alpha scales with intensity * its share.
                  const taskShare = total > 0 ? cell.taskMs / total : 0;
                  bg = `linear-gradient(180deg, rgba(74,90,112,${0.18 + 0.78 * intensity * (1 - taskShare)}) ${(1 - taskShare) * 100}%, rgba(138,105,64,${0.18 + 0.78 * intensity * taskShare}) ${(1 - taskShare) * 100}%)`;
                  tooltip = (
                    <>
                      <strong>{DOW_LABELS[dow]} {hr}:00</strong> — {fmtDuration(total)}
                      <br />Task: {fmtDuration(cell.taskMs)}
                      <br />Claude (outside): {fmtDuration(cell.claudeOutsideMs)}
                    </>
                  );
                }
                return (
                  <Tooltip key={hr} content={tooltip}>
                    <span
                      className="stats-heatmap-cell"
                      style={{ background: bg }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {mode === "task-vs-claude" ? (
        <p className="stats-footnote">
          Hour-of-day intensity ({weeks} weeks). Each cell:{" "}
          <span className="stats-swatch stats-swatch-task" /> task timer +{" "}
          <span className="stats-swatch stats-swatch-claude" /> Claude outside (stacked, intensity scaled to busiest cell).
          Hover for the breakdown.
        </p>
      ) : (
        <p className="stats-footnote">
          Hour-of-day intensity ({weeks} weeks). Each cell stacks project
          colors by share of focused time, intensity scaled to the busiest
          cell. Hover for the per-project breakdown.
        </p>
      )}
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
  // Project-color 3px bar UNDER the head row (the head's border-bottom).
  // Replaces the previous left-edge color stripe. The fallback to
  // --rule-soft applies for projects without a real color so the head
  // still has a visible separator (just hairline-quiet).
  const headStyle = card.color ? { borderBottomColor: card.color } : null;
  return (
    <div className="stats-pcard">
      <div className="stats-pcard-head" style={headStyle}>
        <span className="stats-pcard-name">
          {card.color && <span className="stats-project-dot" style={{ background: card.color }} />}
          {card.projectName}
        </span>
        <span className="stats-pcard-total">{fmtDuration(card.combinedMs)}</span>
      </div>
      <div className="stats-pcard-bars">
        <div className="stats-pcard-bar-row">
          <span className="stats-pcard-bar-label">Task timer</span>
          <div className="stats-pcard-bar-track">
            <div className="stats-pcard-bar stats-pcard-bar-task" style={{ width: `${taskPct}%` }} />
          </div>
          <span className="stats-pcard-bar-val">{fmtDuration(card.taskMs)}</span>
        </div>
        <div className="stats-pcard-bar-row">
          <span className="stats-pcard-bar-label">Claude</span>
          <div className="stats-pcard-bar-track">
            <div className="stats-pcard-bar stats-pcard-bar-claude" style={{ width: `${claudePct}%` }} />
          </div>
          <span className="stats-pcard-bar-val">{fmtDuration(card.claudeMs)}</span>
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
      {/* Single muted foot line. "Combined: X" dropped since the total
          already lives in the head row. Foot shows the supporting stats
          (AI-assist %, recency) in one row with dot separators. */}
      <div className="stats-pcard-foot">
        {card.assistPct !== null && <span>{card.assistPct}% AI-assisted</span>}
        <span className="stats-pcard-last">
          last {card.lastActivitySource === "claude" ? "Claude" : "task"} {lastAgo}
        </span>
      </div>
      {/* AI summary teaser — newest summarized Claude session for this
          project. Shown only when one exists; truncates to 2 lines via
          CSS so cards stay roughly the same height. Italic + muted so it
          reads as supporting context, not the headline. */}
      {card.lastAiSummary && (
        <p className="stats-pcard-summary" title={card.lastAiSummary}>
          {card.lastAiSummary}
        </p>
      )}
    </div>
  );
}

function ProjectGrid({ cards }) {
  if (!cards.length) return <EmptyState variant="inline" message="No project activity yet" />;
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

/* DeepWorkBars — 14-day stacked-segment bar chart. Same compact shape
   (.stats-daily-* classes, 130px tall, day-number labels below) as the
   original task-vs-claude DailyDeepChart, but generalized to render
   any segment list per bar. Two coloring modes plug into this from
   OverviewTab via the `bars` prop:

     by-project       segments are per-project (color per project)
     task-vs-claude   segments are [claude, task] with the legacy colors

   Convention for `bars[i].segments`:
     - Listed in DOM order (first = visual TOP, last = visual BOTTOM).
     - Each segment's height is rendered as (ms / max-day-total) * 100%
       so days with low totals stay visibly small instead of always
       filling to the top.
     - Only the first DOM child gets rounded top corners — others sit
       beneath it with square edges (looks like one bar split into
       colored bands, not a stack of pills). */
function DeepWorkBars({ bars }) {
  const max = Math.max(1, ...bars.map((b) => b.totalMs));
  return (
    <div className="stats-daily">
      {bars.map((b) => {
        // Tooltip shows the full breakdown for the hovered day. We
        // iterate `segments` as-is so the order matches the visible
        // stack top→bottom (a small "match what you see" affordance).
        const tip = (
          <>
            <strong>{b.fullLabel || b.label}</strong> — {fmtDuration(b.totalMs)} total
            {b.segments.map((s) => (
              <span key={s.id}>
                <br />
                {s.name}: {fmtDuration(s.ms)}
              </span>
            ))}
            {b.totalMs === 0 && (
              <>
                <br />
                no focused time
              </>
            )}
          </>
        );
        return (
          <Tooltip key={b.key} content={tip}>
            <div className={`stats-daily-col${b.isToday ? " is-today" : ""}`}>
              <div className="stats-daily-stack">
                {b.segments.map((s, i) => {
                  const pct = (s.ms / max) * 100;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={s.id}
                      className="stats-daily-bar"
                      style={{
                        height: `${pct}%`,
                        background: s.color,
                        // Only the visual top segment gets rounded top
                        // corners. Inline override beats the generic
                        // .stats-daily-bar default so multi-segment
                        // project bars look like one continuous bar.
                        borderRadius: i === 0 ? "3px 3px 0 0" : "0",
                      }}
                    />
                  );
                })}
              </div>
              <div className="stats-daily-label">{b.label}</div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function OverviewTab({ stats, content }) {
  // Coloring mode for the 14-day chart. Default "by-project" matches
  // the at-a-glance question users open Overview with ("where did my
  // time go this week?"). "task-vs-claude" gives the legacy stacked
  // split for the "how much was task-timer vs Claude outside" question.
  const [chartMode, setChartMode] = useState("by-project");

  // Project-segmented 14-day data (same algorithm /home uses for its
  // "This week" rail card; same buildWeekRecap helper so colors stay
  // consistent across pages).
  const weekRecap14 = useMemo(
    () => buildWeekRecap(content, { days: 14 }),
    [content]
  );

  // Adapt the active dataset into DeepWorkBars' { key, label, isToday,
  // totalMs, segments } shape. Both modes produce the same shape so
  // DeepWorkBars never has to know which mode it's rendering.
  const chartBars = useMemo(() => {
    if (chartMode === "by-project") {
      return weekRecap14.weekDays.map((d) => ({
        key: d.dayKey,
        // Day-of-month number to match the old DailyDeepChart label
        // convention. dayKey is YYYY-MM-DD so slice from position 8.
        label: d.dayKey.slice(8).replace(/^0/, ""),
        fullLabel: d.fullLabel,
        isToday: d.isToday,
        totalMs: d.focusedMs,
        // buildWeekRecap returns segments largest-first. Reverse for
        // DOM (first = visual top) so the LARGEST project anchors the
        // bottom of the bar — matches /home's segmentation convention.
        // Use s.color (softenColor result, ~45% toward white) so bar
        // fills feel muted at scale — same treatment /home uses for
        // its big "This week" bars. fullColor is kept on the segment
        // for future hover-resaturation if we ever add it here.
        segments: [...d.segments].reverse().map((s) => ({
          id: s.id || "unassigned",
          name: s.name,
          color: s.color || s.fullColor,
          ms: s.ms,
        })),
      }));
    }
    // Task-vs-Claude mode: use stats.dailyDeep, which already has
    // taskMs + claudeOutsideMs per day. Claude sits ABOVE task in the
    // visual stack (claude listed first in DOM order) — preserves the
    // historical reading of "task timer is the base, Claude outside is
    // additional time on top". Today gets greener tints to match the
    // existing .stats-daily-col.is-today CSS treatment.
    return stats.dailyDeep.map((b) => ({
      key: b.day,
      label: b.label,
      fullLabel: b.day,
      isToday: b.isToday,
      totalMs: b.totalMs,
      segments: [
        b.claudeOutsideMs > 0 && {
          id: "claude",
          name: "Claude (outside)",
          color: b.isToday ? "#7a9a7f" : "#4a5a70",
          ms: b.claudeOutsideMs,
        },
        b.taskMs > 0 && {
          id: "task",
          name: "Task timer",
          color: b.isToday ? "#5a7e5f" : "#8a6940",
          ms: b.taskMs,
        },
      ].filter(Boolean),
    }));
  }, [chartMode, weekRecap14, stats.dailyDeep]);

  const chartTotalMs = useMemo(
    () => chartBars.reduce((sum, b) => sum + b.totalMs, 0),
    [chartBars]
  );

  // Recent activity feed: 5 most recent Claude sessions across all
  // projects, flattened. Shows the AI-summary teaser inline. Bridges
  // the aggregate views (chart, cards) and the daily detail (heatmap)
  // — answers "what specifically have I been working on lately."
  const recentClaudeSessions = useMemo(() => {
    const projectMap = new Map((content?.projects || []).map((p) => [p.id, p]));
    return (content?.workSessions || [])
      .filter((s) => s.source === "claude_code")
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 5)
      .map((s) => ({
        id: s.id,
        projectName: projectMap.get(s.projectId)?.name || "Unassigned",
        projectColor: projectMap.get(s.projectId)?.color || null,
        activeMs: s.activeMs || 0,
        aiSummary: (s.aiSummary || "").trim(),
        startedAt: s.startedAt,
        completionCount: Array.isArray(s.completedTasks) ? s.completedTasks.length : 0,
      }));
  }, [content]);

  return (
    <>
      <TriageBanner count={stats.triageCount || 0} />

      <StatGrid
        variant="snapshot"
        columns={[
          { value: fmtDuration(stats.today.deep_work_ms), label: "Today" },
          { value: fmtDuration(stats.week.deep_work_ms), label: "Past 7 days" },
          { value: stats.currentStreak, label: "Day streak" },
          {
            value: stats.completionCounts ? stats.completionCounts.all : 0,
            label: "Tasks closed",
          },
          { value: fmtDuration(stats.all.deep_work_ms), label: "All-time" },
        ]}
      />

      {/* Headline chart — 14 days of focused time. Mode dropdown sits
          in the section title's meta slot (right side) following the
          same pattern as the heatmap's projectId selector. We hand-roll
          the section here instead of using <Section> because we need
          access to .home-section-title-row's right-side meta slot. */}
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Last 14 days</span>
          <span className="home-section-meta">
            <strong>{fmtDuration(chartTotalMs)}</strong> total
            <span className="home-section-meta-sep" aria-hidden="true">·</span>
            <select
              className="stats-heatmap-select"
              value={chartMode}
              onChange={(e) => setChartMode(e.target.value)}
              aria-label="Chart coloring mode"
            >
              <option value="by-project">By project</option>
              <option value="task-vs-claude">Task timer vs Claude</option>
            </select>
          </span>
        </h2>
        <DeepWorkBars bars={chartBars} />
        {chartMode === "task-vs-claude" && (
          <p className="stats-footnote">
            <span className="stats-swatch stats-swatch-task" /> Task timer (absorbs concurrent Claude)
            {"  "}
            <span className="stats-swatch stats-swatch-claude" /> Claude outside any task timer
          </p>
        )}
      </section>

      <Section title="By project">
        <ProjectGrid cards={stats.projectCards} />
      </Section>

      {/* Recent activity — last 5 Claude sessions with AI-summary
          teasers. Compact flat list (not grouped by project, since the
          By project section above already covers that view). For the
          full today's-grouped-by-project drill-down, see the Today tab
          and /home. */}
      <Section title="Recent activity">
        {recentClaudeSessions.length === 0 ? (
          <EmptyState
            variant="inline"
            message="No Claude sessions logged yet"
          />
        ) : (
          <ul className="stats-recent-list">
            {recentClaudeSessions.map((s) => (
              <li key={s.id} className="stats-recent-row">
                <span className="stats-recent-project">
                  <Dot color={s.projectColor || "rgba(0,0,0,0.25)"} size={8} />
                  {s.projectName}
                </span>
                <span className="stats-recent-duration">
                  {fmtDuration(s.activeMs)}
                  {s.completionCount > 0 && (
                    <span className="stats-recent-completions">
                      {" "}· ✓ {s.completionCount}
                    </span>
                  )}
                </span>
                <span className="stats-recent-summary">
                  {s.aiSummary || (
                    <span className="stats-recent-no-summary">—</span>
                  )}
                </span>
                <Tooltip content={new Date(s.startedAt).toLocaleString()}>
                  <span className="stats-recent-when">
                    <RelativeTime since={Date.parse(s.startedAt)} />
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Hour-of-day heatmap">
        <HeatmapGrid stats={stats} />
      </Section>

      <Section title="Focus streak">
        <StatGrid
          variant="default"
          columns={[
            {
              value: stats.currentStreak,
              label: stats.currentStreak === 1 ? "Day current" : "Days current",
            },
            {
              value: stats.all.pomos,
              label: "Total pomodoros",
            },
          ]}
        />
      </Section>

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

  // Hour-by-hour today: a 24-element row of {taskMs, claudeOutsideMs}
  // PLUS a parallel 24 × Map<projectId, ms> for the by-project mode.
  // We split sessions across hour boundaries with the same proportional-
  // interval slicing the heatmap uses, so a 14:50–15:20 session credits
  // the right hours.
  const hours = Array.from({ length: 24 }, () => ({ taskMs: 0, claudeOutsideMs: 0 }));
  const hoursByProject = Array.from({ length: 24 }, () => new Map());
  function distribute(startMs, endMs, totalMs, key, projectId) {
    if (endMs <= startMs || totalMs <= 0) return;
    const factor = totalMs / (endMs - startMs);
    let cursor = Math.max(startMs, todayStart);
    const stop = Math.min(endMs, todayEnd);
    while (cursor < stop) {
      const d = new Date(cursor);
      const hr = d.getHours();
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr + 1, 0, 0).getTime();
      const segEnd = Math.min(stop, next);
      const slice = (segEnd - cursor) * factor;
      hours[hr][key] += slice;
      const pm = hoursByProject[hr];
      pm.set(projectId, (pm.get(projectId) || 0) + slice);
      cursor = segEnd;
    }
  }
  for (const t of tt) distribute(t.start, t.end, t.durationMs, "taskMs", t.projectId || "");
  for (const c of cc) if (c.outsideMs > 0) distribute(c.start, c.end, c.outsideMs, "claudeOutsideMs", c.projectId || "");
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

  // Resolve project colors using shared helper so the same project
  // shows the same color on /home week recap, /stats Overview chart,
  // heatmap, and here on Today.
  const projectTotalsToday = new Map();
  for (const [pid, x] of byProjMap) {
    projectTotalsToday.set(pid, x.taskMs + (x.claudeMs - x.absorbedMs));
  }
  const projectColorsToday = resolveProjectColors(stats.projects || [], projectTotalsToday);

  const byProject = [...byProjMap.entries()]
    .map(([pid, x]) => {
      const baseColor = projectColorsToday.get(pid) || "rgba(0,0,0,0.25)";
      return {
        projectId: pid,
        label: projectName.get(pid) || "Unknown",
        taskMs: x.taskMs,
        claudeMs: x.claudeMs,
        claudeOutsideMs: x.claudeMs - x.absorbedMs,
        combinedMs: x.taskMs + (x.claudeMs - x.absorbedMs),
        sessions: x.sessions,
        // Softened palette color (~45% toward white) so per-project
        // bars feel muted at scale — same treatment /home week recap
        // and /stats Overview chart use.
        color: softenColor(baseColor, 0.45),
        fullColor: baseColor,
      };
    })
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
    hoursByProject,
    projectColorsToday,
    projectNamesToday: projectName,
    todayPomos: stats.today.pomos,
  };
}

function HourBar({ hours, max, mode = "task-vs-claude", hoursByProject, projectColors, projectNames }) {
  // 24-cell single row showing today's hour-by-hour intensity. Two modes:
  //   task-vs-claude  legacy: tan task bottom + slate claude top
  //   by-project      stacked project-colored bands per hour
  // Same parseColorRgb / alpha-by-intensity-times-share formula used by
  // the Overview heatmap so the two by-project views feel consistent.
  return (
    <div className="stats-hourbar">
      <div className="stats-hourbar-row">
        {hours.map((h, i) => {
          const total = h.taskMs + h.claudeOutsideMs;
          if (total === 0) {
            return (
              <Tooltip key={i} content={`${i}:00 — no activity`}>
                <span className="stats-hourbar-cell">
                  <span className="stats-hourbar-label">{i}</span>
                </span>
              </Tooltip>
            );
          }
          const intensity = total / max;
          let bg;
          let tip;
          if (mode === "by-project" && hoursByProject && projectColors) {
            // Per-project segments stacked top-to-bottom, sized by share.
            const segs = [...(hoursByProject[i] || new Map()).entries()]
              .filter(([, ms]) => ms > 0)
              .sort((a, b) => b[1] - a[1]);
            const stops = [];
            let cum = 0;
            for (const [pid, ms] of segs) {
              const rgb = parseColorRgb(projectColors.get(pid) || "#888888")
                || "136, 136, 136";
              const share = ms / total;
              const alpha = 0.25 + 0.7 * intensity * share;
              const start = (cum / total) * 100;
              cum += ms;
              const end = (cum / total) * 100;
              stops.push(`rgba(${rgb}, ${alpha}) ${start}%`);
              stops.push(`rgba(${rgb}, ${alpha}) ${end}%`);
            }
            bg = `linear-gradient(180deg, ${stops.join(", ")})`;
            tip = (
              <>
                <strong>{i}:00</strong> — {fmtDuration(total)}
                {segs.map(([pid, ms]) => (
                  <span key={pid}>
                    <br />
                    {projectNames?.get(pid) || "Unassigned"}: {fmtDuration(ms)}
                  </span>
                ))}
              </>
            );
          } else {
            // Legacy task-vs-claude stacked cell.
            const taskShare = h.taskMs / total;
            bg = `linear-gradient(180deg,
              rgba(74,90,112,${0.25 + 0.7 * intensity * (1 - taskShare)}) ${(1 - taskShare) * 100}%,
              rgba(138,105,64,${0.25 + 0.7 * intensity * taskShare}) ${(1 - taskShare) * 100}%)`;
            tip = (
              <>
                <strong>{i}:00</strong> — {fmtDuration(total)}
                <br />Task: {fmtDuration(h.taskMs)}
                <br />Claude (outside): {fmtDuration(h.claudeOutsideMs)}
              </>
            );
          }
          return (
            <Tooltip key={i} content={tip}>
              <span
                className="stats-hourbar-cell stats-hourbar-cell-active"
                style={{ background: bg }}
              >
                <span className="stats-hourbar-label">{i}</span>
              </span>
            </Tooltip>
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
  const totalPct = max ? (row.combinedMs / max) * 100 : 0;
  // Single project-colored bar (softened palette) — matches the
  // muted aesthetic of /home week recap + /stats Overview chart.
  // The task vs Claude split is still surfaced via the tooltip, and
  // the Claude work today drill-down below shows the per-session
  // detail. Bar background here is project color (~45% toward white).
  const tip = (
    <>
      <strong>{row.label}</strong> — {fmtDuration(row.combinedMs)} focused
      <br />Task timer: {fmtDuration(row.taskMs)}
      <br />Claude (outside): {fmtDuration(row.claudeOutsideMs)}
    </>
  );
  return (
    <div className="stats-today-project-row">
      <span className="stats-today-project-name">
        {row.color && <span className="stats-project-dot" style={{ background: row.fullColor || row.color }} />}
        {row.label}
      </span>
      <div className="stats-today-project-track">
        {row.combinedMs > 0 && (
          <Tooltip content={tip}>
            <div
              className="stats-today-project-bar"
              style={{
                width: `${totalPct}%`,
                background: row.color || "rgba(0,0,0,0.25)",
              }}
            />
          </Tooltip>
        )}
      </div>
      <span className="stats-today-project-val">
        {fmtDuration(row.combinedMs)}
        <span className="stats-breakdown-sub"> · {row.sessions} ses</span>
      </span>
    </div>
  );
}

function TodayTab({ stats, content }) {
  const t = useMemo(() => buildTodayData(stats), [stats]);
  const noActivity = t.deepMs === 0 && t.sessions.length === 0;
  const maxProjectMs = Math.max(1, ...t.byProject.map((r) => r.combinedMs));
  const deltaMin = Math.round(t.deepDelta / MS_PER_MIN);
  const deltaSign = deltaMin > 0 ? "+" : "";
  // Hour-by-hour coloring mode. Defaults to "by-project" to match the
  // Overview chart + heatmap default. Same dropdown shape as those.
  const [hourMode, setHourMode] = useState("by-project");

  // Today's Claude sessions grouped by project, ready to feed straight
  // into <ClaudeProjectBucket>. Same data shape and same component as
  // /history uses — drill down to see per-session AI summaries and
  // tasks completed during that project's work today.
  const todayStart = useMemo(() => todayStartMs(), []);
  const claudeBucketsToday = useMemo(
    () => buildClaudeBuckets(
      content?.workSessions || [],
      content?.projects || [],
      { since: todayStart, until: todayStart + MS_PER_DAY }
    ),
    [content, todayStart]
  );

  if (noActivity) {
    return (
      <Section title="Today">
        <EmptyState variant="inline" message="No work sessions logged yet today" />
        <p className="stats-footnote">
          Sessions populate as the hourly importer picks up new Claude transcripts
          and as task timers run. Yesterday: {fmtDuration(t.yDeepMs)} total deep work.
        </p>
      </Section>
    );
  }

  return (
    <>
      <StatGrid
        variant="snapshot"
        columns={[
          {
            value: fmtDuration(t.deepMs),
            label: "Deep work",
            delta: t.yDeepMs > 0 || t.deepMs > 0
              ? {
                  sign: deltaMin > 0 ? "up" : deltaMin < 0 ? "down" : "neutral",
                  label: deltaMin === 0
                    ? "same as yesterday"
                    : `${deltaSign}${deltaMin}m vs yesterday`,
                }
              : null,
          },
          { value: t.sessions.length, label: "Sessions" },
          { value: t.todayPomos, label: "Pomodoros" },
          {
            value: t.sessions.length
              ? fmtDuration(Math.round(t.deepMs / t.sessions.length))
              : "—",
            label: "Avg / session",
          },
        ]}
      />

      {/* Hour-by-hour — same mode toggle as the Overview chart/heatmap.
          Section title doubles as a flex row holding the dropdown
          (using .home-section-title-row pattern, matching the rest of
          the app's section-with-meta idiom). */}
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Hour by hour</span>
          <span className="home-section-meta">
            <select
              className="stats-heatmap-select"
              value={hourMode}
              onChange={(e) => setHourMode(e.target.value)}
              aria-label="Hour-by-hour coloring mode"
            >
              <option value="by-project">By project</option>
              <option value="task-vs-claude">Task timer vs Claude</option>
            </select>
          </span>
        </h2>
        <HourBar
          hours={t.hours}
          max={t.hoursMax}
          mode={hourMode}
          hoursByProject={t.hoursByProject}
          projectColors={t.projectColorsToday}
          projectNames={t.projectNamesToday}
        />
        {hourMode === "task-vs-claude" && (
          <p className="stats-footnote">
            <span className="stats-swatch stats-swatch-task" /> Task timer{" "}
            <span className="stats-swatch stats-swatch-claude" /> Claude outside any task timer.
            Hover any hour cell for the breakdown.
          </p>
        )}
      </section>

      <Section title="By project — today">
        {t.byProject.length === 0 ? (
          <EmptyState variant="inline" message="No project activity yet today" />
        ) : (
          <div className="stats-today-project-list">
            {t.byProject.map((r) => (
              <TodayProjectRow key={r.label} row={r} max={maxProjectMs} />
            ))}
          </div>
        )}
      </Section>

      {/* Drill-down: today's Claude sessions grouped by project, with
          AI summaries + tasks completed inside each bucket. Same
          component /history + /home use, so the interaction matches
          across the app. */}
      <Section title="Claude work today — by project">
        {claudeBucketsToday.length === 0 ? (
          <EmptyState
            variant="inline"
            message="No Claude sessions logged yet today"
          />
        ) : (
          <div className="stats-today-claude-buckets">
            {claudeBucketsToday.map((bucket) => (
              <ClaudeProjectBucket key={bucket.projectId} bucket={bucket} />
            ))}
          </div>
        )}
      </Section>

      {/* Lower-frequency drill-downs collapsed by default so they don't
          dilute the at-a-glance view above. Chronological session list
          and tag breakdown both still useful, just not what you open
          Today to look at first. The Detail MetricTable (Today/Yesterday
          × 6 rows) that used to live here was dropped — the Yesterday
          column was mostly empty placeholders. */}
      <Section title="More">
        <Collapsible summary="Sessions today — chronological">
          {t.sessions.length === 0 ? (
            <EmptyState variant="inline" message="No sessions logged today" />
          ) : (
            <ul className="stats-today-session-list">
              {t.sessions.map((s, i) => (
                <TodaySessionRow key={i} s={s} />
              ))}
            </ul>
          )}
        </Collapsible>
        <Collapsible summary="By tag — today">
          <BreakdownBars
            rows={t.tags.slice(0, 12)}
            formatRight={(v) => fmtDuration(v)}
            emptyMsg="No tags on today's sessions."
          />
        </Collapsible>
      </Section>
    </>
  );
}

function FocusTab({ stats }) {
  return (
    <>
      <StatGrid
        variant="snapshot"
        columns={[
          { value: stats.today.pomos, label: "Pomos today" },
          { value: stats.week.pomos, label: "Past 7 days" },
          { value: stats.currentStreak, label: "Day streak" },
          { value: stats.all.pomos, label: "All-time" },
        ]}
      />

      <Section title="Detail">
        <MetricTable
          headers={["Today", "Past 7 days", "All-time"]}
          rows={[
            {
              label: "Focus time (task timer)",
              cells: [
                fmtDuration(stats.today.task_ms),
                fmtDuration(stats.week.task_ms),
                fmtDuration(stats.all.task_ms),
              ],
            },
            {
              label: "Pomodoros",
              cells: [stats.today.pomos, stats.week.pomos, stats.all.pomos],
            },
            {
              label: "Avg pomo length",
              cells: [
                stats.today.pomos
                  ? fmtDuration(Math.round(stats.today.task_ms / stats.today.pomos))
                  : "—",
                stats.week.pomos
                  ? fmtDuration(Math.round(stats.week.task_ms / stats.week.pomos))
                  : "—",
                stats.all.pomos
                  ? fmtDuration(Math.round(stats.all.task_ms / stats.all.pomos))
                  : "—",
              ],
            },
          ]}
        />
      </Section>

      <Section title="Focus streak">
        <StatGrid
          variant="default"
          columns={[
            {
              value: stats.currentStreak,
              label: stats.currentStreak === 1 ? "Day current" : "Days current",
            },
          ]}
        />
      </Section>

      <Section title="Focus time by project — all time">
        <BreakdownBars
          rows={stats.focusByProject}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No task-timer sessions yet."
        />
      </Section>
    </>
  );
}

function ClaudeTab({ stats }) {
  return (
    <>
      <StatGrid
        variant="snapshot"
        columns={[
          { value: stats.today.claude_sessions, label: "Sessions today" },
          { value: stats.week.claude_sessions, label: "Past 7 days" },
          { value: fmtDuration(stats.all.claude_total_ms), label: "All-time active" },
          {
            value: stats.all.claude_sessions
              ? Math.round(stats.all.claude_msgs / stats.all.claude_sessions)
              : 0,
            label: "Avg msgs/session",
          },
        ]}
      />

      <Section title="Detail">
        <MetricTable
          headers={["Today", "Past 7 days", "All-time"]}
          rows={[
            {
              label: "Sessions",
              cells: [
                stats.today.claude_sessions,
                stats.week.claude_sessions,
                stats.all.claude_sessions,
              ],
            },
            {
              label: "Active time",
              cells: [
                fmtDuration(stats.today.claude_total_ms),
                fmtDuration(stats.week.claude_total_ms),
                fmtDuration(stats.all.claude_total_ms),
              ],
            },
            {
              label: "Msgs / session",
              cells: [
                stats.today.claude_sessions
                  ? Math.round(stats.today.claude_msgs / stats.today.claude_sessions)
                  : 0,
                stats.week.claude_sessions
                  ? Math.round(stats.week.claude_msgs / stats.week.claude_sessions)
                  : 0,
                stats.all.claude_sessions
                  ? Math.round(stats.all.claude_msgs / stats.all.claude_sessions)
                  : 0,
              ],
            },
          ]}
        />
      </Section>

      <Section title="Claude time by project — all time">
        <ClaudeProjectRows rows={stats.claudeByProject} />
      </Section>

      <Section title="Claude time by tag — top 15">
        <BreakdownBars
          rows={stats.claudeByTag.slice(0, 15)}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No tags yet."
        />
      </Section>

      <Section title="Recent Claude sessions">
        <RecentClaudeList rows={stats.recentClaude} />
      </Section>
    </>
  );
}

function TasksTab({ stats }) {
  const c = stats.completionCounts;
  const peakDaily = Math.max(...stats.dailyCompletions.map((d) => d.count), 1);
  return (
    <>
      {/* Stats #1: Shipped headline at top of tab — matches the snapshot
          strip pattern used by Overview/Today/Focus/Claude tabs. */}
      <StatGrid
        variant="snapshot"
        columns={[
          { value: c.today, label: "Today" },
          { value: c.week, label: "Past 7 days" },
          { value: c.all, label: "All-time shipped" },
        ]}
      />

      {/* Stats #2: Daily completion velocity (14 days) */}
      <Section title="Completion velocity — last 14 days">
        <div className="stats-velocity-bars">
          {stats.dailyCompletions.map((d) => {
            const heightPct = (d.count / peakDaily) * 100;
            return (
              <Tooltip
                key={d.day}
                content={`${d.day} — ${d.count} completed`}
              >
                <div
                  className={`stats-velocity-col${d.isToday ? " is-today" : ""}${d.count > 0 ? " has-any" : ""}`}
                >
                  <div className="stats-velocity-bar-wrap">
                    <div
                      className="stats-velocity-bar"
                      style={{ height: `${Math.max(3, heightPct)}%` }}
                    />
                  </div>
                  <div className="stats-velocity-count">
                    {d.count > 0 ? d.count : ""}
                  </div>
                </div>
              </Tooltip>
            );
          })}
        </div>
      </Section>

      {/* Stats #3: Completions by project */}
      <Section title="Tasks shipped by project">
        {stats.completionsByProject.length === 0 ? (
          <EmptyState variant="inline" message="No completions recorded yet" />
        ) : (
          <BreakdownBars
            rows={stats.completionsByProject.map((p) => ({
              label: p.name,
              value: p.count,
              color: p.color,
            }))}
            formatRight={(v) => `${v}`}
            emptyMsg="No completions yet."
          />
        )}
      </Section>

      {/* Stats #5: Focus time per completion (project-level) */}
      {stats.focusPerCompletion.length > 0 && (
        <Section title="Focus hours per completed task">
          <ul className="stats-fpc-list">
            {stats.focusPerCompletion.map((p) => (
              <li key={p.projectId} className="stats-fpc-row">
                <span className="stats-fpc-dot" style={{ background: p.color }} />
                <span className="stats-fpc-name">{p.name}</span>
                <span className="stats-fpc-ratio">
                  {fmtDuration(p.msPerCompletion)} <span className="stats-fpc-unit">/ task</span>
                </span>
                <span className="stats-fpc-detail">
                  {fmtDuration(p.focusMs)} · {p.count} done
                </span>
              </li>
            ))}
          </ul>
          <p className="stats-footnote">
            Only projects with ≥3 completions shown — lower = more efficient
            shipping (caveat: tasks vary in scope).
          </p>
        </Section>
      )}

      {/* Stats #4: Recent completions feed */}
      <Section title="Recent completions">
        {stats.recentCompletions.length === 0 ? (
          <EmptyState variant="inline" message="No completions yet" />
        ) : (
          <ul className="stats-recent-list">
            {stats.recentCompletions.map((c, i) => (
              <li key={i} className="stats-recent-row">
                <span className="stats-recent-dot" style={{ background: c.color }} />
                <span className="stats-recent-subject">{c.subject}</span>
                <span className="stats-recent-project">{c.projectName}</span>
                <span className="stats-recent-when">
                  {c.completedAt ? new Date(c.completedAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric"
                  }) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tasks by project — current">
        <ProjectTaskSplit rows={stats.tasksByProject} />
        <p className="stats-footnote">
          Open <span className="stats-swatch stats-swatch-open" /> / Done <span className="stats-swatch stats-swatch-done" />{" "}
          · "AI-assist" = % of focus time that overlapped a Claude session in the same project.
        </p>
      </Section>

      <Section title="Open tasks by tag — top 15">
        <BreakdownBars
          rows={stats.tasksByTag.slice(0, 15)}
          formatRight={(v) => v}
          emptyMsg="No tags on open tasks."
        />
      </Section>

      <section className="stats-footer">
        <p className="stats-footnote">
          {stats.tasksOpen} open · {stats.taskHistoryCount} in app history (manual /todo
          completions). Top of this tab shows the much larger Claude-session-derived
          completion record.
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

/* Snapshot freshness indicator used in the PageHeader actions slot.
   Replaces the previous custom interval-tick + relative-time formatting
   with the shared RelativeTime component. */
function SnapshotIndicator({ loadedAtMs }) {
  return (
    <div className="stats-snapshot">
      <span className="stats-snapshot-label">
        Loaded <RelativeTime since={loadedAtMs} />
      </span>
      <Tooltip content="Reload to fetch the latest data from the server">
        <button
          type="button"
          className="stats-snapshot-refresh"
          onClick={() => window.location.reload()}
        >
          ↻ refresh
        </button>
      </Tooltip>
    </div>
  );
}

/* StatsSkeleton — matches the real page's structural skeleton so the
   eye lands in the right place when content arrives. Title chip row,
   tab bar with 5 placeholder pills, and 3 section frames. */
function Skel({ w, h, style }) {
  return (
    <div
      className="skel"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
        ...style,
      }}
    />
  );
}

function StatsSkeleton() {
  return (
    <main className="stats-page" aria-busy="true" aria-label="Loading stats">
      <header className="ui-page-header">
        <div className="ui-page-header-top">
          <Skel w={80} h={36} />
          <Skel w={180} h={20} />
        </div>
      </header>
      <div className="ui-tabs" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skel key={i} w={70} h={28} style={{ marginRight: 4 }} />
        ))}
      </div>
      <div className="stats-tab-body">
        {[0, 1, 2].map((i) => (
          <section className="home-section" key={i}>
            <Skel w={140} h={14} style={{ marginBottom: 16 }} />
            <Skel w="100%" h={80} />
          </section>
        ))}
      </div>
    </main>
  );
}

export default function StatsPage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);
  // Read ?tab= from URL on mount so deep-links from /home (and elsewhere)
  // open the right tab. Valid tab ids come from TABS — invalid falls back
  // to overview.
  const [tab, setTab] = useState(() => {
    const urlTab = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((t) => t.id === urlTab) ? urlTab : "overview";
  });
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
    return <StatsSkeleton />;
  }

  return (
    <main className="stats-page">
      <PageHeader
        title="Stats"
        actions={<SnapshotIndicator loadedAtMs={loadedAtMs} />}
        chips={[
          <span key="all">
            <strong>{fmtDuration(stats.all.deep_work_ms)}</strong> total deep work
          </span>,
          stats.currentStreak >= 1 && (
            <span key="streak">
              <strong>{stats.currentStreak}</strong> day streak
            </span>
          ),
          stats.completionCounts && stats.completionCounts.all > 0 && (
            <span key="ship">
              <strong>{stats.completionCounts.all}</strong> tasks shipped
            </span>
          ),
        ].filter(Boolean)}
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="stats-tab-body">
        {tab === "overview" && <OverviewTab stats={stats} content={content} />}
        {tab === "today" && <TodayTab stats={stats} content={content} />}
        {tab === "focus" && <FocusTab stats={stats} />}
        {tab === "claude" && <ClaudeTab stats={stats} />}
        {tab === "tasks" && <TasksTab stats={stats} />}
      </div>
    </main>
  );
}
