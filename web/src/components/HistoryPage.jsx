/* /history — completed tasks + pomodoro sessions log.
   Migrated to the shared component library. Uses:
     - PageHeader for title + summary chips (count + total focus + last-done)
     - Section for the two main blocks
     - EmptyState for empties
     - Chip for priority / tags / recurrence labels
     - Dot for project color indicators
     - RelativeTime for completion timestamps
     - Tooltip for absolute-time on hover over relative-time

   Date grouping: completed-tasks list is bucketed into "Today" /
   "Yesterday" / "Mon, Jun 1" groups with a small date header per group.
   Pomodoro list stays flat (high-volume, low-detail) but capped at 120
   for performance.

   Native <details>/<summary> for the per-task sessions expander — no JS
   state needed, browser-default keyboard support comes for free. */

import { useEffect, useMemo, useState } from "react";
import {
  cloneContent,
  DEFAULT_CONTENT,
  getProjectName,
  formatPriority,
  formatRecurrence,
  formatDuration,
  loadAndHydratePreferredContent,
} from "../utils/taskUtils.js";

import PageHeader from "./PageHeader.jsx";
import Section from "./Section.jsx";
import EmptyState from "./EmptyState.jsx";
import Chip from "./Chip.jsx";
import Dot from "./Dot.jsx";
import RelativeTime from "./RelativeTime.jsx";
import Tooltip from "./Tooltip.jsx";

const MS_PER_MIN = 60 * 1000;
const MS_PER_HR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HR;

function fmtHrMin(ms) {
  const min = Math.floor((ms || 0) / MS_PER_MIN);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getDateGroupLabel(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - MS_PER_DAY);
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (dDay === today.getTime()) return "Today";
  if (dDay === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const PRIORITY_TONE = {
  high: "warn",
  medium: "pill",
  low: "pill",
};

// Icons for empty states + meta — same stroke-based set we use elsewhere.
const HISTORY_ICONS = {
  pageClean: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4h9l4 4v12H6z" />
      <path d="M15 4v4h4" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  ),
  pomo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="7" />
      <path d="M12 13V9" />
      <path d="M10 4h4" />
    </svg>
  ),
};

