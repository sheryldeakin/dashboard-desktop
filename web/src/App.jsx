import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "./components/TopNav.jsx";
import SideNav from "./components/SideNav.jsx";
import {
  TITLE,
  START_ISO,
  DEADLINE_ISO,
  SCHEMA_VERSION,
  DEFAULT_PROJECT,
  MAX_TASK_HISTORY_ITEMS,
  dayMs,
  hourMs,
  minuteMs,
  secondMs,
  parseIsoMs,
  getTodayKey,
  newId,
  DEFAULT_CONTENT,
  cloneContent,
  normalizeContentRecord,
  getProjectName,
  formatPriority,
  formatRecurrence,
  isTaskOverdue,
  taskMatchesSidebarSection,
  persistContent,
  startTask,
  pauseTask,
  resumeTask,
  stopTask,
  completeTask,
  createHistoryEntry,
  removeLatestHistoryEntry,
  applyDailyRollover,
  loadContent,
  loadAndHydratePreferredContent,
  formatDeadlineLocal,
  formatDuration,
  getLiveDurations,
  tasksToText,
  mergeTasksFromText,
} from "./utils/taskUtils.js";
import TodoPage from "./components/todo/TodoPage.jsx";
import StatsPage from "./components/StatsPage.jsx";
import HomePage from "./components/HomePage.jsx";
import HistoryPage from "./components/HistoryPage.jsx";


