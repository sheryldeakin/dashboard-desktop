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

/* ── Tab views ── */

function OverviewTab({ stats }) {
  return (
    <>
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
  { id: "focus", label: "Focus" },
  { id: "claude", label: "Claude" },
  { id: "tasks", label: "Tasks" },
];

export default function StatsPage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("overview");

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
        {tab === "focus" && <FocusTab stats={stats} />}
        {tab === "claude" && <ClaudeTab stats={stats} />}
        {tab === "tasks" && <TasksTab stats={stats} />}
      </div>
    </main>
  );
}