function HistoryRow({ entry, projects, projectColor }) {
  const completedMs = new Date(entry.completedAt).getTime();
  const hasSessions = Array.isArray(entry.sessions) && entry.sessions.length > 0;
  const tagsList = Array.isArray(entry.tags) ? entry.tags : [];
  const recurrenceLabel =
    entry.recurrence?.type && entry.recurrence.type !== "none"
      ? formatRecurrence(entry.recurrence)
      : null;
  const projectName = getProjectName(projects, entry.projectId);

  return (
    <li className="history-row">
      {/* Top row: project dot + task text + completed-when */}
      <div className="history-row-main">
        <Dot color={projectColor} size={8} />
        <span className="history-row-text">{entry.text}</span>
        <Tooltip content={new Date(entry.completedAt).toLocaleString()}>
          <span className="history-row-when">
            <RelativeTime since={completedMs} />
          </span>
        </Tooltip>
      </div>

      {/* Meta row: chips + numeric stats */}
      <div className="history-row-meta">
        <Chip className="history-meta-chip">{projectName}</Chip>
        {entry.priority && entry.priority !== "medium" && (
          <Chip tone={PRIORITY_TONE[entry.priority] || "pill"} className="history-meta-chip">
            {formatPriority(entry.priority)}
          </Chip>
        )}
        {entry.dueDate && (
          <Chip className="history-meta-chip">Due {entry.dueDate}</Chip>
        )}
        {recurrenceLabel && (
          <Chip className="history-meta-chip">{recurrenceLabel}</Chip>
        )}
        {tagsList.length > 0 && (
          <span className="history-row-tags">
            {tagsList.map((t) => (
              <span key={t} className="history-row-tag">#{t}</span>
            ))}
          </span>
        )}
        {entry.pomodorosCompleted > 0 && (
          <Chip className="history-meta-chip">
            <strong>{entry.pomodorosCompleted}</strong>{" "}
            {entry.pomodorosCompleted === 1 ? "pomodoro" : "pomodoros"}
          </Chip>
        )}
        {entry.totalWorkMs > 0 && (
          <Tooltip content={`Work ${fmtHrMin(entry.totalWorkMs)} · Rest ${fmtHrMin(entry.totalRestMs)} · Total ${fmtHrMin(entry.totalElapsedMs)}`}>
            <Chip className="history-meta-chip">
              <strong>{fmtHrMin(entry.totalWorkMs)}</strong> focused
            </Chip>
          </Tooltip>
        )}
      </div>

      {/* Sessions expander — native <details>, no JS state needed */}
      {hasSessions && (
        <details className="history-row-sessions">
          <summary>
            <span className="history-row-sessions-count">
              {entry.sessions.length} {entry.sessions.length === 1 ? "session" : "sessions"}
            </span>
          </summary>
          <ul className="history-sessions-list">
            {entry.sessions.map((session) => (
              <li key={session.id} className={`history-session${session.type === "rest" ? " is-rest" : ""}`}>
                <span className="history-session-kind">
                  {session.type === "work" ? "Work" : "Rest"}
                </span>
                <span className="history-session-time">
                  {new Date(session.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  {" – "}
                  {new Date(session.end).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="history-session-duration">
                  {formatDuration(session.durationMs || 0)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/* Claude Code session row — surfaces what was worked on via the
   automated import (no manual checkbox needed). Project dot + name,
   active-time duration, message count as a "how chatty" indicator,
   relative start time. Linking to the transcript file is deferred —
   transcripts live in ~/.claude/ and aren't directly clickable from
   the browser. Could add a "copy transcript path" affordance later. */
function ClaudeSessionRow({ session, projectName, projectColor }) {
  const startedMs = new Date(session.startedAt).getTime();
  const durationMs = session.activeMs || 0;
  const msgCount = session.messageCount || 0;
  const completedTasks = Array.isArray(session.completedTasks) ? session.completedTasks : [];
  const hasCompletions = completedTasks.length > 0;

  return (
    <li className="history-claude-row-wrap">
      <div className="history-claude-row">
        <span className="history-claude-project">
          <Dot color={projectColor || "rgba(0,0,0,0.25)"} size={8} />
          {projectName || "Unassigned"}
        </span>
        <Tooltip content={`${msgCount} message${msgCount === 1 ? "" : "s"}`}>
          <span className="history-claude-msgs">
            {msgCount} msg
          </span>
        </Tooltip>
        <span className="history-claude-duration">
          {fmtHrMin(durationMs)}
        </span>
        <Tooltip content={new Date(session.startedAt).toLocaleString()}>
          <span className="history-claude-when">
            <RelativeTime since={startedMs} />
          </span>
        </Tooltip>
      </div>

      {/* Auto-extracted task completions from the transcript. Collapsible
          so the list stays compact when the session shipped a lot. */}
      {hasCompletions && (
        <details className="history-claude-completions">
          <summary>
            <span className="history-claude-completions-count">
              {completedTasks.length} completed
              {completedTasks.length === 1 ? " task" : " tasks"}
            </span>
          </summary>
          <ul className="history-claude-completions-list">
            {completedTasks.map((t, i) => (
              <li key={i} className="history-claude-completion">
                <span className="history-claude-completion-check" aria-hidden="true">✓</span>
                <span className="history-claude-completion-subject">{t.subject}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function PomodoroRow({ entry, projectColor, taskText }) {
  const endedMs = new Date(entry.endedAt).getTime();
  const isWork = entry.type === "work" || entry.type === "focus";
  return (
    <li className={`history-pomo-row${isWork ? " is-work" : " is-rest"}`}>
      <span className="history-pomo-kind">
        <Dot
          color={isWork ? "var(--accent-sage)" : "var(--accent-tan)"}
          size={6}
        />
        {isWork ? "Focus" : "Rest"}
      </span>
      <span className="history-pomo-task">
        {entry.taskId && projectColor && (
          <Dot color={projectColor} size={6} />
        )}
        {taskText || "No task"}
      </span>
      <span className="history-pomo-duration">
        {formatDuration(entry.durationMs || 0)}
      </span>
      <Tooltip content={new Date(entry.endedAt).toLocaleString()}>
        <span className="history-pomo-when">
          <RelativeTime since={endedMs} />
        </span>
      </Tooltip>
    </li>
  );
}

export default function HistoryPage() {
  const [taskHistory, setTaskHistory] = useState([]);
  const [pomodoroHistory, setPomodoroHistory] = useState([]);
  const [workSessions, setWorkSessions] = useState([]);
  const [projects, setProjects] = useState(cloneContent(DEFAULT_CONTENT).projects);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;
    loadAndHydratePreferredContent().then((content) => {
      if (!isMounted) return;
      setTaskHistory(content.taskHistory || []);
      setPomodoroHistory(content.pomodoro?.history || []);
      setWorkSessions(content.workSessions || []);
      setProjects(content.projects || []);
      setLoaded(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Project id → color, with a fallback for the legacy default color.
  // Same fallback palette /home uses so colors agree across pages.
  const PALETTE = [
    "#5a7e5f", "#8a6940", "#4a5a70", "#c45c4a",
    "#7a5b9c", "#5c8aa8", "#8aa05c",
  ];
  const DEFAULT_COLORS = new Set(["#b66e35", "", null, undefined]);
  const projectColor = useMemo(() => {
    const m = new Map();
    projects.forEach((p, i) => {
      const c = DEFAULT_COLORS.has(p.color) ? PALETTE[i % PALETTE.length] : p.color;
      m.set(p.id, c);
    });
    return m;
  }, [projects]);

  // Summary stats for the page header chips
  const summary = useMemo(() => {
    const totalDone = taskHistory.length;
    const totalWorkMs = taskHistory.reduce((sum, e) => sum + (e.totalWorkMs || 0), 0);
    const lastCompletedMs = totalDone > 0
      ? new Date(taskHistory[0].completedAt).getTime()
      : null;
    return { totalDone, totalWorkMs, lastCompletedMs };
  }, [taskHistory]);

  // Group completed-task entries by their completion date for date headers
  const tasksByDate = useMemo(() => {
    const groups = new Map();
    for (const entry of taskHistory) {
      const label = getDateGroupLabel(entry.completedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(entry);
    }
    return [...groups.entries()];
  }, [taskHistory]);

  // Claude sessions — automated record of "what I worked on" via Claude
  // Code. Filtered to source === "claude_code" so this section reflects
  // only the imported sessions (task-timer sessions live with their
  // tasks). Sorted newest first, grouped by start date.
  const claudeSessionsByDate = useMemo(() => {
    const claude = (workSessions || [])
      .filter((s) => s.source === "claude_code")
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const groups = new Map();
    for (const s of claude) {
      const label = getDateGroupLabel(s.startedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(s);
    }
    return [...groups.entries()];
  }, [workSessions]);

  const claudeTotalMs = useMemo(
    () => (workSessions || [])
      .filter((s) => s.source === "claude_code")
      .reduce((sum, s) => sum + (s.activeMs || 0), 0),
    [workSessions]
  );
  const claudeSessionCount = useMemo(
    () => (workSessions || []).filter((s) => s.source === "claude_code").length,
    [workSessions]
  );

  // Pomodoro entry's task text lookup (so the pomo list can show task
  // name even though it stores only taskId)
  const taskTextById = useMemo(() => {
    const m = new Map();
    for (const entry of taskHistory) {
      m.set(entry.sourceTaskId, entry.text);
    }
    return m;
  }, [taskHistory]);

  // Pomodoro entry's project color lookup via the task
  const taskProjectByTaskId = useMemo(() => {
    const m = new Map();
    for (const entry of taskHistory) {
      m.set(entry.sourceTaskId, entry.projectId);
    }
    return m;
  }, [taskHistory]);

  const headerChips = loaded
    ? [
        <Chip key="count"><strong>{summary.totalDone}</strong> {summary.totalDone === 1 ? "task" : "tasks"} completed</Chip>,
        summary.totalWorkMs > 0 && (
          <Chip key="focus"><strong>{fmtHrMin(summary.totalWorkMs)}</strong> focused total</Chip>
        ),
        summary.lastCompletedMs && (
          <Chip key="last">
            Last <RelativeTime since={summary.lastCompletedMs} />
          </Chip>
        ),
      ].filter(Boolean)
    : [];

  return (
    <main className="history-page">
      <PageHeader title="History" chips={headerChips} />

      <Section
        title="Completed tasks"
        meta={summary.totalDone > 0 ? (
          <span className="home-section-meta">
            <strong>{summary.totalDone}</strong>
            {summary.totalDone === 1 ? " item" : " items"}
          </span>
        ) : null}
      >
        {taskHistory.length === 0 ? (
          <EmptyState
            icon={HISTORY_ICONS.pageClean}
            message="No completed tasks yet"
            hint="When you check off a task it lands here with all its session detail."
          />
        ) : (
          <div className="history-tasks">
            {tasksByDate.map(([label, entries]) => (
              <div key={label} className="history-date-group">
                <div className="history-date-header">
                  <span>{label}</span>
                  <span className="history-date-count">
                    {entries.length}
                  </span>
                </div>
                <ul className="history-rows">
                  {entries.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      projects={projects}
                      projectColor={projectColor.get(entry.projectId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Claude sessions"
        meta={claudeSessionCount > 0 ? (
          <span className="home-section-meta">
            <strong>{claudeSessionCount}</strong>
            {claudeSessionCount === 1 ? " session" : " sessions"}
            <span className="home-section-meta-sep" aria-hidden="true">·</span>
            <strong>{fmtHrMin(claudeTotalMs)}</strong>
          </span>
        ) : null}
      >
        {claudeSessionCount === 0 ? (
          <EmptyState
            icon={HISTORY_ICONS.pageClean}
            message="No Claude sessions imported yet"
            hint="The hourly import-claude-sessions task pulls completed Claude Code sessions here. Sessions log automatically — no manual tracking needed."
          />
        ) : (
          <div className="history-tasks">
            {claudeSessionsByDate.map(([label, sessions]) => {
              const dayMs = sessions.reduce((sum, s) => sum + (s.activeMs || 0), 0);
              return (
                <div key={label} className="history-date-group">
                  <div className="history-date-header">
                    <span>{label}</span>
                    <span className="history-date-count">
                      {sessions.length} · {fmtHrMin(dayMs)}
                    </span>
                  </div>
                  <ul className="history-claude-list">
                    {sessions.map((s) => (
                      <ClaudeSessionRow
                        key={s.id}
                        session={s}
                        projectName={getProjectName(projects, s.projectId)}
                        projectColor={projectColor.get(s.projectId)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Pomodoro sessions"
        meta={pomodoroHistory.length > 0 ? (
          <span className="home-section-meta">
            <strong>{Math.min(pomodoroHistory.length, 120)}</strong>
            {pomodoroHistory.length > 120 ? ` of ${pomodoroHistory.length}` : ""}
          </span>
        ) : null}
      >
        {pomodoroHistory.length === 0 ? (
          <EmptyState
            icon={HISTORY_ICONS.pomo}
            message="No pomodoro sessions yet"
            hint="Start a pomodoro on any task and the cycles show up here."
          />
        ) : (
          <ul className="history-pomo-list">
            {pomodoroHistory.slice(0, 120).map((entry) => {
              const taskProjectId = taskProjectByTaskId.get(entry.taskId);
              return (
                <PomodoroRow
                  key={entry.id}
                  entry={entry}
                  projectColor={projectColor.get(taskProjectId)}
                  taskText={entry.taskId ? taskTextById.get(entry.taskId) : null}
                />
              );
            })}
          </ul>
        )}
      </Section>
    </main>
  );
}