function useCountdown(deadlineIso = DEADLINE_ISO, startIso = START_ISO) {
  const deadlineMs = new Date(deadlineIso).getTime();
  const startMs = new Date(startIso).getTime();

  const [state, setState] = useState({
    nowMs: Date.now(),
    daysRemaining: "--",
    hoursRemaining: "--",
    minutesRemaining: "--",
    secondsRemaining: "--",
    percentElapsed: "0%",
    deadlineText: "",
    nowText: "",
  });

  useEffect(() => {
    function update() {
      const nowMs = Date.now();
      const msRemaining = Math.max(0, deadlineMs - nowMs);
      const daysRemaining = Math.floor(msRemaining / dayMs);
      const hoursRemaining = Math.floor((msRemaining % dayMs) / hourMs);
      const minutesRemaining = Math.floor((msRemaining % hourMs) / minuteMs);
      const secondsRemaining = Math.floor((msRemaining % minuteMs) / secondMs);

      const totalMs = Math.max(1, deadlineMs - startMs);
      const elapsedMs = Math.min(totalMs, Math.max(0, nowMs - startMs));
      const percentElapsed = Math.round((elapsedMs / totalMs) * 100);

      setState({
        nowMs,
        daysRemaining: String(daysRemaining),
        hoursRemaining: String(hoursRemaining).padStart(2, "0"),
        minutesRemaining: String(minutesRemaining).padStart(2, "0"),
        secondsRemaining: String(secondsRemaining).padStart(2, "0"),
        percentElapsed: `${percentElapsed}%`,
        deadlineText: formatDeadlineLocal(deadlineMs),
        nowText: new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(nowMs),
      });
    }

    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [deadlineMs, startMs]);

  return state;
}

function DashboardPage() {
  // Lazy initializer reads localStorage synchronously so the first paint
  // already shows the user's cached content, avoiding a flash of the
  // hardcoded DEFAULT_CONTENT seed before the async remote fetch resolves.
  // When there's no cache (incognito, cleared storage, schema-version
  // wipe, new device), we still need *something* in state so countdown
  // computations don't crash — we fall back to DEFAULT_CONTENT but flip
  // `loaded=false` so the JSX renders empty placeholders instead of the
  // seed values, then the API fetch in useEffect populates real data.
  const [content, setContent] = useState(() => loadContent() ?? cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(() => loadContent() !== null);
  const countdown = useCountdown(content.deadlineDate, content.startDate);
  const [status, setStatus] = useState("");

  // Inline-editing state
  const [editingField, setEditingField] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPhase, setEditPhase] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const editRef = useRef(null);

  useEffect(() => {
    if (editingField && editRef.current) editRef.current.focus();
  }, [editingField]);

  function startEditing(field) {
    if (field === "title") setEditTitle(content.title || TITLE);
    else if (field === "phase") setEditPhase(content.phase || "");
    else if (field === "deadline") setEditDeadline((content.deadlineDate || DEADLINE_ISO).slice(0, 16));
    setEditingField(field);
  }

  function commitEdit(field) {
    setEditingField(null);
    updateDashboardContent((prev) => {
      if (field === "title") {
        const val = editTitle.trim() || TITLE;
        if (val === prev.title) return prev;
        return normalizeContentRecord({ ...prev, title: val });
      }
      if (field === "phase") {
        const val = editPhase.trim() || prev.phase;
        if (val === prev.phase) return prev;
        return normalizeContentRecord({ ...prev, phase: val });
      }
      if (field === "deadline") {
        const val = editDeadline ? `${editDeadline}:00` : prev.deadlineDate;
        if (val === prev.deadlineDate) return prev;
        return normalizeContentRecord({ ...prev, deadlineDate: val });
      }
      return prev;
    });
  }

  function handleEditKeyDown(e, field) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(field); }
    if (e.key === "Escape") setEditingField(null);
  }
  const defaultProjectId = content.projects[0]?.id || DEFAULT_PROJECT.id;
  const todayKey = getTodayKey(new Date(countdown.nowMs));

  const dashboardTasks = useMemo(
    () => content.todaysTasks.filter((task) => taskMatchesSidebarSection(task, "today", todayKey, defaultProjectId)),
    [content.todaysTasks, todayKey, defaultProjectId]
  );
  const queueCount = dashboardTasks.length;

  // When localStorage cache was empty (incognito, cleared, schema-bump
  // wipe, new device), `content` is the DEFAULT_CONTENT seed — which is
  // hardcoded placeholder data, not the user's. Don't render those seed
  // values; show blanks until the API fetch resolves. The card chrome
  // and structure render exactly the same — only visible data is gated.
  const display = loaded
    ? {
        title: content.title,
        phase: content.phase,
        deadlineText: countdown.deadlineText,
        daysRemaining: countdown.daysRemaining,
        hoursRemaining: countdown.hoursRemaining,
        minutesRemaining: countdown.minutesRemaining,
        secondsRemaining: countdown.secondsRemaining,
        percentElapsed: countdown.percentElapsed,
        tasks: dashboardTasks,
        queueCount,
        emptyMessage: "No tasks in Today queue.",
      }
    : {
        title: "",
        phase: "",
        deadlineText: "",
        daysRemaining: "—",
        hoursRemaining: "--",
        minutesRemaining: "--",
        secondsRemaining: "--",
        percentElapsed: "0%",
        tasks: [],
        queueCount: 0,
        emptyMessage: "Loading…",
      };

  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((next) => {
      if (!isMounted) return;
      // Only re-render when the fetched content actually differs from the
      // already-rendered state. Without this, React paints a redundant
      // re-render after every reload — even when the API returns byte-
      // identical data to what we hydrated from localStorage — which
      // shows up as a tiny visible flicker on the display.
      setContent((prev) => {
        try {
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        } catch {
          // fall through and accept next
        }
        return next;
      });
      setLoaded(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setContent((previous) => {
        const { content: rolled, changed } = applyDailyRollover(previous);
        if (changed) {
          persistContent(rolled);
          return rolled;
        }
        return previous;
      });
    }, 60000);

    return () => window.clearInterval(id);
  }, []);

  function updateDashboardContent(updater) {
    setContent((previous) => {
      const next = updater(previous);
      if (next === previous) return previous;
      persistContent(next);
      return next;
    });
  }

  function handleTaskAction(taskId, action) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();

    updateDashboardContent((previous) => {
      const nextTasks = previous.todaysTasks.map((task) => {
        if (task.id !== taskId) return task;

        if (action === "start") return startTask(task, nowIso);
        if (action === "rest") return pauseTask(task, nowIso, nowMs);
        if (action === "resume") return resumeTask(task, nowIso, nowMs);
        if (action === "stop") return stopTask(task, nowIso, nowMs);

        return task;
      });

      const next = {
        ...previous,
        todaysTasks: nextTasks,
      };
      return next;
    });
  }

  function handleTaskCheckbox(taskId, checked) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();
    const todayKey = getTodayKey(new Date(nowIso));

    updateDashboardContent((previous) => {
      let historyToUse = previous.taskHistory;

      const nextTasks = previous.todaysTasks.map((task) => {
        if (task.id !== taskId) return task;

        if (checked) {
          if (task.done) return task;
          const completed = completeTask(task, nowIso, nowMs);
          historyToUse = [createHistoryEntry(completed, nowIso, todayKey), ...historyToUse].slice(0, MAX_TASK_HISTORY_ITEMS);
          return completed;
        }

        if (!task.done) return task;

        historyToUse = removeLatestHistoryEntry(historyToUse, task.id);
        return {
          ...task,
          done: false,
          updatedAt: nowIso,
          timer: {
            ...task.timer,
            status: "idle",
            pausedAt: null,
            runningStartedAt: null,
          },
        };
      });

      const next = {
        ...previous,
        todaysTasks: nextTasks,
        taskHistory: historyToUse,
      };
      return next;
    });
  }

  // Drag-and-drop between Today's Queue and a backlog list used to live here.
  // The backlog block was removed from the display so the right column stays
  // a stable height (otherwise it pushed the centered countdown down as the
  // queue grew). Manage which tasks are in Today's Queue via /todo or /admin.

  return (
    <main className="page">
      <section className="cs-wrap">
        <div className="cs-card">
          <div className="cs-top-links">
            <a className="subtle-link" href="/todo">
              Todo
            </a>
            <a className="subtle-link" href="/admin">
              Edit
            </a>
            <a className="subtle-link" href="/history">
              History
            </a>
            <a className="subtle-link" href="/settings">
              Settings
            </a>
          </div>
          <div className="cs-now-row">
            <span className="cs-now-time">{countdown.nowText}</span>
          </div>
          <div className="cs-content">
            <section className="cs-left">
              <p className="cs-kicker">Deadline</p>
              {editingField === "title" ? (
                <input
                  ref={editRef}
                  className="cs-title cs-inline-edit"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => commitEdit("title")}
                  onKeyDown={(e) => handleEditKeyDown(e, "title")}
                />
              ) : (
                <h1 className="cs-title cs-editable" onClick={() => startEditing("title")} title="Click to edit">{display.title}</h1>
              )}
              <div className="cs-meta">
                {editingField === "deadline" ? (
                  <input
                    ref={editRef}
                    type="datetime-local"
                    className="cs-inline-edit cs-inline-edit-date"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    onBlur={() => commitEdit("deadline")}
                    onKeyDown={(e) => handleEditKeyDown(e, "deadline")}
                  />
                ) : (
                  <span className="cs-pill cs-editable" onClick={() => startEditing("deadline")} title="Click to edit deadline">
                    <span className="cs-dot" />
                    <span>{display.deadlineText}</span>
                  </span>
                )}
              </div>
              <div className="cs-left-divider" />
              <div className="cs-meta-block">
                <span className="cs-meta-key">Phase</span>
                {editingField === "phase" ? (
                  <input
                    ref={editRef}
                    className="cs-meta-value cs-inline-edit"
                    value={editPhase}
                    onChange={(e) => setEditPhase(e.target.value)}
                    onBlur={() => commitEdit("phase")}
                    onKeyDown={(e) => handleEditKeyDown(e, "phase")}
                  />
                ) : (
                  <span className="cs-meta-value cs-editable" onClick={() => startEditing("phase")} title="Click to edit">{display.phase}</span>
                )}
              </div>
              <div className="cs-small">
                <span>Timeline Elapsed</span>
                <span>{display.percentElapsed}</span>
              </div>
              <div className="cs-bar">
                <div className="cs-fill" style={{ width: display.percentElapsed }} />
              </div>
            </section>

            <section className="cs-center">
              <div className="cs-days">{display.daysRemaining}</div>
              <div className="cs-days-label">Days Remaining</div>
              <div
                className="cs-subtime"
                aria-label={`${display.hoursRemaining} hours ${display.minutesRemaining} minutes ${display.secondsRemaining} seconds`}
              >
                <div className="cs-subtime-values">
                  <span>{display.hoursRemaining}</span>
                  <span className="cs-subtime-sep">:</span>
                  <span>{display.minutesRemaining}</span>
                  <span className="cs-subtime-sep">:</span>
                  <span>{display.secondsRemaining}</span>
                </div>
                <div className="cs-subtime-labels">
                  <span>Hrs</span>
                  <span>Min</span>
                  <span>Sec</span>
                </div>
              </div>
            </section>

            <section className="cs-right">
              <div className="cs-meta-block">
                <div className="cs-list-head">
                  <span className="cs-meta-key">Today's Queue</span>
                  <span className="cs-list-count">{display.queueCount}</span>
                </div>
                <ul className="cs-task-list">
                  {display.tasks.length === 0 ? (
                    <li className="cs-task-row">
                      <span className="cs-task-text">{display.emptyMessage}</span>
                    </li>
                  ) : (
                    display.tasks.map((task) => {
                    const runtime = getLiveDurations(task, countdown.nowMs);
                    const hasProgress =
                      task.timer.totalWorkMs > 0 || task.timer.totalRestMs > 0 || task.timer.sessions.length > 0;
                    const projectName = getProjectName(content.projects, task.projectId);
                    const detailParts = [projectName, formatPriority(task.priority)];
                    if (task.dueDate) detailParts.push(`Due ${task.dueDate}`);
                    if (task.tags.length > 0) detailParts.push(`#${task.tags.join(" #")}`);
                    if (task.recurrence.type !== "none") detailParts.push(formatRecurrence(task.recurrence));
                    const timerText =
                      task.timer.status === "running"
                        ? `Work ${formatDuration(runtime.workMs)}`
                        : task.timer.status === "paused"
                          ? `Rest ${formatDuration(runtime.restMs)}`
                          : "";
                    return (
                      <li
                        key={task.id}
                        className={`cs-task-row${task.done ? " is-done" : ""}`}
                      >
                      <label className={`cs-task-item${task.done ? " is-done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={task.done}
                          onChange={(event) => handleTaskCheckbox(task.id, event.target.checked)}
                        />
                        <div className="cs-task-main">
                          <span className="cs-task-text">{task.text}</span>
                          <span className={`cs-task-submeta${isTaskOverdue(task) ? " is-overdue" : ""}`}>
                            {detailParts.join(" | ")}
                          </span>
                          {timerText && <span className="cs-task-meta">{timerText}</span>}
                          </div>
                        </label>

                        <div className="cs-task-controls">
                          {!task.done && (
                            <button
                              type="button"
                              className="task-btn task-btn-secondary task-btn-icon"
                              onClick={() => {
                                // Auto-assign but don't auto-start (per UX decision):
                                // user clicks Start in focus mode to begin both timers.
                                window.location.href = `/todo?focus=1&taskId=${encodeURIComponent(task.id)}`;
                              }}
                              aria-label="Focus"
                              title="Focus mode"
                            >
                              <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                                <circle cx="12" cy="12" r="3" fill="currentColor" />
                              </svg>
                              <span className="sr-only">Focus</span>
                            </button>
                          )}
                          {task.done ? (
                            <span className="cs-task-status">Completed</span>
                          ) : task.timer.status === "running" ? (
                            <>
                              <button
                                type="button"
                                className="task-btn task-btn-secondary task-btn-icon"
                                onClick={() => handleTaskAction(task.id, "rest")}
                                aria-label="Rest"
                                title="Rest"
                              >
                                <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <rect x="6" y="4" width="4" height="16" rx="1.5" />
                                  <rect x="14" y="4" width="4" height="16" rx="1.5" />
                                </svg>
                                <span className="sr-only">Rest</span>
                              </button>
                            </>
                          ) : task.timer.status === "paused" ? (
                            <>
                              <button
                                type="button"
                                className="task-btn task-btn-secondary task-btn-icon"
                                onClick={() => handleTaskAction(task.id, "resume")}
                                aria-label="Resume"
                                title="Resume"
                              >
                                <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                <span className="sr-only">Resume</span>
                              </button>
                              <button
                                type="button"
                                className="task-btn task-btn-secondary task-btn-icon"
                                onClick={() => handleTaskAction(task.id, "stop")}
                                aria-label="Stop"
                                title="Stop"
                              >
                                <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <rect x="6" y="6" width="12" height="12" rx="1.8" />
                                </svg>
                                <span className="sr-only">Stop</span>
                              </button>
                            </>
                          ) : task.timer.status === "stopped" ? (
                            <>
                              <span className="cs-task-status">Stopped</span>
                              <button
                                type="button"
                                className="task-btn task-btn-secondary task-btn-icon"
                                onClick={() => handleTaskAction(task.id, "start")}
                                aria-label="Resume Task"
                                title="Resume Task"
                              >
                                <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                <span className="sr-only">Resume Task</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="task-btn task-btn-icon"
                              onClick={() => handleTaskAction(task.id, "start")}
                              aria-label={hasProgress ? "Resume Task" : "Start Task"}
                              title={hasProgress ? "Resume Task" : "Start Task"}
                            >
                              <svg className="task-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              <span className="sr-only">{hasProgress ? "Resume Task" : "Start Task"}</span>
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
                </ul>
              </div>
              <p className="cs-status-text">{status}</p>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

function AdminPage() {
  const [phase, setPhase] = useState(DEFAULT_CONTENT.phase);
  const [todaysTasksText, setTodaysTasksText] = useState(tasksToText(DEFAULT_CONTENT.todaysTasks));
  const [existingTasks, setExistingTasks] = useState(cloneContent(DEFAULT_CONTENT).todaysTasks);
  const [projects, setProjects] = useState(cloneContent(DEFAULT_CONTENT).projects);
  const [taskHistory, setTaskHistory] = useState(cloneContent(DEFAULT_CONTENT).taskHistory);
  const [pomodoro, setPomodoro] = useState(cloneContent(DEFAULT_CONTENT).pomodoro);
  const [todaysTasksDate, setTodaysTasksDate] = useState(getTodayKey());
  const [status, setStatus] = useState("");
  const historyDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    []
  );

  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((saved) => {
      if (!isMounted) return;
      setPhase(saved.phase);
      setExistingTasks(saved.todaysTasks);
      setProjects(saved.projects);
      setTodaysTasksText(tasksToText(saved.todaysTasks));
      setTaskHistory(saved.taskHistory);
      setPomodoro(saved.pomodoro);
      setTodaysTasksDate(saved.todaysTasksDate);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleSave(event) {
    event.preventDefault();

    const mergedTasks = mergeTasksFromText(todaysTasksText, existingTasks);
    const next = {
      schemaVersion: SCHEMA_VERSION,
      phase: phase.trim() || DEFAULT_CONTENT.phase,
      projects,
      todaysTasks: mergedTasks,
      todaysTasksDate,
      taskHistory,
      pomodoro,
    };

    persistContent(next);
    setPhase(next.phase);
    setExistingTasks(next.todaysTasks);
    setTodaysTasksText(tasksToText(next.todaysTasks));
    setStatus("Saved.");
  }

  return (
    <main className="page">
      <section className="glass-card admin-card">
        <header className="card-header">
          <h1>Admin</h1>
        </header>

        <form className="admin-form" onSubmit={handleSave}>
          <label className="field">
            <span>Phase</span>
            <input value={phase} onChange={(event) => setPhase(event.target.value)} />
          </label>

          <label className="field">
            <span>Today's Task (one per line)</span>
            <textarea
              rows={5}
              value={todaysTasksText}
              onChange={(event) => setTodaysTasksText(event.target.value)}
            />
          </label>

          <section className="admin-history-block">
            <span className="admin-history-title">Task History</span>
            <ul className="admin-history-list">
              {taskHistory.length === 0 ? (
                <li className="admin-history-empty">No completed tasks yet.</li>
              ) : (
                taskHistory.map((entry) => (
                  <li key={entry.id} className="admin-history-item">
                    <span className="admin-history-text">{entry.text}</span>
                    <span className="admin-history-time">
                      {historyDateFormatter.format(new Date(entry.completedAt))} | Total {formatDuration(entry.totalElapsedMs || 0)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <div className="admin-actions">
            <button type="submit">Save</button>
            <span className="save-status">{status}</span>
          </div>
        </form>
      </section>
    </main>
  );
}

function SettingsPage() {
  const [title, setTitle] = useState(TITLE);
  const [startDate, setStartDate] = useState(START_ISO.slice(0, 16));
  const [deadlineDate, setDeadlineDate] = useState(DEADLINE_ISO.slice(0, 16));
  const [phase, setPhase] = useState(DEFAULT_CONTENT.phase);
  const [projects, setProjects] = useState(cloneContent(DEFAULT_CONTENT).projects);
  const [newProjectName, setNewProjectName] = useState("");
  const [contentRef, setContentRef] = useState(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((saved) => {
      if (!isMounted) return;
      setContentRef(saved);
      setTitle(saved.title || TITLE);
      setStartDate((saved.startDate || START_ISO).slice(0, 16));
      setDeadlineDate((saved.deadlineDate || DEADLINE_ISO).slice(0, 16));
      setPhase(saved.phase);
      setProjects(saved.projects.map((p) => ({ ...p })));
    });

    return () => {
      isMounted = false;
    };
  }, []);

  function handleProjectChange(index, field, value) {
    setProjects((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  function handleAddProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const id = `project-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 5)}`;
    const palette = ["#b66e35", "#5b8a5a", "#477f99", "#a0678c", "#a27d3e"];
    const color = palette[projects.length % palette.length];
    setProjects((prev) => [...prev, { id, name, color }]);
    setNewProjectName("");
  }

  function handleRemoveProject(index) {
    setProjects((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave(event) {
    event.preventDefault();

    const base = contentRef || cloneContent(DEFAULT_CONTENT);
    const next = normalizeContentRecord({
      ...base,
      title: title.trim() || TITLE,
      startDate: startDate ? `${startDate}:00` : START_ISO,
      deadlineDate: deadlineDate ? `${deadlineDate}:00` : DEADLINE_ISO,
      phase: phase.trim() || DEFAULT_CONTENT.phase,
      projects: projects.filter((p) => p.name.trim()),
    });

    persistContent(next);
    setContentRef(next);
    setProjects(next.projects.map((p) => ({ ...p })));
    setStatus("Saved.");
  }

  return (
    <main className="settings-page">
      <div className="settings-shell">
        <header className="settings-header">
          <h1>Settings</h1>
        </header>

        <form className="settings-form" onSubmit={handleSave}>
          <section className="settings-section">
            <h2 className="settings-section-title">Dashboard Config</h2>

            <label className="settings-field">
              <span className="settings-label">Title</span>
              <input
                type="text"
                className="settings-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="AAAI 2027 Submission"
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Start Date</span>
              <input
                type="datetime-local"
                className="settings-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Deadline</span>
              <input
                type="datetime-local"
                className="settings-input"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
              />
            </label>

            <label className="settings-field">
              <span className="settings-label">Phase</span>
              <input
                type="text"
                className="settings-input"
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                placeholder="Phase 2 - Revision"
              />
            </label>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">Projects</h2>

            <ul className="settings-project-list">
              {projects.map((project, index) => {
                const isDefault = project.id === DEFAULT_PROJECT.id;
                return (
                  <li key={project.id} className="settings-project-row">
                    <input
                      type="color"
                      className="settings-color-input"
                      value={project.color}
                      onChange={(e) => handleProjectChange(index, "color", e.target.value)}
                      title="Project color"
                    />
                    <input
                      type="text"
                      className="settings-input settings-project-name"
                      value={project.name}
                      onChange={(e) => handleProjectChange(index, "name", e.target.value)}
                      placeholder="Project name"
                    />
                    {!isDefault && (
                      <button
                        type="button"
                        className="settings-remove-btn"
                        onClick={() => handleRemoveProject(index)}
                        title="Remove project"
                      >
                        &times;
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="settings-add-row">
              <input
                type="text"
                className="settings-input settings-add-input"
                placeholder="New project name…"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddProject();
                  }
                }}
              />
              <button type="button" className="settings-add-btn" onClick={handleAddProject}>
                Add
              </button>
            </div>
          </section>

          <div className="settings-actions">
            <button type="submit" className="settings-save-btn">Save</button>
            <span className="settings-status">{status}</span>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function App() {
  if (window.location.pathname === "/todo") {
    return (
      <>
        <TopNav />
        <TodoPage />
      </>
    );
  }

  if (window.location.pathname === "/admin") {
    return (
      <>
        <TopNav />
        <AdminPage />
      </>
    );
  }

  if (window.location.pathname === "/history") {
    return (
      <div className="app-shell">
        <SideNav />
        <div className="app-shell-main">
          <HistoryPage />
        </div>
      </div>
    );
  }

  if (window.location.pathname === "/stats") {
    return (
      <div className="app-shell">
        <SideNav />
        <div className="app-shell-main">
          <StatsPage />
        </div>
      </div>
    );
  }

  if (window.location.pathname === "/home") {
    return (
      <div className="app-shell">
        <SideNav />
        <div className="app-shell-main">
          <HomePage />
        </div>
      </div>
    );
  }

  if (window.location.pathname === "/settings") {
    return (
      <>
        <TopNav />
        <SettingsPage />
      </>
    );
  }

  return (
    <>
      <DashboardPage />
    </>
  );
}
