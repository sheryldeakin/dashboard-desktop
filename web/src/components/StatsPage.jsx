import { useEffect, useMemo, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
  requestManualSync,
  fetchRemoteContentSnapshot,
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
      startedAt: ws.startedAt,
      durationMs: ws.activeMs || Math.max(0, end - start),
      projectId: ws.projectId,
      tags: ws.tags || [],
      messageCount: ws.messageCount || 0,
      id: ws.id,
      transcriptId: ws.transcriptId,
      cwd: ws.cwd,
      // Carried for project-card "last activity" summary line.
      aiSummary: ws.aiSummary || "",
      // Per-session task closures (from TaskCreate/TaskUpdate tool calls
      // parsed at import time). Used by the Claude tab to flag sessions
      // that actually shipped something.
      completedTaskCount: Array.isArray(ws.completedTasks) ? ws.completedTasks.length : 0,
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

  // Pomo → project lookup. Each focusPomo has a taskId pointing at a
  // task that may or may not still exist in content.todaysTasks. We
  // also need to walk content.taskHistory so historical pomos (whose
  // tasks have rotated off) still resolve to the right project.
  // Returns "" (unassigned) when the taskId can't be found anywhere.
  const taskProjectByTaskId = new Map();
  for (const t of content.todaysTasks || []) {
    if (t.id && t.projectId) taskProjectByTaskId.set(t.id, t.projectId);
  }
  for (const t of content.taskHistory || []) {
    // taskHistory entries can have `sourceTaskId` or `id` depending on
    // when they were written. Cover both so older history rows still
    // resolve.
    const tid = t.sourceTaskId || t.id;
    if (tid && t.projectId && !taskProjectByTaskId.has(tid)) {
      taskProjectByTaskId.set(tid, t.projectId);
    }
  }
  function projectForPomo(pomoEntry) {
    return taskProjectByTaskId.get(pomoEntry.taskId) || "";
  }

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

  // ── Claude tab: 14-day daily activity chart ─────────────────────────
  // Same shape as focusDaily14: per-day { dayKey, dayStart, sessionCount,
  // activeMs, byProject, isToday }. byProject maps projectId → ms for
  // the project-color segmented bars. Walks the `claude` intervals
  // (already filtered to claude_code source + projectId/messageCount
  // attached).
  const claudeDaily14 = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = todayMs - i * MS_PER_DAY;
      days.push({
        dayKey: ymd(new Date(dayStart)),
        dayStart,
        sessionCount: 0,
        activeMs: 0,
        byProject: new Map(),
        isToday: i === 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.dayKey, d]));
    for (const c of claude) {
      const key = ymd(new Date(c.start));
      const slot = byKey.get(key);
      if (!slot) continue;
      slot.sessionCount += 1;
      slot.activeMs += c.durationMs;
      const pid = c.projectId || "";
      slot.byProject.set(pid, (slot.byProject.get(pid) || 0) + c.durationMs);
    }
    return days;
  })();

  // ── Claude tab: theme tags from AI summaries (last 7 days) ──────────
  // Lightweight word-frequency on aiSummary text. Filters stopwords +
  // short words + common verb forms so the top entries surface actual
  // topics ("debug", "styling", "refactor") rather than noise ("the",
  // "and", "for"). Top 12 returned. Skipped entirely if no summaries
  // in window — empty list lets the renderer hide the section.
  const claudeThemes = (() => {
    const cutoff = Date.now() - 7 * MS_PER_DAY;
    const STOPWORDS = new Set([
      "this", "that", "with", "from", "into", "have", "been", "were",
      "they", "them", "your", "what", "when", "which", "while", "after",
      "before", "would", "could", "should", "their", "there", "where",
      "also", "than", "then", "some", "more", "most", "such", "only",
      "user", "users", "session", "sessions", "claude", "code",
      "added", "removed", "made", "make", "made", "doing", "done",
      "using", "used", "will", "just", "like", "able", "lots",
      "task", "tasks", "files", "file", "thing", "things",
      "still", "really", "actually", "back", "next", "first",
      "much", "many", "well", "good", "want", "wants", "ask", "asked",
      "talk", "talked", "say", "said", "tell", "told", "see", "look",
      "looking", "looked", "show", "showed", "shown", "asked", "ran",
    ]);
    const counts = new Map();
    for (const c of claude) {
      if (c.start < cutoff) continue;
      const summary = (c.aiSummary || "").toLowerCase();
      if (!summary) continue;
      // Match runs of letters/digits, ≥4 chars (drops "the", "and", "of"
      // before they even hit the stopword set).
      const words = summary.match(/[a-z][a-z0-9-]{3,}/g) || [];
      for (const w of words) {
        if (STOPWORDS.has(w)) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2) // need at least 2 occurrences to count as a theme
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([word, count]) => ({ word, count }));
  })();

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

  // ── Focus tab: daily focus (14 days) + streak calendar (90 days) ─────
  // Both walk focusPomos and bucket by local date. For per-project
  // segments we use the projectForPomo helper above (which checks
  // todaysTasks first, then taskHistory) so pomos on rotated-off
  // tasks still attribute correctly.
  const focusDaily14 = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = todayMs - i * MS_PER_DAY;
      days.push({
        dayKey: ymd(new Date(dayStart)),
        dayStart,
        pomoCount: 0,
        focusMs: 0,
        byProject: new Map(),
        isToday: i === 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.dayKey, d]));
    for (const p of focusPomos) {
      const pStart = Date.parse(p.startedAt);
      if (!Number.isFinite(pStart)) continue;
      const key = ymd(new Date(pStart));
      const slot = byKey.get(key);
      if (!slot) continue;
      slot.pomoCount += 1;
      slot.focusMs += p.durationMs || 0;
      const pid = projectForPomo(p);
      slot.byProject.set(pid, (slot.byProject.get(pid) || 0) + (p.durationMs || 0));
    }
    return days;
  })();

  // Streak calendar: 91 cells (13 weeks × 7 days). Newest week is the
  // current week ending today (Saturday→Friday in the order the user's
  // locale prefers — we'll lay out by day-of-week in render). Returns
  // a flat array of { dayKey, dayStart, pomoCount, focusMs, isToday,
  // hasActivity }; the renderer slots them into a 2D grid.
  const focusCalendar90 = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const days = [];
    for (let i = 90; i >= 0; i--) {
      const dayStart = todayMs - i * MS_PER_DAY;
      days.push({
        dayKey: ymd(new Date(dayStart)),
        dayStart,
        dow: new Date(dayStart).getDay(),
        pomoCount: 0,
        focusMs: 0,
        isToday: i === 0,
        hasActivity: false,
      });
    }
    const byKey = new Map(days.map((d) => [d.dayKey, d]));
    for (const p of focusPomos) {
      const pStart = Date.parse(p.startedAt);
      if (!Number.isFinite(pStart)) continue;
      const key = ymd(new Date(pStart));
      const slot = byKey.get(key);
      if (!slot) continue;
      slot.pomoCount += 1;
      slot.focusMs += p.durationMs || 0;
      slot.hasActivity = true;
    }
    return days;
  })();

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
      // Project color via the same resolution logic used elsewhere.
      // Lets the new .stats-recent-row layout show the project dot.
      projectColor: projectColor.get(c.projectId) || null,
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

  // Hours-per-completion ratio per project — DEEP-WORK time spent vs
  // tasks shipped. Deep work = task_timer + claude_outside (time NOT
  // absorbed by a task timer, to avoid double-count). Using just
  // task_timer was wrong for Sheryl's workflow: nearly all task closures
  // come from Claude TaskUpdate calls, with task_timer time concentrated
  // on a single Inbox task — so a task_timer-only denominator made the
  // entire section disappear via the focus-time filter. Including
  // claude_outside surfaces "deep work hours per task shipped" which
  // is the real productivity question.
  const deepMsByProject = new Map();
  for (const [pid, ms] of focusByProjectMap) {
    deepMsByProject.set(pid, ms);
  }
  // Add per-project claude_outside ms. claudeByProjectMap stores
  // total Claude ms, but for deep work we want outside-of-task-timer
  // ms only, so walk the claude intervals directly.
  for (const c of claude) {
    const pid = c.projectId || "";
    deepMsByProject.set(pid, (deepMsByProject.get(pid) || 0) + (c.outsideMs || 0));
  }
  const focusPerCompletion = completionsByProject
    .filter((p) => p.count >= 1)
    .map((p) => {
      const ms = deepMsByProject.get(p.projectId) || 0;
      return {
        ...p,
        focusMs: ms,
        msPerCompletion: p.count > 0 ? ms / p.count : 0,
      };
    })
    .filter((p) => p.focusMs >= MS_PER_MIN) // skip projects with no real deep work
    .sort((a, b) => a.msPerCompletion - b.msPerCompletion); // most efficient first

  // Quick session lookup: id → {aiSummary, source} so the Tasks tab
  // Recent completions list can show what was happening when the task
  // was closed AND whether the closure was Claude-assisted (used by
  // both the AI-summary inline and the Claude-share stat below).
  const sessionMeta = new Map();
  for (const ws of content.workSessions || []) {
    if (!ws.id) continue;
    sessionMeta.set(ws.id, {
      aiSummary: typeof ws.aiSummary === "string" ? ws.aiSummary.trim() : "",
      source: ws.source || "",
    });
  }

  // Recent completions feed — flat list of last 50 with project
  // resolution + AI summary from the source session. The aiSummary
  // gives "what was happening when this was closed" context.
  const recentCompletions = allCompletions.slice(0, 50).map((c) => {
    const meta = sessionMeta.get(c.sessionId);
    return {
      ...c,
      projectName: projectName.get(c.projectId) || "Unassigned",
      color: projectColor.get(c.projectId),
      aiSummary: meta?.aiSummary || "",
      claudeAssisted: meta?.source === "claude_code",
    };
  });

  // 14-day completion velocity with project segments. Shape mirrors
  // focusDaily14 / claudeDaily14 so DailyStackedBars renders it the
  // same way — only the value unit differs (count vs ms). byProject
  // is Map<projectId, count> here, not Map<projectId, ms>.
  const completionsDaily14 = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = todayMs - i * MS_PER_DAY;
      days.push({
        dayKey: ymd(new Date(dayStart)),
        dayStart,
        count: 0,
        byProject: new Map(),
        isToday: i === 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.dayKey, d]));
    for (const c of allCompletions) {
      const t = Date.parse(c.completedAt);
      if (!Number.isFinite(t)) continue;
      const key = ymd(new Date(t));
      const slot = byKey.get(key);
      if (!slot) continue;
      slot.count += 1;
      const pid = c.projectId || "";
      slot.byProject.set(pid, (slot.byProject.get(pid) || 0) + 1);
    }
    return days;
  })();

  // "Tasks-closed-via-Claude" split: of the completions in each
  // window, what fraction happened during a claude_code session?
  // Shows up as a muted comparison line under the Tasks snapshot.
  function claudeShareSince(startMs) {
    let total = 0;
    let claude = 0;
    for (const c of allCompletions) {
      const t = Date.parse(c.completedAt);
      if (!Number.isFinite(t) || t < startMs) continue;
      total += 1;
      if (sessionMeta.get(c.sessionId)?.source === "claude_code") claude += 1;
    }
    return total > 0 ? { total, claude, pct: Math.round((claude / total) * 100) } : null;
  }
  const completionsByClaudeShare = {
    today: claudeShareSince(todayStart),
    week: claudeShareSince(weekStart),
    all: (() => {
      let claude = 0;
      for (const c of allCompletions) {
        if (sessionMeta.get(c.sessionId)?.source === "claude_code") claude += 1;
      }
      const total = allCompletions.length;
      return total > 0 ? { total, claude, pct: Math.round((claude / total) * 100) } : null;
    })(),
  };

  // ── Token usage (Claude Max efficiency / volume tracking) ──────────
  // Sums across content.workSessions where source === "claude_code".
  // Each session's `tokens` field has { input, output, cacheCreation,
  // cacheRead }; we aggregate by window + per-day + per-project so the
  // Trends tab can surface callouts + chart + per-project list + cache
  // ratio sparkline.
  const tokenTotalsByWindow = (() => {
    const wkStart = Date.now() - 7 * MS_PER_DAY;
    const sum = { all: { i: 0, o: 0, cc: 0, cr: 0, n: 0 },
                  week: { i: 0, o: 0, cc: 0, cr: 0, n: 0 } };
    for (const ws of content.workSessions || []) {
      if (ws.source !== "claude_code") continue;
      const t = ws.tokens || {};
      const i = t.input || 0;
      const o = t.output || 0;
      const cc = t.cacheCreation || 0;
      const cr = t.cacheRead || 0;
      if (i === 0 && o === 0 && cc === 0 && cr === 0) continue;
      sum.all.i += i; sum.all.o += o; sum.all.cc += cc; sum.all.cr += cr; sum.all.n += 1;
      const start = Date.parse(ws.startedAt);
      if (Number.isFinite(start) && start >= wkStart) {
        sum.week.i += i; sum.week.o += o; sum.week.cc += cc; sum.week.cr += cr; sum.week.n += 1;
      }
    }
    function withDerived(w) {
      const inputSide = w.i + w.cc + w.cr;
      return {
        ...w,
        totalAll: w.i + w.o + w.cc + w.cr,
        cacheHitPct: inputSide > 0 ? Math.round((w.cr / inputSide) * 100) : 0,
        avgPerSession: w.n > 0 ? Math.round((w.i + w.o + w.cc + w.cr) / w.n) : 0,
      };
    }
    return { all: withDerived(sum.all), week: withDerived(sum.week) };
  })();

  // 14-day daily tokens — stacked by project. byProject value is total
  // tokens (i + o + cc + cr) for that day for that project. Also store
  // per-day cache-hit ratio so the sparkline can render directly.
  const tokensDaily14 = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const days = [];
    for (let k = 13; k >= 0; k--) {
      const dayStart = todayMs - k * MS_PER_DAY;
      days.push({
        dayKey: ymd(new Date(dayStart)),
        dayStart,
        total: 0,
        i: 0, o: 0, cc: 0, cr: 0,
        byProject: new Map(),
        isToday: k === 0,
        cacheHitPct: 0,
      });
    }
    const byKey = new Map(days.map((d) => [d.dayKey, d]));
    for (const ws of content.workSessions || []) {
      if (ws.source !== "claude_code") continue;
      const t = ws.tokens || {};
      const total = (t.input || 0) + (t.output || 0) + (t.cacheCreation || 0) + (t.cacheRead || 0);
      if (total === 0) continue;
      const start = Date.parse(ws.startedAt);
      if (!Number.isFinite(start)) continue;
      const key = ymd(new Date(start));
      const slot = byKey.get(key);
      if (!slot) continue;
      slot.total += total;
      slot.i += t.input || 0;
      slot.o += t.output || 0;
      slot.cc += t.cacheCreation || 0;
      slot.cr += t.cacheRead || 0;
      const pid = ws.projectId || "";
      slot.byProject.set(pid, (slot.byProject.get(pid) || 0) + total);
    }
    for (const d of days) {
      const inputSide = d.i + d.cc + d.cr;
      d.cacheHitPct = inputSide > 0 ? Math.round((d.cr / inputSide) * 100) : 0;
    }
    return days;
  })();

  // Per-project totals — top by total tokens. Carries cache-hit ratio
  // for the project so the list can show efficiency per project too.
  const tokensByProject = (() => {
    const map = new Map();
    for (const ws of content.workSessions || []) {
      if (ws.source !== "claude_code") continue;
      const t = ws.tokens || {};
      const i = t.input || 0, o = t.output || 0, cc = t.cacheCreation || 0, cr = t.cacheRead || 0;
      if (i + o + cc + cr === 0) continue;
      const pid = ws.projectId || "";
      let slot = map.get(pid);
      if (!slot) {
        slot = { projectId: pid, i: 0, o: 0, cc: 0, cr: 0, sessions: 0 };
        map.set(pid, slot);
      }
      slot.i += i; slot.o += o; slot.cc += cc; slot.cr += cr;
      slot.sessions += 1;
    }
    return [...map.values()]
      .map((s) => {
        const inputSide = s.i + s.cc + s.cr;
        return {
          ...s,
          name: projectName.get(s.projectId) || "Unassigned",
          color: projectColor.get(s.projectId) || null,
          total: s.i + s.o + s.cc + s.cr,
          cacheHitPct: inputSide > 0 ? Math.round((s.cr / inputSide) * 100) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  })();

  // ── Trends tab ──────────────────────────────────────────────────────
  // Patterns surfaced across all-time data (or rolling windows). Each
  // block walks workSessions / allCompletions once and aggregates into
  // the shape the Trends tab renders. Kept inline in computeStats so
  // it shares the same projectName / projectColor maps.

  // Day-of-week buckets — avg deep ms per ACTIVE day of that DoW
  // (so a single Tuesday with a marathon session doesn't make Tuesdays
  // look high if you only worked one Tuesday ever; we divide by the
  // count of distinct active days, not the count of weeks).
  const dowBuckets = Array.from({ length: 7 }, () => ({
    totalDeepMs: 0,
    totalCompletions: 0,
    activeDayKeys: new Set(),
  }));
  for (const ws of content.workSessions || []) {
    const start = Date.parse(ws.startedAt);
    if (!Number.isFinite(start)) continue;
    const d = new Date(start);
    const dow = d.getDay();
    const activeMs = ws.activeMs || 0;
    if (activeMs <= 0) continue;
    dowBuckets[dow].totalDeepMs += activeMs;
    dowBuckets[dow].activeDayKeys.add(ymd(d));
  }
  for (const c of allCompletions) {
    const t = Date.parse(c.completedAt);
    if (!Number.isFinite(t)) continue;
    const dow = new Date(t).getDay();
    dowBuckets[dow].totalCompletions += 1;
  }
  const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeekStats = dowBuckets.map((b, i) => ({
    label: DOW_SHORT[i],
    labelFull: DOW_FULL[i],
    dow: i,
    activeDays: b.activeDayKeys.size,
    avgDeepMs: b.activeDayKeys.size > 0 ? Math.round(b.totalDeepMs / b.activeDayKeys.size) : 0,
    avgCompletions: b.activeDayKeys.size > 0 ? b.totalCompletions / b.activeDayKeys.size : 0,
    totalCompletions: b.totalCompletions,
  }));

  // Workday rhythm — per-day first/last session times averaged across
  // every day with any activity. avgSessionDurationMs uses total
  // sessions in the denominator (so it's a true session-length avg, not
  // a per-day average).
  const dayMap = new Map();
  for (const ws of content.workSessions || []) {
    const start = Date.parse(ws.startedAt);
    const end = Date.parse(ws.endedAt) || start;
    if (!Number.isFinite(start)) continue;
    const dayKey = ymd(new Date(start));
    let slot = dayMap.get(dayKey);
    if (!slot) {
      slot = { firstMs: start, lastMs: end, sessionCount: 0, totalActiveMs: 0 };
      dayMap.set(dayKey, slot);
    }
    if (start < slot.firstMs) slot.firstMs = start;
    if (end > slot.lastMs) slot.lastMs = end;
    slot.sessionCount += 1;
    slot.totalActiveMs += ws.activeMs || 0;
  }
  let sumStartMins = 0, sumEndMins = 0, sumSessions = 0, sumActiveMs = 0;
  for (const [, slot] of dayMap) {
    const startD = new Date(slot.firstMs);
    const endD = new Date(slot.lastMs);
    sumStartMins += startD.getHours() * 60 + startD.getMinutes();
    sumEndMins += endD.getHours() * 60 + endD.getMinutes();
    sumSessions += slot.sessionCount;
    sumActiveMs += slot.totalActiveMs;
  }
  const totalActiveDays = dayMap.size;
  const workdayRhythm = totalActiveDays > 0 ? {
    avgStartMin: Math.round(sumStartMins / totalActiveDays),
    avgEndMin: Math.round(sumEndMins / totalActiveDays),
    avgSessionsPerDay: Math.round((sumSessions / totalActiveDays) * 10) / 10,
    avgSessionDurationMs: sumSessions > 0 ? Math.round(sumActiveMs / sumSessions) : 0,
    totalDays: totalActiveDays,
  } : null;

  // Hot projects — last 7 days share of total active ms.
  const sevenDaysAgo = Date.now() - 7 * MS_PER_DAY;
  const hotProjMap = new Map();
  let weekTotalMs = 0;
  for (const ws of content.workSessions || []) {
    const start = Date.parse(ws.startedAt);
    if (!Number.isFinite(start) || start < sevenDaysAgo) continue;
    const pid = ws.projectId || "";
    const ms = ws.activeMs || 0;
    hotProjMap.set(pid, (hotProjMap.get(pid) || 0) + ms);
    weekTotalMs += ms;
  }
  const hotProjects7d = [...hotProjMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([pid, ms]) => ({
      projectId: pid,
      name: projectName.get(pid) || "Unassigned",
      color: projectColor.get(pid) || null,
      ms,
      shareOfWeek: weekTotalMs > 0 ? ms / weekTotalMs : 0,
    }));

  // At-risk projects — projects with open tasks AND no workSession
  // activity in the last 14 days. Sorted staler-first.
  const lastActivityByProject = new Map();
  for (const ws of content.workSessions || []) {
    const end = Date.parse(ws.endedAt) || Date.parse(ws.startedAt);
    if (!Number.isFinite(end)) continue;
    const pid = ws.projectId || "";
    if (!lastActivityByProject.has(pid) || end > lastActivityByProject.get(pid)) {
      lastActivityByProject.set(pid, end);
    }
  }
  const openTasksByProject = new Map();
  for (const t of content.todaysTasks || []) {
    if (t.done) continue;
    const pid = t.projectId || "";
    openTasksByProject.set(pid, (openTasksByProject.get(pid) || 0) + 1);
  }
  const fourteenDaysAgo = Date.now() - 14 * MS_PER_DAY;
  const atRiskProjects = [...openTasksByProject.entries()]
    .map(([pid, count]) => ({
      projectId: pid,
      name: projectName.get(pid) || "Unassigned",
      color: projectColor.get(pid) || null,
      openCount: count,
      lastActivityMs: lastActivityByProject.get(pid) || 0,
    }))
    .filter((p) => p.lastActivityMs > 0 && p.lastActivityMs < fourteenDaysAgo)
    .sort((a, b) => a.lastActivityMs - b.lastActivityMs)
    .slice(0, 5);

  // Trending callouts — this week vs avg of last 4 weeks; best single
  // day ever (by completions); best week ever (by completions, by
  // calendar-week buckets).
  const callout_thisWeekStart = Date.now() - 7 * MS_PER_DAY;
  const callout_fiveWeeksAgo = Date.now() - 5 * 7 * MS_PER_DAY;
  let thisWeekDeepMs = 0;
  let prior4WeeksDeepMs = 0;
  for (const ws of content.workSessions || []) {
    const start = Date.parse(ws.startedAt);
    if (!Number.isFinite(start)) continue;
    const ms = ws.activeMs || 0;
    if (start >= callout_thisWeekStart) thisWeekDeepMs += ms;
    else if (start >= callout_fiveWeeksAgo) prior4WeeksDeepMs += ms;
  }
  const priorWeekAvgMs = prior4WeeksDeepMs / 4;
  const thisWeekVsAvg = priorWeekAvgMs > 0 ? {
    thisWeekMs: thisWeekDeepMs,
    priorAvgMs: Math.round(priorWeekAvgMs),
    pctDiff: Math.round(((thisWeekDeepMs - priorWeekAvgMs) / priorWeekAvgMs) * 100),
  } : null;

  const completionsByDayKey = new Map();
  for (const c of allCompletions) {
    const t = Date.parse(c.completedAt);
    if (!Number.isFinite(t)) continue;
    const key = ymd(new Date(t));
    completionsByDayKey.set(key, (completionsByDayKey.get(key) || 0) + 1);
  }
  let bestDayEver = null;
  for (const [dayKey, count] of completionsByDayKey) {
    if (!bestDayEver || count > bestDayEver.count) {
      bestDayEver = { dayKey, count };
    }
  }

  // Best week ever — calendar-week buckets (Sunday-start) summed.
  const weekBuckets = new Map();
  for (const [dayKey, count] of completionsByDayKey) {
    const d = new Date(dayKey + "T00:00:00");
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    sunday.setHours(0, 0, 0, 0);
    const wKey = ymd(sunday);
    weekBuckets.set(wKey, (weekBuckets.get(wKey) || 0) + count);
  }
  let bestWeekEver = null;
  for (const [wKey, count] of weekBuckets) {
    if (!bestWeekEver || count > bestWeekEver.count) {
      bestWeekEver = { weekStart: wKey, count };
    }
  }

  // Open-tasks-by-age — bucket open todaysTasks by how long ago they
  // were created. Surfaces stale work. Three buckets balance summary
  // size + granularity for typical task lists.
  const openTasksByAge = (() => {
    const todayMs = todayStart;
    const buckets = {
      "0-7d": 0,
      "8-30d": 0,
      "30d+": 0,
    };
    for (const t of content.todaysTasks || []) {
      if (t.done) continue;
      const created = Date.parse(t.createdAt);
      if (!Number.isFinite(created)) {
        // Tasks without a parseable createdAt land in 0-7d so they
        // don't get artificially stale-marked.
        buckets["0-7d"] += 1;
        continue;
      }
      const ageMs = todayMs - created;
      const ageDays = ageMs / MS_PER_DAY;
      if (ageDays <= 7) buckets["0-7d"] += 1;
      else if (ageDays <= 30) buckets["8-30d"] += 1;
      else buckets["30d+"] += 1;
    }
    return buckets;
  })();

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
    // IMPORTANT: project entries must include `color` so downstream
    // resolveProjectColors() calls return the project's STORED color
    // (and fall back to palette only for truly default-colored projects).
    // Without it, every project looks unset and gets a palette slot by
    // rank — which made /stats Today colors not match /home week recap.
    taskTimer,
    claude,
    projects: [...projectName.entries()].map(([id, name]) => ({
      id,
      name,
      color: projectColor.get(id) || null,
    })),
    projectCards,
    // Raw focus pomodoro timestamps so the Today tab can count pomos
    // for ANY selected day, not just today (`stats.today.pomos` is
    // hardcoded to today and breaks when the day picker shows prior
    // days). Sorted ascending.
    focusPomoMs: focusPomos
      .map((e) => Date.parse(e.startedAt))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b),
    // Full completions list (sorted newest-first) so the day picker can
    // count completions for arbitrary days, not just today/week/all.
    allCompletions,
    // Focus tab: 14-day daily focus pomos + 91-day streak calendar grid.
    focusDaily14,
    focusCalendar90,
    // Claude tab: 14-day daily activity + theme tags from AI summaries.
    claudeDaily14,
    claudeThemes,
    // Tasks tab: 14-day completion velocity (project-segmented),
    // Claude-assisted share by window, and open-tasks-by-age buckets.
    completionsDaily14,
    completionsByClaudeShare,
    openTasksByAge,
    // Trends tab: day-of-week pattern, workday rhythm, hot/at-risk
    // projects, trending callouts.
    dayOfWeekStats,
    workdayRhythm,
    hotProjects7d,
    atRiskProjects,
    trendingCallouts: {
      thisWeekVsAvg,
      bestDayEver,
      bestWeekEver,
    },
    // Token usage (Claude Max efficiency / volume).
    tokenTotalsByWindow,
    tokensDaily14,
    tokensByProject,
  };
}

