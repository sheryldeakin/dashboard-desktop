import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  createBrowserRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router-dom";
import SideNav from "./components/SideNav.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

// Route elements are lazy-loaded so a fresh visit to /home doesn't have
// to download all of /stats's chart code, etc. Each page becomes its own
// chunk; the top-level bundle drops by ~40%. DashboardPage stays in the
// main bundle because it's defined inline in this file (would need a
// separate extraction to lazy it, not worth the disruption right now).
const SettingsPage = lazy(() => import("./components/SettingsPage.jsx"));
const TodoPage = lazy(() => import("./components/todo/TodoPage.jsx"));
const StatsPage = lazy(() => import("./components/StatsPage.jsx"));
const HomePage = lazy(() => import("./components/HomePage.jsx"));
const HistoryPage = lazy(() => import("./components/HistoryPage.jsx"));
const ChatsLivePage = lazy(() => import("./components/ChatsLivePage.jsx"));
import {
  TITLE,
  START_ISO,
  DEADLINE_ISO,
  DEFAULT_PROJECT,
  MAX_TASK_HISTORY_ITEMS,
  dayMs,
  hourMs,
  minuteMs,
  secondMs,
  parseIsoMs,
  getTodayKey,
  normalizeContentRecord,
  getProjectName,
  formatPriority,
  formatRecurrence,
  isTaskOverdue,
  taskMatchesSidebarSection,
  startTask,
  pauseTask,
  resumeTask,
  stopTask,
  completeTask,
  createHistoryEntry,
  removeLatestHistoryEntry,
  formatDeadlineLocal,
  formatDuration,
  getLiveDurations,
} from "./utils/taskUtils.js";
import { useContent } from "./contexts/ContentContext.jsx";


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
  // Content lives in ContentProvider now — load + persist + rollover all
  // happen there. We just read/mutate via updateContent for any changes
  // that should hit the DB. The old `updateDashboardContent` name is
  // kept below so the rest of the function reads unchanged.
  const { content, updateContent, loaded } = useContent();
  const updateDashboardContent = updateContent;
  const navigate = useNavigate();
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
  // queue grew). Manage which tasks are in Today's Queue via /todo.

  return (
    <main className="page">
      <section className="cs-wrap">
        <div className="cs-card">
          <div className="cs-top-links">
            <Link className="subtle-link" to="/todo">
              Todo
            </Link>
            <Link className="subtle-link" to="/history">
              History
            </Link>
            <Link className="subtle-link" to="/settings">
              Settings
            </Link>
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
                                navigate(`/todo?focus=1&taskId=${encodeURIComponent(task.id)}`);
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

/* Fallback shown while a lazy-loaded route chunk is being fetched.
   Most chunks are small enough that this is invisible on a warm cache;
   only matters on first visit + slow network. */
function RouteSuspenseFallback() {
  return <div className="route-loading">Loading…</div>;
}

/* AppShellLayout — wraps the sidebar pages (/home, /history, /stats,
   /settings). Renders SideNav + an Outlet for the matched child route.
   Suspense wraps the Outlet so each lazy chunk loads cleanly without
   knocking out the surrounding chrome (sidebar stays visible).
   ErrorBoundary wraps Suspense so a page-level crash falls back to a
   fallback UI without taking out the sidebar — user can still navigate
   away. resetKeys: pathname so navigating to a new route clears the
   error state automatically. */
function AppShellLayout() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <SideNav />
      <div className="app-shell-main">
        <ErrorBoundary scope="route" resetKeys={[location.pathname]}>
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

/* NotFound — catch-all for unknown paths. Renders inside AppShellLayout
   so the user keeps the nav for getting unstuck. */
function NotFound() {
  return (
    <main className="not-found">
      <h1 className="not-found-title">Page not found</h1>
      <p className="not-found-text">
        Nothing lives at <code>{window.location.pathname}</code>.
      </p>
      <Link to="/home" className="not-found-link">
        Go home →
      </Link>
    </main>
  );
}

const router = createBrowserRouter([
  // Legacy dashboard — the original small-monitor display. Lives at "/"
  // with no sidebar, just its own self-contained layout.
  { path: "/", element: <DashboardPage /> },

  // /admin folded into /settings on 2026-06-10. Bookmarks still resolve
  // transparently via the Navigate replace — the URL bar updates to
  // /settings so the user sees where they actually landed.
  { path: "/admin", element: <Navigate to="/settings" replace /> },

  // Sidebar-shelled pages. The catch-all (`*`) also lives here so a
  // mis-typed URL renders a 404 page with the sidebar intact, not a
  // blank screen. /todo joined this group in 2026-06-15 (Phase A of the
  // /todo refresh) — FocusMode is position:fixed full-screen so the
  // SideNav underneath is harmless when focus is active.
  {
    element: <AppShellLayout />,
    children: [
      { path: "/home", element: <HomePage /> },
      { path: "/history", element: <HistoryPage /> },
      { path: "/stats", element: <StatsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/todo", element: <TodoPage /> },
      { path: "/chats-live", element: <ChatsLivePage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export default function App() {
  // Top-level ErrorBoundary is the last line of defense. If a layout or
  // routing layer itself crashes (rare — those are stable surfaces),
  // this prevents the whole app from going white-screen. Recovery from
  // here is reload-only since the router context is what broke.
  return (
    <ErrorBoundary scope="app">
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