/* ── Reusable bits ── */

/* DailyDeepChart was a 14-day task-vs-claude stacked chart on the
   original Overview tab. Replaced 2026-06-05 by DeepWorkBars (and
   later DailyStackedBars) with mode-dropdown support. Function +
   .stats-daily-bar-task/-claude CSS dropped 2026-06-09 as dead code. */

function BreakdownBars({ rows, formatRight, emptyMsg }) {
  if (!rows.length) return <EmptyState variant="inline" message={emptyMsg} />;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => {
        // Project-based rows have `color`; tag-based rows don't (and
        // get the default bar color from the stylesheet). For project
        // rows, soften the color to ~45% toward white so bar fills feel
        // muted — same treatment used in ClaudeProjectRows and /home
        // week recap. Project dot keeps full saturation so it still
        // pops at small size.
        const barStyle = { width: `${(r.value / max) * 100}%` };
        if (r.color) barStyle.background = softenColor(r.color, 0.45);
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

/* ClaudeProjectRows — rewrote for visual consistency with the other
   per-project bars on /stats. Was using a 2-line value cell jammed with
   "5h 30m · 12 ses · avg 12m / 45 msgs" which read as cluttered and ate
   vertical space. Now: single-line value, project-dot + softened bar
   color (matches /home week recap + Overview chart by-project), and the
   sessions / avg-length / avg-msgs detail moves to a hover tooltip
   over the bar. */
function ClaudeProjectRows({ rows }) {
  if (!rows.length) return <EmptyState variant="inline" message="No Claude sessions yet" />;
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <div className="stats-breakdown">
      {rows.map((r) => {
        const baseColor = r.color || "rgba(0,0,0,0.25)";
        const tip = (
          <>
            <strong>{r.label}</strong> — {fmtDuration(r.ms)}
            <br />{r.sessions} session{r.sessions === 1 ? "" : "s"}
            <br />avg {r.avgMin}m / {r.avgMsgs} msgs per session
          </>
        );
        return (
          <div key={r.label} className="stats-breakdown-row">
            <span className="stats-breakdown-label">
              {r.color && <span className="stats-project-dot" style={{ background: baseColor }} />}
              {r.label}
            </span>
            <Tooltip content={tip}>
              <div className="stats-breakdown-bar-wrap">
                <div
                  className="stats-breakdown-bar"
                  style={{
                    width: `${(r.ms / max) * 100}%`,
                    background: softenColor(baseColor, 0.45),
                  }}
                />
              </div>
            </Tooltip>
            <span className="stats-breakdown-value">{fmtDuration(r.ms)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* RecentClaudeList — rebuilt to use the .stats-recent-row layout
   (same as Overview's Recent activity feed + Today's story). Each
   row shows project dot · name · duration · ✓completions · AI
   summary teaser · relative time. The AI summary integration is
   the headline change here — flat list of "20 most recent sessions"
   now also tells you WHAT Claude did in each one. */
function RecentClaudeList({ rows }) {
  if (!rows.length) return <EmptyState variant="inline" message="No recent Claude sessions" />;
  return (
    <ul className="stats-recent-list">
      {rows.map((c) => {
        const aiSummary = (c.aiSummary || "").trim();
        return (
          <li key={c.id} className="stats-recent-row">
            <span className="stats-recent-project">
              <Dot color={softenColor(c.projectColor || "rgba(0,0,0,0.25)", 0.45)} size={8} />
              {c.projectName}
            </span>
            <span className="stats-recent-duration">
              {fmtDuration(c.durationMs)}
              {c.completedTaskCount > 0 && (
                <span className="stats-recent-completions">
                  {" "}· ✓ {c.completedTaskCount}
                </span>
              )}
            </span>
            <span className="stats-recent-summary">
              {aiSummary || (
                <span className="stats-recent-no-summary">—</span>
              )}
            </span>
            <Tooltip content={new Date(c.start).toLocaleString()}>
              <span className="stats-recent-when">
                <RelativeTime since={c.start} />
              </span>
            </Tooltip>
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
                  <Dot color={softenColor(s.projectColor || "rgba(0,0,0,0.25)", 0.45)} size={8} />
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

/* buildDayData(stats, dayStartMs)
   Aggregates one day's worth of data into the shape TodayTab renders.
   Originally hardcoded to "today" (todayStartMs()); generalized to any
   dayStartMs so the day picker can show prior days too. The "y" prefix
   variables (yTaskMs etc.) now mean "day before the selected day" —
   used for the delta-vs-prior-day on the snapshot. */
function buildTodayData(stats, dayStartMs = todayStartMs()) {
  const todayStart = dayStartMs;
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

  // Focus pomodoros in the selected day's window. Was hardcoded to
  // `stats.today.pomos` (today only) which was wrong when the day
  // picker showed prior days.
  const todayPomos = (stats.focusPomoMs || [])
    .filter((ms) => ms >= todayStart && ms < todayEnd).length;

  return {
    taskMs, claudeMs, claudeOutsideMs, absorbedMs, deepMs,
    yTaskMs, yClaudeOutsideMs, yDeepMs,
    deepDelta: deepMs - yDeepMs,
    sessions, byProject, hours, hoursMax, tags,
    hoursByProject,
    projectColorsToday,
    projectNamesToday: projectName,
    todayPomos,
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
  // Day picker: lets the user view "Today"-style data for any past
  // day. Defaults to today, but if today has no activity yet we auto-
  // fall back to the most recent day with workSessions so the page
  // isn't empty on a quiet morning. User can navigate freely from
  // there via prev/next + the date input.
  const [selectedDayStart, setSelectedDayStart] = useState(() => {
    const todayMs = todayStartMs();
    // Cheap check: does today have any activity? Walk workSessions
    // once. Same check buildTodayData would do, but inline here so we
    // don't pay for the full aggregation just to decide initial state.
    const todayEnd = todayMs + MS_PER_DAY;
    const hasTodayActivity = (content?.workSessions || []).some((s) => {
      const ms = Date.parse(s.startedAt);
      return Number.isFinite(ms) && ms >= todayMs && ms < todayEnd;
    });
    if (hasTodayActivity) return todayMs;
    // Find the most recent day with any workSession activity. If the
    // history is empty altogether, fall back to today (we'll just
    // show the empty-state).
    let latestSessionMs = 0;
    for (const s of content?.workSessions || []) {
      const ms = Date.parse(s.startedAt);
      if (Number.isFinite(ms) && ms > latestSessionMs) latestSessionMs = ms;
    }
    if (latestSessionMs === 0) return todayMs;
    const d = new Date(latestSessionMs);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });

  const todayMs = todayStartMs();
  const isToday = selectedDayStart === todayMs;
  const canGoNext = selectedDayStart < todayMs;

  function dayLabel(dayMs) {
    if (dayMs === todayMs) return "Today";
    if (dayMs === todayMs - MS_PER_DAY) return "Yesterday";
    return new Date(dayMs).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  function dayInputValue(dayMs) {
    // Format as YYYY-MM-DD in LOCAL time (not UTC) so the input matches
    // what the user sees as "the date." `toISOString` gives UTC which
    // can shift the date in some timezones.
    const d = new Date(dayMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  const t = useMemo(
    () => buildTodayData(stats, selectedDayStart),
    [stats, selectedDayStart]
  );
  const noActivity = t.deepMs === 0 && t.sessions.length === 0;
  const maxProjectMs = Math.max(1, ...t.byProject.map((r) => r.combinedMs));
  const deltaMin = Math.round(t.deepDelta / MS_PER_MIN);
  const deltaSign = deltaMin > 0 ? "+" : "";
  // Hour-by-hour coloring mode. Defaults to "by-project" to match the
  // Overview chart + heatmap default. Same dropdown shape as those.
  const [hourMode, setHourMode] = useState("by-project");

  // Selected-day vs typical — compare to the 6-day prior average.
  // For non-today days, the prior window is the 6 days BEFORE the
  // selected day (computed inline since stats.week is today-relative).
  const typicalMs = useMemo(() => {
    if (isToday) {
      const priorTotal = (stats.week?.deep_work_ms || 0) - t.deepMs;
      return priorTotal > 0 ? Math.round(priorTotal / 6) : 0;
    }
    // Walk taskTimer + claude for the 6 days before the selected day.
    const windowStart = selectedDayStart - 6 * MS_PER_DAY;
    let priorTask = 0;
    let priorClaudeOutside = 0;
    for (const tt of stats.taskTimer) {
      if (tt.start >= windowStart && tt.start < selectedDayStart) {
        priorTask += tt.durationMs;
      }
    }
    for (const cc of stats.claude) {
      if (cc.start >= windowStart && cc.start < selectedDayStart) {
        priorClaudeOutside += cc.outsideMs;
      }
    }
    const priorTotal = priorTask + priorClaudeOutside;
    return priorTotal > 0 ? Math.round(priorTotal / 6) : 0;
  }, [isToday, selectedDayStart, stats.week?.deep_work_ms, stats.taskTimer, stats.claude, t.deepMs]);
  const typicalDeltaMs = t.deepMs - typicalMs;
  const showTypicalLine = typicalMs > 0;

  // Tasks closed in the selected day — count from stats.allCompletions
  // instead of stats.completionCounts.today (which is today-only).
  const tasksClosedOnDay = useMemo(() => {
    const endMs = selectedDayStart + MS_PER_DAY;
    return (stats.allCompletions || []).filter((c) => {
      const ts = Date.parse(c.completedAt);
      return Number.isFinite(ts) && ts >= selectedDayStart && ts < endMs;
    }).length;
  }, [stats.allCompletions, selectedDayStart]);

  // Chronological Claude feed for the selected day (oldest first).
  const todayStoryFeed = useMemo(() => {
    const projectMap = new Map((content?.projects || []).map((p) => [p.id, p]));
    const endMs = selectedDayStart + MS_PER_DAY;
    return (content?.workSessions || [])
      .filter((s) => s.source === "claude_code")
      .filter((s) => {
        const ms = Date.parse(s.startedAt);
        return Number.isFinite(ms) && ms >= selectedDayStart && ms < endMs;
      })
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .map((s) => ({
        id: s.id,
        projectName: projectMap.get(s.projectId)?.name || "Unassigned",
        projectColor: projectMap.get(s.projectId)?.color || null,
        activeMs: s.activeMs || 0,
        aiSummary: (s.aiSummary || "").trim(),
        startedAt: s.startedAt,
        completionCount: Array.isArray(s.completedTasks) ? s.completedTasks.length : 0,
      }));
  }, [content, selectedDayStart]);

  // Selected-day Claude sessions grouped by project, ready to feed
  // straight into <ClaudeProjectBucket>. Window driven by the day
  // picker so this updates when the user picks a prior day.
  const claudeBucketsToday = useMemo(
    () => buildClaudeBuckets(
      content?.workSessions || [],
      content?.projects || [],
      { since: selectedDayStart, until: selectedDayStart + MS_PER_DAY }
    ),
    [content, selectedDayStart]
  );

  // Day picker UI — prev / [date input + label] / next. Sync now +
  // last-import indicator moved to the PageHeader so they're available
  // on every tab, not just Today.
  const dayPicker = (
    <div className="stats-day-picker">
      <button
        type="button"
        className="stats-day-picker-nav"
        onClick={() => setSelectedDayStart(selectedDayStart - MS_PER_DAY)}
        aria-label="Previous day"
      >
        ←
      </button>
      <span className="stats-day-picker-label">{dayLabel(selectedDayStart)}</span>
      <input
        type="date"
        className="stats-day-picker-input"
        value={dayInputValue(selectedDayStart)}
        max={dayInputValue(todayMs)}
        onChange={(e) => {
          // <input type="date"> emits YYYY-MM-DD; reconstruct a local-midnight
          // ms timestamp so day math stays in the same zone as todayStartMs().
          const v = e.target.value;
          if (!v) return;
          const [y, m, d] = v.split("-").map(Number);
          if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
          const next = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
          if (next <= todayMs) setSelectedDayStart(next);
        }}
      />
      <button
        type="button"
        className="stats-day-picker-nav"
        onClick={() => setSelectedDayStart(selectedDayStart + MS_PER_DAY)}
        disabled={!canGoNext}
        aria-label="Next day"
      >
        →
      </button>
      {!isToday && (
        <button
          type="button"
          className="stats-day-picker-today"
          onClick={() => setSelectedDayStart(todayMs)}
        >
          Jump to today
        </button>
      )}
      {/* Sync now + last-import indicator lived here previously; lifted
          to the PageHeader so it's available on every tab. */}
    </div>
  );

  if (noActivity) {
    return (
      <>
        {dayPicker}
        <Section title={isToday ? "Today" : dayLabel(selectedDayStart)}>
          <EmptyState
            variant="inline"
            message={
              isToday
                ? "No work sessions logged yet today"
                : `No work sessions logged on ${dayLabel(selectedDayStart)}`
            }
          />
          <p className="stats-footnote">
            {isToday
              ? "Sessions populate as the hourly importer picks up new Claude transcripts and as task timers run."
              : "Use the picker above to view another day."}
            {t.yDeepMs > 0 && (
              <>
                {" "}Prior day: {fmtDuration(t.yDeepMs)} total deep work.
              </>
            )}
          </p>
        </Section>
      </>
    );
  }

  return (
    <>
      {dayPicker}
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
                    ? `same as ${isToday ? "yesterday" : "prior day"}`
                    : `${deltaSign}${deltaMin}m vs ${isToday ? "yesterday" : "prior day"}`,
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
          { value: tasksClosedOnDay, label: "Tasks closed" },
        ]}
      />

      {/* Today vs the 6-day prior average. Skip rendering when there's
          no baseline yet (typicalMs = 0). Sign + arrow framing mirrors
          the snapshot delta on the Deep work cell. */}
      {showTypicalLine && (
        <p className="stats-today-vs-typical">
          {typicalDeltaMs >= 0 ? "▲" : "▼"}{" "}
          <strong>{fmtDuration(Math.abs(typicalDeltaMs))}</strong>{" "}
          {typicalDeltaMs >= 0 ? "above" : "below"} your 6-day average
          {" "}
          <span className="stats-today-vs-typical-baseline">
            ({fmtDuration(typicalMs)}/day)
          </span>
        </p>
      )}

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

      {/* Today's story — chronological Claude session feed for today,
          each row showing project + duration + completions count + AI
          summary teaser + relative time. Reads top-to-bottom as the
          day unfolded. Uses the same .stats-recent-* row layout as
          Overview's Recent activity (would extract to a shared
          component if a 3rd use case appeared). */}
      {todayStoryFeed.length > 0 && (
        <Section title="Today's story">
          <ul className="stats-recent-list">
            {todayStoryFeed.map((s) => (
              <li key={s.id} className="stats-recent-row">
                <span className="stats-recent-project">
                  <Dot color={softenColor(s.projectColor || "rgba(0,0,0,0.25)", 0.45)} size={8} />
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
        </Section>
      )}

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

/* DailyStackedBars — shared 14-day project-segmented chart used by the
   Focus and Claude tabs. Both build a `days` array of {dayKey, byProject:
   Map<pid, ms>, isToday, ...} plus their own per-day total (focus minutes,
   Claude active ms). Generic over:
     valueAccessor(day) → number for the bar height (used as the max-scale
                          basis and to determine "empty" days)
     tooltipFor(day, segs) → node rendered in the hover tooltip
   See flag-reuse-opportunities memory — this is the third use of the
   project-segmented daily-bar pattern, so it's extracted instead of
   duplicated. */
function DailyStackedBars({ days, projectName, projectColor, valueAccessor, tooltipFor }) {
  const max = Math.max(1, ...days.map(valueAccessor));
  return (
    <div className="stats-daily">
      {days.map((d) => {
        // Sort segments largest → smallest, then reverse for DOM order
        // (visual top = first DOM child under flex-end column). Largest
        // segment anchors the bottom of the bar.
        const segs = [...d.byProject.entries()]
          .filter(([, ms]) => ms > 0)
          .sort((a, b) => b[1] - a[1]);
        const tip = tooltipFor(d, segs);
        return (
          <Tooltip key={d.dayKey} content={tip}>
            <div className={`stats-daily-col${d.isToday ? " is-today" : ""}`}>
              <div className="stats-daily-stack">
                {[...segs].reverse().map(([pid, ms], i) => {
                  const pct = (ms / max) * 100;
                  if (pct <= 0) return null;
                  const baseColor = projectColor.get(pid) || "rgba(0,0,0,0.25)";
                  return (
                    <div
                      key={pid || "unassigned"}
                      className="stats-daily-bar"
                      style={{
                        height: `${pct}%`,
                        background: softenColor(baseColor, 0.45),
                        borderRadius: i === 0 ? "3px 3px 0 0" : "0",
                      }}
                    />
                  );
                })}
              </div>
              <div className="stats-daily-label">
                {d.dayKey.slice(8).replace(/^0/, "")}
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

/* FocusDailyChart — pomo data → DailyStackedBars wrapper. Bar height
   driven by focus minutes per day; tooltip surfaces pomo count + per-
   project breakdown. */
function FocusDailyChart({ days, projectName, projectColor }) {
  return (
    <DailyStackedBars
      days={days}
      projectName={projectName}
      projectColor={projectColor}
      valueAccessor={(d) => d.focusMs}
      tooltipFor={(d, segs) => (
        <>
          <strong>{d.dayKey}</strong> — {d.pomoCount} pomo{d.pomoCount === 1 ? "" : "s"}, {fmtDuration(d.focusMs)} focus
          {segs.map(([pid, ms]) => (
            <span key={pid || "unassigned"}>
              <br />
              {projectName.get(pid) || "Unassigned"}: {fmtDuration(ms)}
            </span>
          ))}
          {d.focusMs === 0 && (<><br />no focus pomos</>)}
        </>
      )}
    />
  );
}

/* TokenDailyChart — Claude tokens → DailyStackedBars wrapper. Bar
   height = total tokens that day; segments per project. Used on the
   Trends tab Token Usage section. */
function TokenDailyChart({ days, projectName, projectColor }) {
  return (
    <DailyStackedBars
      days={days}
      projectName={projectName}
      projectColor={projectColor}
      valueAccessor={(d) => d.total}
      tooltipFor={(d, segs) => (
        <>
          <strong>{d.dayKey}</strong> — {fmtTokens(d.total)} tokens
          <br />cache hit: {d.cacheHitPct}%
          {segs.map(([pid, count]) => (
            <span key={pid || "unassigned"}>
              <br />
              {projectName.get(pid) || "Unassigned"}: {fmtTokens(count)}
            </span>
          ))}
          {d.total === 0 && (<><br />no Claude tokens</>)}
        </>
      )}
    />
  );
}

/* CompletionsDailyChart — task completions → DailyStackedBars wrapper.
   Bar height driven by count per day (not ms); tooltip surfaces total
   completions + per-project breakdown. Same visual shape as the time-
   based charts even though the unit is counts. */
function CompletionsDailyChart({ days, projectName, projectColor }) {
  return (
    <DailyStackedBars
      days={days}
      projectName={projectName}
      projectColor={projectColor}
      valueAccessor={(d) => d.count}
      tooltipFor={(d, segs) => (
        <>
          <strong>{d.dayKey}</strong> — {d.count} completion{d.count === 1 ? "" : "s"}
          {segs.map(([pid, count]) => (
            <span key={pid || "unassigned"}>
              <br />
              {projectName.get(pid) || "Unassigned"}: {count}
            </span>
          ))}
          {d.count === 0 && (<><br />no completions</>)}
        </>
      )}
    />
  );
}

/* ClaudeDailyChart — Claude activity → DailyStackedBars wrapper. Bar
   height driven by active ms per day; tooltip surfaces session count
   + per-project breakdown. */
function ClaudeDailyChart({ days, projectName, projectColor }) {
  return (
    <DailyStackedBars
      days={days}
      projectName={projectName}
      projectColor={projectColor}
      valueAccessor={(d) => d.activeMs}
      tooltipFor={(d, segs) => (
        <>
          <strong>{d.dayKey}</strong> — {d.sessionCount} session{d.sessionCount === 1 ? "" : "s"}, {fmtDuration(d.activeMs)} active
          {segs.map(([pid, ms]) => (
            <span key={pid || "unassigned"}>
              <br />
              {projectName.get(pid) || "Unassigned"}: {fmtDuration(ms)}
            </span>
          ))}
          {d.activeMs === 0 && (<><br />no Claude sessions</>)}
        </>
      )}
    />
  );
}

/* FocusStreakCalendar — 91-day grid (rows = days of week, columns =
   weeks). Each cell colored by focus-time intensity that day; cells
   without any focus pomos get a neutral gray. Reads as "the shape of
   your focus practice" — streaks become visible as runs of dark cells. */
function FocusStreakCalendar({ days }) {
  // Layout: build 13 columns of 7 days each. The newest column ends
  // on the day-of-week of today; older columns extend backward in
  // 7-day jumps. Within each column the cells run Sun → Sat top-to-
  // bottom to match a calendar's reading order.
  const maxFocusMs = Math.max(1, ...days.map((d) => d.focusMs));
  // Group into columns of 7. The rightmost column always ends on today;
  // we walk backward in groups of 7. Result: oldest column on the left.
  const todayDow = days[days.length - 1].dow;
  // Pad start so the bottom-right cell lands on today's dow row.
  // Pad amount = 6 - todayDow extra cells (placeholders) on the right
  // side of the newest column. Or more simply: the newest column has
  // todayDow + 1 cells from Sunday→today; the rest of that column is
  // future days (rendered as blank placeholders).
  // We'll build the grid as a flat array of cells PLUS blanks for the
  // future positions in the current (rightmost) column.
  const cells = [...days];
  // Append blanks for the days AFTER today in the current week so the
  // current week's column has 7 slots — keeps the grid rectangular.
  const futureBlanks = 6 - todayDow;
  for (let i = 0; i < futureBlanks; i++) {
    cells.push({ blank: true, key: `blank-${i}` });
  }
  // Total cells now = 91 + (6 - todayDow). Group into columns of 7.
  const totalCols = Math.ceil(cells.length / 7);
  const columns = [];
  for (let c = 0; c < totalCols; c++) {
    columns.push(cells.slice(c * 7, c * 7 + 7));
  }
  return (
    <div className="stats-streak-cal" role="img" aria-label="90-day focus streak calendar">
      {columns.map((col, ci) => (
        <div key={ci} className="stats-streak-cal-col">
          {col.map((cell, ri) => {
            if (cell.blank) {
              return <span key={cell.key} className="stats-streak-cal-cell is-blank" />;
            }
            const intensity = cell.focusMs > 0 ? cell.focusMs / maxFocusMs : 0;
            const tip = cell.focusMs > 0 ? (
              <>
                <strong>{cell.dayKey}</strong>
                <br />{cell.pomoCount} pomo{cell.pomoCount === 1 ? "" : "s"} · {fmtDuration(cell.focusMs)}
              </>
            ) : `${cell.dayKey} — no focus pomos`;
            const bg = cell.hasActivity
              ? `rgba(90, 126, 95, ${0.2 + 0.75 * intensity})` // sage at intensity-scaled alpha
              : "rgba(0,0,0,0.05)";
            return (
              <Tooltip key={cell.dayKey} content={tip}>
                <span
                  className={`stats-streak-cal-cell${cell.isToday ? " is-today" : ""}${cell.hasActivity ? " has-activity" : ""}`}
                  style={{ background: bg }}
                />
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function FocusTab({ stats }) {
  // Project name + color lookup for the daily chart. Same project
  // resolution as the rest of /stats — stored color preferred, palette
  // fallback by rank. (Note: stats.projects already runs through the
  // computeStats palette logic for color, so we can use it directly.)
  const projectName = useMemo(
    () => new Map((stats.projects || []).map((p) => [p.id, p.name])),
    [stats.projects]
  );
  const projectColor = useMemo(() => {
    const map = new Map();
    for (const p of stats.projects || []) {
      if (p.color) map.set(p.id, p.color);
    }
    return map;
  }, [stats.projects]);

  // Avg pomo length helpers — kept as MetricTable rows but the
  // duplicate "Pomodoros" row from before was dropped (same numbers
  // as the snapshot cells, no reason to repeat).
  const avgToday = stats.today.pomos
    ? fmtDuration(Math.round(stats.today.task_ms / stats.today.pomos))
    : "—";
  const avgWeek = stats.week.pomos
    ? fmtDuration(Math.round(stats.week.task_ms / stats.week.pomos))
    : "—";
  const avgAll = stats.all.pomos
    ? fmtDuration(Math.round(stats.all.task_ms / stats.all.pomos))
    : "—";

  return (
    <>
      {/* Rebalanced snapshot: mix of time + count so the headline
          isn't four pomo-count cells in a row. Focus time today/7d
          gives the volume view; streak gives the consistency view;
          all-time pomos is the lifetime-achievement number. */}
      <StatGrid
        variant="snapshot"
        columns={[
          { value: fmtDuration(stats.today.task_ms), label: "Focus today" },
          { value: fmtDuration(stats.week.task_ms), label: "Past 7 days" },
          { value: stats.currentStreak, label: "Day streak" },
          { value: stats.all.pomos, label: "All-time pomos" },
        ]}
      />

      {/* Headline chart: 14 days of focus pomos with per-project segments.
          Same compact shape as DeepWorkBars on Overview, but pomo data. */}
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Last 14 days</span>
          <span className="home-section-meta">
            <strong>{stats.week.pomos}</strong>{" "}
            {stats.week.pomos === 1 ? "pomo" : "pomos"} in last 7 days
          </span>
        </h2>
        {stats.focusDaily14.every((d) => d.focusMs === 0) ? (
          <EmptyState
            variant="inline"
            message="No focus pomos in the last 14 days"
            hint="Start a pomodoro on any task and the chart will fill in."
          />
        ) : (
          <FocusDailyChart
            days={stats.focusDaily14}
            projectName={projectName}
            projectColor={projectColor}
          />
        )}
      </section>

      {/* Streak calendar — replaces the old single-stat "Focus streak"
          section. 91 days of cells, intensity by focus time. The
          streak number from the snapshot finally has visual context. */}
      <Section title="Streak — last 90 days">
        <FocusStreakCalendar days={stats.focusCalendar90} />
        <p className="stats-footnote">
          Each cell is one day; intensity scales with focus time.
          Lighter = lower; gray = no pomos.
        </p>
      </Section>

      <Section title="Focus time by project — all time">
        <BreakdownBars
          rows={stats.focusByProject}
          formatRight={(v) => fmtDuration(v)}
          emptyMsg="No task-timer sessions yet."
        />
      </Section>

      {/* Detail collapsed by default — surfaces avg pomo length per
          window, which is the one piece of info the snapshot/chart
          don't already show. Pomodoros count row dropped (duplicate
          of the snapshot). */}
      <Section title="More">
        <Collapsible summary="Focus time + avg pomo length by window">
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
                label: "Avg pomo length",
                cells: [avgToday, avgWeek, avgAll],
              },
            ]}
          />
        </Collapsible>
      </Section>
    </>
  );
}

function ClaudeTab({ stats }) {
  // Project lookup maps for the chart (same shape used on Focus tab).
  const projectName = useMemo(
    () => new Map((stats.projects || []).map((p) => [p.id, p.name])),
    [stats.projects]
  );
  const projectColor = useMemo(() => {
    const map = new Map();
    for (const p of stats.projects || []) {
      if (p.color) map.set(p.id, p.color);
    }
    return map;
  }, [stats.projects]);

  // Tasks closed in Claude sessions today — completions whose source
  // session was a Claude session. Computed from stats.allCompletions
  // (the full completions list with sessionId) cross-referenced against
  // claude_code session ids.
  const todayClaudeCompletions = useMemo(() => {
    const todayStart = todayStartMs();
    const claudeSessionIds = new Set((stats.claude || []).map((c) => c.id));
    return (stats.allCompletions || []).filter((c) => {
      if (!claudeSessionIds.has(c.sessionId)) return false;
      const t = Date.parse(c.completedAt);
      return Number.isFinite(t) && t >= todayStart;
    }).length;
  }, [stats.allCompletions, stats.claude]);

  return (
    <>
      {/* Snapshot: kept the 4-cell shape, swapped "Avg msgs/session"
          (novelty) for "Tasks closed via Claude today" (signal). */}
      <StatGrid
        variant="snapshot"
        columns={[
          { value: stats.today.claude_sessions, label: "Sessions today" },
          { value: stats.week.claude_sessions, label: "Past 7 days" },
          { value: fmtDuration(stats.all.claude_total_ms), label: "All-time active" },
          { value: todayClaudeCompletions, label: "Tasks closed today" },
        ]}
      />

      {/* Headline chart: 14-day Claude activity, project-colored.
          Same compact shape as the Focus and Overview charts. */}
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Last 14 days</span>
          <span className="home-section-meta">
            <strong>{stats.week.claude_sessions}</strong>{" "}
            {stats.week.claude_sessions === 1 ? "session" : "sessions"} in last 7 days
          </span>
        </h2>
        {stats.claudeDaily14.every((d) => d.activeMs === 0) ? (
          <EmptyState
            variant="inline"
            message="No Claude sessions in the last 14 days"
            hint="The hourly import (or Sync now on Today) pulls new sessions in."
          />
        ) : (
          <ClaudeDailyChart
            days={stats.claudeDaily14}
            projectName={projectName}
            projectColor={projectColor}
          />
        )}
      </section>

      <Section title="Claude time by project — all time">
        <ClaudeProjectRows rows={stats.claudeByProject} />
      </Section>

      {/* Recent Claude sessions — now with AI summary teasers + ✓
          completion counts. Same row layout as Overview's Recent
          activity. The headline payoff of the AI-summary backfill
          finally lands on the Claude tab. */}
      <Section title="Recent Claude sessions">
        <RecentClaudeList rows={stats.recentClaude} />
      </Section>

      {/* Theme tags from the last 7 days of AI summaries. Lightweight
          word-frequency surface — top 12 words by count, ≥2 hits.
          Hidden when there's nothing meaningful to show. */}
      {stats.claudeThemes.length > 0 && (
        <Section title="Themes this week">
          <ul className="stats-themes">
            {stats.claudeThemes.map((t) => (
              <li key={t.word} className="stats-theme-chip">
                <span className="stats-theme-word">{t.word}</span>
                <span className="stats-theme-count">{t.count}</span>
              </li>
            ))}
          </ul>
          <p className="stats-footnote">
            Most-mentioned words across this week's AI summaries.
            Stopwords + short words excluded.
          </p>
        </Section>
      )}

      {/* Lower-frequency drill-downs — Tags + MetricTable detail.
          Tags moved here since they're a less-asked question once
          themes (above) give a similar "what have I been doing"
          read in plainer English. MetricTable trimmed to drop the
          Sessions row (duplicate of the snapshot). */}
      <Section title="More">
        <Collapsible summary="Claude time by tag — top 15">
          <BreakdownBars
            rows={stats.claudeByTag.slice(0, 15)}
            formatRight={(v) => fmtDuration(v)}
            emptyMsg="No tags yet."
          />
        </Collapsible>
        <Collapsible summary="Detail — active time + msgs/session by window">
          <MetricTable
            headers={["Today", "Past 7 days", "All-time"]}
            rows={[
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
        </Collapsible>
      </Section>
    </>
  );
}

function TasksTab({ stats }) {
  const c = stats.completionCounts;
  // Project lookup maps for the chart (same shape used on Focus + Claude).
  const projectName = useMemo(
    () => new Map((stats.projects || []).map((p) => [p.id, p.name])),
    [stats.projects]
  );
  const projectColor = useMemo(() => {
    const map = new Map();
    for (const p of stats.projects || []) {
      if (p.color) map.set(p.id, p.color);
    }
    return map;
  }, [stats.projects]);

  // 4th snapshot cell: avg shipped per day across the past 7 days.
  // Single decimal so "1.4 / day" still reads as a number rather than
  // being rounded to 1.
  const avgShipped = c.week / 7;
  const avgShippedDisplay =
    avgShipped >= 1 ? avgShipped.toFixed(1) : (avgShipped > 0 ? avgShipped.toFixed(2) : "0");

  // Open-tasks-by-age — total + the stale slice. The bar component
  // below renders the three buckets; this just powers the section.
  const openAge = stats.openTasksByAge;
  const openTotal = openAge["0-7d"] + openAge["8-30d"] + openAge["30d+"];
  const openMaxBucket = Math.max(1, openAge["0-7d"], openAge["8-30d"], openAge["30d+"]);

  return (
    <>
      {/* Snapshot: 4 cells now (was 3). Added Avg shipped/day from the
          7-day window so the snapshot mirrors the pace question the
          rest of the tab answers in detail. */}
      <StatGrid
        variant="snapshot"
        columns={[
          { value: c.today, label: "Today" },
          { value: c.week, label: "Past 7 days" },
          { value: avgShippedDisplay, label: "Avg / day (7d)" },
          { value: c.all, label: "All-time shipped" },
        ]}
      />

      {/* Completion velocity — now project-segmented via DailyStackedBars.
          Same compact shape as Focus + Claude charts but the unit is
          count, not ms. */}
      <section className="home-section">
        <h2 className="home-section-title home-section-title-row">
          <span>Last 14 days</span>
          <span className="home-section-meta">
            <strong>{c.week}</strong>{" "}
            shipped in last 7 days
          </span>
        </h2>
        {stats.completionsDaily14.every((d) => d.count === 0) ? (
          <EmptyState
            variant="inline"
            message="No completions in the last 14 days"
            hint="Tasks closed during a Claude session (via TaskCreate/TaskUpdate) land here automatically."
          />
        ) : (
          <CompletionsDailyChart
            days={stats.completionsDaily14}
            projectName={projectName}
            projectColor={projectColor}
          />
        )}
      </section>

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

      {/* Recent completions — rewrote to use the .stats-recent-row
          4-col layout (same as Overview/Today/Claude). Each row now
          shows project · subject · AI summary from the source session
          · relative time. The AI summary teaser is the headline change:
          "this task closed during a session about <X>" context. */}
      <Section title="Recent completions">
        {stats.recentCompletions.length === 0 ? (
          <EmptyState variant="inline" message="No completions yet" />
        ) : (
          <ul className="stats-recent-list">
            {stats.recentCompletions.map((c, i) => (
              <li key={i} className="stats-recent-row">
                <span className="stats-recent-project">
                  <Dot color={softenColor(c.color || "rgba(0,0,0,0.25)", 0.45)} size={8} />
                  {c.projectName}
                </span>
                <span className="stats-recent-subject-cell">{c.subject}</span>
                <span className="stats-recent-summary">
                  {c.aiSummary || (
                    <span className="stats-recent-no-summary">—</span>
                  )}
                </span>
                <Tooltip content={c.completedAt ? new Date(c.completedAt).toLocaleString() : ""}>
                  <span className="stats-recent-when">
                    {c.completedAt ? (
                      <RelativeTime since={Date.parse(c.completedAt)} />
                    ) : ""}
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Open-tasks-by-age — surfaces stale work without forcing the
          user to walk every open row in /todo. Three buckets. */}
      {openTotal > 0 && (
        <Section title="Open tasks by age">
          <div className="stats-age-buckets">
            {["0-7d", "8-30d", "30d+"].map((bucket) => {
              const count = openAge[bucket];
              const pct = (count / openMaxBucket) * 100;
              return (
                <div key={bucket} className="stats-age-row">
                  <span className="stats-age-label">{bucket}</span>
                  <div className="stats-age-bar-wrap">
                    <div
                      className="stats-age-bar"
                      style={{
                        width: `${pct}%`,
                        background: bucket === "30d+"
                          ? "#c45c4a"
                          : bucket === "8-30d"
                            ? "#b08a66"
                            : "#5a7e5f",
                      }}
                    />
                  </div>
                  <span className="stats-age-count">{count}</span>
                </div>
              );
            })}
          </div>
          <p className="stats-footnote">
            {openTotal} open tasks total. Stale (30d+) work in red — worth
            either finishing, dropping, or moving to backlog.
          </p>
        </Section>
      )}

      {/* Focus hours per completed task — lowered threshold to ≥1 so
          projects with a single completion still show up. Moved into
          the More collapsible since it's a niche metric. */}
      <Section title="More">
        {stats.focusPerCompletion.length > 0 && (
          <Collapsible summary="Deep work per completed task">
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
              Deep work = task-timer + Claude-outside-timer time. Lower =
              more efficient shipping (caveat: tasks vary in scope).
            </p>
          </Collapsible>
        )}
        <Collapsible summary="Tasks by project — current (open vs done)">
          <ProjectTaskSplit rows={stats.tasksByProject} />
          <p className="stats-footnote">
            Open <span className="stats-swatch stats-swatch-open" /> / Done <span className="stats-swatch stats-swatch-done" />{" "}
            · "AI-assist" = % of focus time that overlapped a Claude session in the same project.
          </p>
        </Collapsible>
        <Collapsible summary="Open tasks by tag — top 15">
          <BreakdownBars
            rows={stats.tasksByTag.slice(0, 15)}
            formatRight={(v) => v}
            emptyMsg="No tags on open tasks."
          />
        </Collapsible>
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

/* Format raw token counts in human units (1.2M, 850K, etc.). Used by
   the Token usage section on the Trends tab. */
function fmtTokens(n) {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

/* CacheHitSparkline — tiny line chart of daily cache-hit % over the
   14-day window. Inline SVG, ~120px wide. Doesn't need labels (the
   sparkline IS the label — "is this trending up?"). */
function CacheHitSparkline({ days }) {
  // Only consider days with actual data; flat-zero days bring the
  // average down even though "no data" isn't really 0% cache hit.
  const w = 140;
  const h = 28;
  const padding = 2;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const pts = days.map((d, i) => {
    const x = padding + (innerW * i) / Math.max(1, days.length - 1);
    const y = padding + innerH - (innerH * (d.cacheHitPct || 0)) / 100;
    return { x, y, hit: d.cacheHitPct, dayKey: d.dayKey, hasData: d.total > 0 };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg
      className="stats-cache-spark"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-label="14-day cache-hit ratio sparkline"
    >
      <path d={path} fill="none" stroke="#5a7e5f" strokeWidth="1.5" strokeLinecap="round" />
      {pts.map((p, i) => (
        p.hasData ? (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill="#5a7e5f" />
        ) : null
      ))}
    </svg>
  );
}

/* Format minutes-since-midnight (0–1439) as a readable wall-clock
   time. Used by the Workday rhythm card on the Trends tab. */
function formatMinAsTime(mins) {
  if (!Number.isFinite(mins) || mins < 0) return "—";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/* DowChart — one row of bars, one per day-of-week (Sun..Sat). Bar
   height scales to the busiest DoW's avgDeepMs. Today's day-of-week is
   highlighted in the existing .is-today style. Hovering shows the
   actual averages. */
function DowChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.avgDeepMs));
  const todayDow = new Date().getDay();
  return (
    <div className="stats-daily stats-dow">
      {days.map((d) => {
        const pct = (d.avgDeepMs / max) * 100;
        const tip = (
          <>
            <strong>{d.label}</strong> — avg {fmtDuration(d.avgDeepMs)} of deep work
            <br />avg {d.avgCompletions.toFixed(1)} completions / active {d.label}
            <br />active {d.activeDays} {d.label}{d.activeDays === 1 ? "" : "s"}
          </>
        );
        return (
          <Tooltip key={d.dow} content={tip}>
            <div
              className={`stats-daily-col${d.dow === todayDow ? " is-today" : ""}${d.avgDeepMs > 0 ? " has-any" : ""}`}
            >
              <div className="stats-daily-stack">
                {pct > 0 && (
                  <div
                    className="stats-daily-bar"
                    style={{
                      height: `${pct}%`,
                      background: "#5a7e5f", // sage
                      borderRadius: "3px 3px 0 0",
                    }}
                  />
                )}
              </div>
              <div className="stats-daily-label">{d.label}</div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function TrendsTab({ stats }) {
  const { dayOfWeekStats, workdayRhythm, hotProjects7d, atRiskProjects, trendingCallouts } = stats;
  const tw = trendingCallouts?.thisWeekVsAvg;
  const bd = trendingCallouts?.bestDayEver;
  const bw = trendingCallouts?.bestWeekEver;

  // Project lookup maps for the Token Usage chart — same shape used on
  // Focus / Claude / Tasks tabs. Required by the TokenDailyChart wrapper.
  const projectName = useMemo(
    () => new Map((stats.projects || []).map((p) => [p.id, p.name])),
    [stats.projects]
  );
  const projectColor = useMemo(() => {
    const map = new Map();
    for (const p of stats.projects || []) {
      if (p.color) map.set(p.id, p.color);
    }
    return map;
  }, [stats.projects]);

  // Top day-of-week by avg completions — text used in the callout line.
  const topDow = useMemo(() => {
    let best = null;
    for (const d of dayOfWeekStats || []) {
      if (d.avgCompletions <= 0) continue;
      if (!best || d.avgCompletions > best.avgCompletions) best = d;
    }
    return best;
  }, [dayOfWeekStats]);

  return (
    <>
      {/* Trending callouts — 4-cell grid of headline stats with caption
          lines for context. Each cell renders only when there's data
          to compute it; missing ones simply skip the slot. */}
      <div className="stats-trend-callouts">
        {tw && (
          <div className="stats-trend-cell">
            <span className="stats-trend-label">This week</span>
            <span className="stats-trend-value">{fmtDuration(tw.thisWeekMs)}</span>
            <span className="stats-trend-caption">
              <span className={tw.pctDiff >= 0 ? "is-up" : "is-down"}>
                {tw.pctDiff >= 0 ? "▲" : "▼"} {Math.abs(tw.pctDiff)}%
              </span>{" "}
              vs 4-week avg ({fmtDuration(tw.priorAvgMs)}/wk)
            </span>
          </div>
        )}
        {bd && (
          <div className="stats-trend-cell">
            <span className="stats-trend-label">Best day ever</span>
            <span className="stats-trend-value">
              {bd.count}<span className="stats-trend-unit"> tasks</span>
            </span>
            <span className="stats-trend-caption">{bd.dayKey}</span>
          </div>
        )}
        {bw && (
          <div className="stats-trend-cell">
            <span className="stats-trend-label">Best week ever</span>
            <span className="stats-trend-value">
              {bw.count}<span className="stats-trend-unit"> tasks</span>
            </span>
            <span className="stats-trend-caption">week of {bw.weekStart}</span>
          </div>
        )}
        {topDow && (
          <div className="stats-trend-cell">
            <span className="stats-trend-label">Top day of week</span>
            <span className="stats-trend-value">{topDow.labelFull}s</span>
            <span className="stats-trend-caption">
              {topDow.avgCompletions.toFixed(1)} tasks/day on avg
            </span>
          </div>
        )}
      </div>

      <Section title="Day of week — avg deep work">
        {dayOfWeekStats && dayOfWeekStats.some((d) => d.avgDeepMs > 0) ? (
          <DowChart days={dayOfWeekStats} />
        ) : (
          <EmptyState variant="inline" message="Not enough activity yet to surface a day-of-week pattern." />
        )}
      </Section>

      <Section title="Workday rhythm">
        {workdayRhythm ? (
          <ul className="stats-rhythm-grid">
            <li className="stats-rhythm-cell">
              <span className="stats-rhythm-label">Avg start</span>
              <span className="stats-rhythm-value">{formatMinAsTime(workdayRhythm.avgStartMin)}</span>
            </li>
            <li className="stats-rhythm-cell">
              <span className="stats-rhythm-label">Avg end</span>
              <span className="stats-rhythm-value">{formatMinAsTime(workdayRhythm.avgEndMin)}</span>
            </li>
            <li className="stats-rhythm-cell">
              <span className="stats-rhythm-label">Avg session</span>
              <span className="stats-rhythm-value">{fmtDuration(workdayRhythm.avgSessionDurationMs)}</span>
            </li>
            <li className="stats-rhythm-cell">
              <span className="stats-rhythm-label">Sessions/day</span>
              <span className="stats-rhythm-value">{workdayRhythm.avgSessionsPerDay}</span>
            </li>
          </ul>
        ) : (
          <EmptyState variant="inline" message="Not enough sessions yet." />
        )}
        {workdayRhythm && (
          <p className="stats-footnote">
            Averaged across {workdayRhythm.totalDays} active days.
          </p>
        )}
      </Section>

      <Section title="Hot projects — last 7 days">
        {hotProjects7d.length === 0 ? (
          <EmptyState variant="inline" message="No project activity this week." />
        ) : (
          <ul className="stats-hot-list">
            {hotProjects7d.map((p) => (
              <li key={p.projectId} className="stats-hot-row">
                <span className="stats-hot-project">
                  <Dot color={softenColor(p.color || "rgba(0,0,0,0.25)", 0.45)} size={8} />
                  {p.name}
                </span>
                <div className="stats-hot-bar-wrap">
                  <div
                    className="stats-hot-bar"
                    style={{
                      width: `${p.shareOfWeek * 100}%`,
                      background: softenColor(p.color || "rgba(0,0,0,0.25)", 0.45),
                    }}
                  />
                </div>
                <span className="stats-hot-share">
                  {Math.round(p.shareOfWeek * 100)}%
                  <span className="stats-hot-ms"> · {fmtDuration(p.ms)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Token usage — Claude Max efficiency tracking. Cost-in-dollars
          isn't useful under flat-rate Max, so we surface volume + cache
          efficiency instead. Hidden entirely if no token data exists
          yet (e.g. before backfill / forward-only first day). */}
      {stats.tokenTotalsByWindow.all.totalAll > 0 && (
        <Section title="Token usage">
          <div className="stats-trend-callouts">
            <div className="stats-trend-cell">
              <span className="stats-trend-label">This week</span>
              <span className="stats-trend-value">
                {fmtTokens(stats.tokenTotalsByWindow.week.totalAll)}
              </span>
              <span className="stats-trend-caption">
                across {stats.tokenTotalsByWindow.week.n} session{stats.tokenTotalsByWindow.week.n === 1 ? "" : "s"}
              </span>
            </div>
            <div className="stats-trend-cell">
              <span className="stats-trend-label">Cache hit (week)</span>
              <span className="stats-trend-value">
                {stats.tokenTotalsByWindow.week.cacheHitPct}<span className="stats-trend-unit">%</span>
              </span>
              <span className="stats-trend-caption">
                <CacheHitSparkline days={stats.tokensDaily14} />
              </span>
            </div>
            <div className="stats-trend-cell">
              <span className="stats-trend-label">Avg / session</span>
              <span className="stats-trend-value">
                {fmtTokens(stats.tokenTotalsByWindow.all.avgPerSession)}
              </span>
              <span className="stats-trend-caption">
                across {stats.tokenTotalsByWindow.all.n} sessions all-time
              </span>
            </div>
            <div className="stats-trend-cell">
              <span className="stats-trend-label">All-time total</span>
              <span className="stats-trend-value">
                {fmtTokens(stats.tokenTotalsByWindow.all.totalAll)}
              </span>
              <span className="stats-trend-caption">
                cache hit overall {stats.tokenTotalsByWindow.all.cacheHitPct}%
              </span>
            </div>
          </div>

          <h3 className="stats-subhead">Last 14 days</h3>
          {stats.tokensDaily14.every((d) => d.total === 0) ? (
            <EmptyState
              variant="inline"
              message="No token data in last 14 days"
              hint="Run backfill-tokens.py to populate historical sessions; new imports populate forward."
            />
          ) : (
            <TokenDailyChart
              days={stats.tokensDaily14}
              projectName={projectName}
              projectColor={projectColor}
            />
          )}

          <h3 className="stats-subhead">Top projects by tokens</h3>
          <ul className="stats-hot-list">
            {stats.tokensByProject.slice(0, 5).map((p) => {
              const maxTokens = stats.tokensByProject[0]?.total || 1;
              return (
                <li key={p.projectId} className="stats-hot-row">
                  <span className="stats-hot-project">
                    <Dot color={softenColor(p.color || "rgba(0,0,0,0.25)", 0.45)} size={8} />
                    {p.name}
                  </span>
                  <div className="stats-hot-bar-wrap">
                    <div
                      className="stats-hot-bar"
                      style={{
                        width: `${(p.total / maxTokens) * 100}%`,
                        background: softenColor(p.color || "rgba(0,0,0,0.25)", 0.45),
                      }}
                    />
                  </div>
                  <span className="stats-hot-share">
                    {fmtTokens(p.total)}
                    <span className="stats-hot-ms"> · {p.cacheHitPct}% cache</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="stats-footnote">
            Cache hit = cacheRead / (input + cacheCreation + cacheRead).
            Higher = your context reuse is working (Max plan flat-rate, so
            this is the efficiency story, not a billing one).
          </p>
        </Section>
      )}

      {atRiskProjects.length > 0 && (
        <Section title="At-risk projects (no activity in 14+ days)">
          <ul className="stats-atrisk-list">
            {atRiskProjects.map((p) => {
              const ageDays = Math.floor((Date.now() - p.lastActivityMs) / MS_PER_DAY);
              return (
                <li key={p.projectId} className="stats-atrisk-row">
                  <span className="stats-atrisk-project">
                    <Dot color={softenColor(p.color || "rgba(0,0,0,0.25)", 0.45)} size={8} />
                    {p.name}
                  </span>
                  <span className="stats-atrisk-meta">
                    <strong>{p.openCount}</strong> open task{p.openCount === 1 ? "" : "s"}
                  </span>
                  <span className="stats-atrisk-age">
                    no activity in {ageDays} days
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="stats-footnote">
            Projects you've started but haven't touched in 2+ weeks. Worth either
            picking back up or clearing the open tasks.
          </p>
        </Section>
      )}
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
  { id: "trends", label: "Trends" },
];

/* StatsSyncControl — last-import indicator + Sync now button, lifted
   into the PageHeader so it's available on every tab (was previously
   stuck on the Today tab's day picker). Sync flow + status flash same
   as before: PUT the manualSyncTriggers["claude-import"] flag, watcher
   picks it up within ~60s, frontend polls heartbeat for completion. */
function StatsSyncControl({ content, onSync, syncStatus }) {
  const importHeartbeatIso = content?.scheduledTaskHeartbeats?.["import-claude-sessions"];
  const importHeartbeatMs = importHeartbeatIso ? Date.parse(importHeartbeatIso) : null;
  return (
    <div className="stats-sync-control">
      {importHeartbeatMs && (
        <Tooltip
          content={`Last Claude import ran ${new Date(importHeartbeatMs).toLocaleString()}`}
        >
          <span className="stats-sync-meta">
            imported <RelativeTime since={importHeartbeatMs} />
          </span>
        </Tooltip>
      )}
      {syncStatus.phase !== "idle" && (
        <span className={`stats-sync-status is-${syncStatus.phase}`}>
          {syncStatus.message}
        </span>
      )}
      <button
        type="button"
        className="stats-sync-btn"
        onClick={onSync}
        disabled={syncStatus.phase === "requesting" || syncStatus.phase === "waiting"}
        aria-label="Trigger Claude importer and refresh"
      >
        {syncStatus.phase === "waiting"
          ? "Waiting…"
          : syncStatus.phase === "requesting"
            ? "Requesting…"
            : "Sync now"}
      </button>
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
  // syncStatus shape: { phase, message } where phase is one of:
  //   "idle"        nothing in flight
  //   "requesting"  PUT-ing the trigger flag
  //   "waiting"     trigger sent, polling for heartbeat to catch up
  //   "complete"    heartbeat advanced, content refreshed
  //   "timeout"     gave up waiting for heartbeat (importer didn't run)
  //   "error"       network / PUT failure
  // Drives the Sync button label + a brief status flash. Resets to
  // "idle" automatically a few seconds after "complete".
  const [syncStatus, setSyncStatus] = useState({ phase: "idle", message: "" });

  // Reload from the API and re-render. Used by the initial mount only
  // now — the Sync button on Today takes a richer path (trigger + poll)
  // via syncContentWithImporter below.
  function reloadContent() {
    setSyncStatus({ phase: "requesting", message: "Refreshing…" });
    loadAndHydratePreferredContent()
      .then((c) => {
        setContent(c);
        setLoaded(true);
        setSyncStatus({ phase: "idle", message: "" });
      })
      .catch((err) => {
        console.error("Reload failed:", err);
        setSyncStatus({ phase: "error", message: "Refresh failed" });
        setTimeout(() => setSyncStatus({ phase: "idle", message: "" }), 4000);
      });
  }

  /* syncContentWithImporter()
     Full "Sync now" flow:
       1. PUT manualSyncTriggers["claude-import"] = nowIso to the API.
       2. Poll /api/content every 4s for up to 120s, comparing the
          incoming scheduledTaskHeartbeats["import-claude-sessions"]
          against the trigger we just sent.
       3. When the heartbeat catches up, the local watcher has fired
          the importer — refresh content state and flash "Synced".
       4. If we time out, surface that — the watcher might be stopped
          or the importer crashed. The trigger remains in place; a
          future watcher tick can still pick it up.
     The polling cadence is conservative (4s) — local watcher runs
     every 60s so a tighter poll won't catch the importer any sooner. */
  async function syncContentWithImporter() {
    const HEARTBEAT_KEY = "import-claude-sessions";
    const POLL_INTERVAL_MS = 4000;
    const TIMEOUT_MS = 120000;
    try {
      setSyncStatus({ phase: "requesting", message: "Requesting sync…" });
      const triggerIso = await requestManualSync("claude-import", content);
      const triggerMs = Date.parse(triggerIso);
      setSyncStatus({ phase: "waiting", message: "Waiting for importer…" });

      const startedAt = Date.now();
      while (Date.now() - startedAt < TIMEOUT_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        let snap;
        try {
          snap = await fetchRemoteContentSnapshot();
        } catch {
          continue; // transient network error — keep polling
        }
        if (!snap) continue;
        const beatIso = snap?.scheduledTaskHeartbeats?.[HEARTBEAT_KEY];
        const beatMs = beatIso ? Date.parse(beatIso) : null;
        if (Number.isFinite(beatMs) && beatMs >= triggerMs) {
          // Importer ran. Use the snapshot we just fetched as the new
          // content state (saves an extra round trip).
          setContent(snap);
          setSyncStatus({ phase: "complete", message: "Synced" });
          setTimeout(() => setSyncStatus({ phase: "idle", message: "" }), 3000);
          return;
        }
      }
      setSyncStatus({
        phase: "timeout",
        message: "Importer didn't run in time",
      });
      setTimeout(() => setSyncStatus({ phase: "idle", message: "" }), 6000);
    } catch (err) {
      console.error("Sync failed:", err);
      setSyncStatus({ phase: "error", message: "Sync failed" });
      setTimeout(() => setSyncStatus({ phase: "idle", message: "" }), 5000);
    }
  }

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
    return <StatsSkeleton />;
  }

  return (
    <main className="stats-page">
      <PageHeader
        title="Stats"
        actions={
          <StatsSyncControl
            content={content}
            onSync={syncContentWithImporter}
            syncStatus={syncStatus}
          />
        }
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
        {tab === "trends" && <TrendsTab stats={stats} />}
      </div>
    </main>
  );
}
