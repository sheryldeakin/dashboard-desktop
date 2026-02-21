import { useEffect, useMemo, useState } from "react";

const TITLE = "ARR Submission";
const START_ISO = "2026-02-12T00:00:00";
const DEADLINE_ISO = "2026-03-16T23:59:00";

const STORAGE_KEY = "arr_dashboard_content_v1";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
const dayMs = 1000 * 60 * 60 * 24;
const hourMs = 1000 * 60 * 60;
const minuteMs = 1000 * 60;
const secondMs = 1000;

function parseIsoMs(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultTimer() {
  return {
    status: "idle",
    runningStartedAt: null,
    pausedAt: null,
    totalWorkMs: 0,
    totalRestMs: 0,
    sessions: [],
  };
}

function normalizeSessions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((session) => {
      if (!session || (session.type !== "work" && session.type !== "rest")) return null;
      const startMs = parseIsoMs(session.start);
      const endMs = parseIsoMs(session.end);
      if (startMs === null || endMs === null || endMs <= startMs) return null;

      const durationMs =
        typeof session.durationMs === "number" && Number.isFinite(session.durationMs) && session.durationMs > 0
          ? session.durationMs
          : endMs - startMs;

      return {
        id: typeof session.id === "string" && session.id ? session.id : newId("sess"),
        type: session.type,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        durationMs,
      };
    })
    .filter(Boolean);
}

function normalizeTimer(value, done) {
  const fallback = createDefaultTimer();
  if (!value || typeof value !== "object") {
    return done ? { ...fallback, status: "completed" } : fallback;
  }

  const statusOptions = new Set(["idle", "running", "paused", "stopped", "completed"]);
  let status = statusOptions.has(value.status) ? value.status : done ? "completed" : "idle";

  const runningStartedAt = parseIsoMs(value.runningStartedAt) !== null ? value.runningStartedAt : null;
  const pausedAt = parseIsoMs(value.pausedAt) !== null ? value.pausedAt : null;

  const totalWorkMs =
    typeof value.totalWorkMs === "number" && Number.isFinite(value.totalWorkMs) && value.totalWorkMs >= 0
      ? value.totalWorkMs
      : 0;
  const totalRestMs =
    typeof value.totalRestMs === "number" && Number.isFinite(value.totalRestMs) && value.totalRestMs >= 0
      ? value.totalRestMs
      : 0;

  if (status === "running" && !runningStartedAt) status = "idle";
  if (status === "paused" && !pausedAt) status = "idle";
  if (done) status = "completed";

  return {
    status,
    runningStartedAt: status === "running" ? runningStartedAt : null,
    pausedAt: status === "paused" ? pausedAt : null,
    totalWorkMs,
    totalRestMs,
    sessions: normalizeSessions(value.sessions),
  };
}

const DEFAULT_CONTENT = {
  phase: "Phase 2 - Revision",
  todaysTasks: [
    {
      id: "task-default-1",
      text: "Finalize abstract edits and update citations.",
      done: false,
      timer: createDefaultTimer(),
    },
  ],
  todaysTasksDate: getTodayKey(),
  taskHistory: [],
};

function cloneTask(task) {
  return {
    id: task.id,
    text: task.text,
    done: task.done,
    timer: {
      ...task.timer,
      sessions: task.timer.sessions.map((session) => ({ ...session })),
    },
  };
}

function cloneContent(content) {
  return {
    phase: content.phase,
    todaysTasks: content.todaysTasks.map(cloneTask),
    todaysTasksDate: content.todaysTasksDate,
    taskHistory: content.taskHistory.map((entry) => ({
      ...entry,
      sessions: Array.isArray(entry.sessions) ? entry.sessions.map((session) => ({ ...session })) : [],
    })),
  };
}

function normalizeTasks(value) {
  if (Array.isArray(value)) {
    const normalized = value
      .map((task) => {
        if (!task || typeof task.text !== "string") return null;
        const text = task.text.trim();
        if (!text) return null;

        const doneFromData = Boolean(task.done);
        const timer = normalizeTimer(task.timer, doneFromData);
        const done = doneFromData || timer.status === "completed";

        return {
          id: typeof task.id === "string" && task.id ? task.id : newId("task"),
          text,
          done,
          timer: normalizeTimer(task.timer, done),
        };
      })
      .filter(Boolean);

    if (normalized.length > 0) return normalized;
  }

  if (typeof value === "string" && value.trim()) {
    const fromLines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ id: newId("task"), text, done: false, timer: createDefaultTimer() }));

    if (fromLines.length > 0) return fromLines;
  }

  return cloneContent(DEFAULT_CONTENT).todaysTasks;
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry.text !== "string") return null;
      const text = entry.text.trim();
      if (!text) return null;

      const completedAtRaw =
        typeof entry.completedAt === "string" && parseIsoMs(entry.completedAt) !== null
          ? entry.completedAt
          : typeof entry.checkedAt === "string" && parseIsoMs(entry.checkedAt) !== null
            ? entry.checkedAt
            : new Date().toISOString();

      const totalWorkMs =
        typeof entry.totalWorkMs === "number" && Number.isFinite(entry.totalWorkMs) && entry.totalWorkMs >= 0
          ? entry.totalWorkMs
          : 0;
      const totalRestMs =
        typeof entry.totalRestMs === "number" && Number.isFinite(entry.totalRestMs) && entry.totalRestMs >= 0
          ? entry.totalRestMs
          : 0;

      const sessions = normalizeSessions(entry.sessions);
      const totalElapsedMs =
        typeof entry.totalElapsedMs === "number" && Number.isFinite(entry.totalElapsedMs) && entry.totalElapsedMs >= 0
          ? entry.totalElapsedMs
          : totalWorkMs + totalRestMs;

      return {
        id: typeof entry.id === "string" && entry.id ? entry.id : newId("hist"),
        sourceTaskId: typeof entry.sourceTaskId === "string" ? entry.sourceTaskId : "",
        text,
        completedAt: completedAtRaw,
        day: typeof entry.day === "string" && entry.day ? entry.day : getTodayKey(new Date(completedAtRaw)),
        totalWorkMs,
        totalRestMs,
        totalElapsedMs,
        sessions,
      };
    })
    .filter(Boolean);
}

function tasksToText(tasks) {
  return tasks.map((task) => task.text).join("\n");
}

function mergeTasksFromText(text, previousTasks) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return cloneContent(DEFAULT_CONTENT).todaysTasks;
  }

  const used = new Set();
  return lines.map((line) => {
    const index = previousTasks.findIndex(
      (task, idx) => !used.has(idx) && task.text.toLowerCase() === line.toLowerCase()
    );

    if (index >= 0) {
      used.add(index);
      return {
        ...cloneTask(previousTasks[index]),
        text: line,
      };
    }

    return { id: newId("task"), text: line, done: false, timer: createDefaultTimer() };
  });
}

function normalizeContentRecord(record) {
  if (!record || typeof record !== "object") {
    return cloneContent(DEFAULT_CONTENT);
  }

  return {
    phase: typeof record.phase === "string" && record.phase.trim() ? record.phase : DEFAULT_CONTENT.phase,
    todaysTasks: normalizeTasks(record.todaysTasks ?? record.todaysTask),
    todaysTasksDate:
      typeof record.todaysTasksDate === "string" && record.todaysTasksDate ? record.todaysTasksDate : getTodayKey(),
    taskHistory: normalizeHistory(record.taskHistory),
  };
}

function loadContent() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneContent(DEFAULT_CONTENT);

    return normalizeContentRecord(JSON.parse(raw));
  } catch {
    return cloneContent(DEFAULT_CONTENT);
  }
}

function saveContent(nextContent) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextContent));
}

function getApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function fetchRemoteContent() {
  if (!API_BASE_URL) return null;

  const response = await fetch(getApiUrl("/api/content"));
  if (!response.ok) {
    throw new Error(`Failed to fetch content (${response.status})`);
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") return null;
  return payload.content ?? null;
}

async function saveRemoteContent(nextContent) {
  if (!API_BASE_URL) return;

  const response = await fetch(getApiUrl("/api/content"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(nextContent),
  });

  if (!response.ok) {
    throw new Error(`Failed to save content (${response.status})`);
  }
}

function persistContent(nextContent) {
  saveContent(nextContent);

  if (!API_BASE_URL) return;

  saveRemoteContent(nextContent).catch((error) => {
    console.error("Failed to sync content to API:", error);
  });
}

function appendWorkSession(timer, nowIso, nowMs) {
  if (timer.status !== "running" || !timer.runningStartedAt) return timer;
  const startMs = parseIsoMs(timer.runningStartedAt);
  if (startMs === null || nowMs <= startMs) {
    return {
      ...timer,
      runningStartedAt: null,
    };
  }

  const durationMs = nowMs - startMs;
  return {
    ...timer,
    runningStartedAt: null,
    totalWorkMs: timer.totalWorkMs + durationMs,
    sessions: [
      ...timer.sessions,
      {
        id: newId("sess"),
        type: "work",
        start: timer.runningStartedAt,
        end: nowIso,
        durationMs,
      },
    ],
  };
}

function appendRestSession(timer, nowIso, nowMs) {
  if (timer.status !== "paused" || !timer.pausedAt) return timer;
  const startMs = parseIsoMs(timer.pausedAt);
  if (startMs === null || nowMs <= startMs) {
    return {
      ...timer,
      pausedAt: null,
    };
  }

  const durationMs = nowMs - startMs;
  return {
    ...timer,
    pausedAt: null,
    totalRestMs: timer.totalRestMs + durationMs,
    sessions: [
      ...timer.sessions,
      {
        id: newId("sess"),
        type: "rest",
        start: timer.pausedAt,
        end: nowIso,
        durationMs,
      },
    ],
  };
}

function startTask(task, nowIso) {
  if (task.done || task.timer.status === "running") return task;

  if (task.timer.status === "paused") {
    return resumeTask(task, nowIso, parseIsoMs(nowIso) ?? Date.now());
  }

  return {
    ...task,
    timer: {
      ...task.timer,
      status: "running",
      runningStartedAt: nowIso,
      pausedAt: null,
    },
  };
}

function pauseTask(task, nowIso, nowMs) {
  if (task.done || task.timer.status !== "running") return task;

  const worked = appendWorkSession(task.timer, nowIso, nowMs);
  return {
    ...task,
    timer: {
      ...worked,
      status: "paused",
      pausedAt: nowIso,
    },
  };
}

function resumeTask(task, nowIso, nowMs) {
  if (task.done || task.timer.status !== "paused") return task;

  const rested = appendRestSession(task.timer, nowIso, nowMs);
  return {
    ...task,
    timer: {
      ...rested,
      status: "running",
      runningStartedAt: nowIso,
      pausedAt: null,
    },
  };
}

function stopTask(task, nowIso, nowMs) {
  if (task.done) return task;

  let timer = { ...task.timer };
  if (timer.status === "running") {
    timer = appendWorkSession(timer, nowIso, nowMs);
  } else if (timer.status === "paused") {
    timer = appendRestSession(timer, nowIso, nowMs);
  }

  return {
    ...task,
    timer: {
      ...timer,
      status: "stopped",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

function completeTask(task, nowIso, nowMs) {
  if (task.done) return task;

  let timer = { ...task.timer };
  if (timer.status === "running") {
    timer = appendWorkSession(timer, nowIso, nowMs);
  } else if (timer.status === "paused") {
    timer = appendRestSession(timer, nowIso, nowMs);
  }

  return {
    ...task,
    done: true,
    timer: {
      ...timer,
      status: "completed",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

function freezeTaskForRollover(task, nowIso, nowMs) {
  if (task.done) return task;

  let timer = { ...task.timer };
  if (timer.status === "running") {
    timer = appendWorkSession(timer, nowIso, nowMs);
  } else if (timer.status === "paused") {
    timer = appendRestSession(timer, nowIso, nowMs);
  }

  return {
    ...task,
    timer: {
      ...timer,
      status: "idle",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

function createHistoryEntry(task, nowIso, day) {
  const totalWorkMs = task.timer.totalWorkMs;
  const totalRestMs = task.timer.totalRestMs;
  return {
    id: newId("hist"),
    sourceTaskId: task.id,
    text: task.text,
    completedAt: nowIso,
    day,
    totalWorkMs,
    totalRestMs,
    totalElapsedMs: totalWorkMs + totalRestMs,
    sessions: task.timer.sessions.map((session) => ({ ...session })),
  };
}

function removeLatestHistoryEntry(history, taskId) {
  const index = history.findIndex((entry) => entry.sourceTaskId === taskId);
  if (index < 0) return history;
  return history.filter((_, i) => i !== index);
}

function applyDailyRollover(content) {
  const todayKey = getTodayKey();
  if (content.todaysTasksDate === todayKey) {
    return { content, changed: false };
  }

  const nowIso = new Date().toISOString();
  const nowMs = parseIsoMs(nowIso) ?? Date.now();

  return {
    content: {
      ...content,
      todaysTasks: content.todaysTasks.filter((task) => !task.done).map((task) => freezeTaskForRollover(task, nowIso, nowMs)),
      todaysTasksDate: todayKey,
    },
    changed: true,
  };
}

function loadAndHydrateContent() {
  const loaded = loadContent();
  const { content, changed } = applyDailyRollover(loaded);
  if (changed) saveContent(content);
  return content;
}

async function loadAndHydratePreferredContent() {
  const local = loadAndHydrateContent();
  if (!API_BASE_URL) return local;

  try {
    const remote = await fetchRemoteContent();
    if (!remote) {
      saveRemoteContent(local).catch((error) => {
        console.error("Failed to seed API content:", error);
      });
      return local;
    }

    const normalizedRemote = normalizeContentRecord(remote);
    const { content: rolledRemote, changed } = applyDailyRollover(normalizedRemote);
    saveContent(rolledRemote);

    if (changed) {
      saveRemoteContent(rolledRemote).catch((error) => {
        console.error("Failed to update API after rollover:", error);
      });
    }

    return rolledRemote;
  } catch (error) {
    console.error("Failed to load remote content, using local content:", error);
    return local;
  }
}

function formatDeadlineLocal(deadlineMs) {
  return new Date(deadlineMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getLiveDurations(task, nowMs) {
  let workMs = task.timer.totalWorkMs;
  let restMs = task.timer.totalRestMs;

  if (task.timer.status === "running" && task.timer.runningStartedAt) {
    const startMs = parseIsoMs(task.timer.runningStartedAt);
    if (startMs !== null && nowMs > startMs) workMs += nowMs - startMs;
  }

  if (task.timer.status === "paused" && task.timer.pausedAt) {
    const startMs = parseIsoMs(task.timer.pausedAt);
    if (startMs !== null && nowMs > startMs) restMs += nowMs - startMs;
  }

  return {
    workMs,
    restMs,
    totalMs: workMs + restMs,
  };
}

function useCountdown() {
  const deadlineMs = new Date(DEADLINE_ISO).getTime();
  const startMs = new Date(START_ISO).getTime();

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
  const [content, setContent] = useState(cloneContent(DEFAULT_CONTENT));
  const countdown = useCountdown();

  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((loaded) => {
      if (isMounted) setContent(loaded);
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

  function handleTaskAction(taskId, action) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();

    setContent((previous) => {
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

      persistContent(next);
      return next;
    });
  }

  function handleTaskCheckbox(taskId, checked) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();
    const todayKey = getTodayKey(new Date(nowIso));

    setContent((previous) => {
      let historyToUse = previous.taskHistory;

      const nextTasks = previous.todaysTasks.map((task) => {
        if (task.id !== taskId) return task;

        if (checked) {
          if (task.done) return task;
          const completed = completeTask(task, nowIso, nowMs);
          historyToUse = [createHistoryEntry(completed, nowIso, todayKey), ...historyToUse].slice(0, 500);
          return completed;
        }

        if (!task.done) return task;

        historyToUse = removeLatestHistoryEntry(historyToUse, task.id);
        return {
          ...task,
          done: false,
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

      persistContent(next);
      return next;
    });
  }

  return (
    <main className="page">
      <section className="cs-wrap">
        <div className="cs-card">
          <div className="cs-top-links">
            <a className="subtle-link" href="/admin">
              Edit
            </a>
            <a className="subtle-link" href="/history">
              History
            </a>
          </div>
          <div className="cs-now-row">
            <span className="cs-now-time">{countdown.nowText}</span>
          </div>
          <div className="cs-content">
            <section className="cs-left">
              <p className="cs-kicker">Deadline</p>
              <h1 className="cs-title">{TITLE}</h1>
              <div className="cs-meta">
                <span className="cs-pill">
                  <span className="cs-dot" />
                  <span>{countdown.deadlineText}</span>
                </span>
              </div>
              <div className="cs-left-divider" />
              <div className="cs-meta-block">
                <span className="cs-meta-key">Phase</span>
                <span className="cs-meta-value">{content.phase}</span>
              </div>
              <div className="cs-small">
                <span>Timeline Elapsed</span>
                <span>{countdown.percentElapsed}</span>
              </div>
              <div className="cs-bar">
                <div className="cs-fill" style={{ width: countdown.percentElapsed }} />
              </div>
            </section>

            <section className="cs-center">
              <div className="cs-days">{countdown.daysRemaining}</div>
              <div className="cs-days-label">Days Remaining</div>
              <div
                className="cs-subtime"
                aria-label={`${countdown.hoursRemaining} hours ${countdown.minutesRemaining} minutes ${countdown.secondsRemaining} seconds`}
              >
                <div className="cs-subtime-values">
                  <span>{countdown.hoursRemaining}</span>
                  <span className="cs-subtime-sep">:</span>
                  <span>{countdown.minutesRemaining}</span>
                  <span className="cs-subtime-sep">:</span>
                  <span>{countdown.secondsRemaining}</span>
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
                <span className="cs-meta-key">Today's Task</span>
                <ul className="cs-task-list">
                  {content.todaysTasks.map((task) => {
                    const runtime = getLiveDurations(task, countdown.nowMs);
                    const hasProgress =
                      task.timer.totalWorkMs > 0 || task.timer.totalRestMs > 0 || task.timer.sessions.length > 0;
                    const timerText =
                      task.timer.status === "running"
                        ? `Work ${formatDuration(runtime.workMs)}`
                        : task.timer.status === "paused"
                          ? `Rest ${formatDuration(runtime.restMs)}`
                          : "";
                    return (
                      <li key={task.id} className={`cs-task-row${task.done ? " is-done" : ""}`}>
                      <label className={`cs-task-item${task.done ? " is-done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={task.done}
                          onChange={(event) => handleTaskCheckbox(task.id, event.target.checked)}
                        />
                        <div className="cs-task-main">
                          <span className="cs-task-text">{task.text}</span>
                          {timerText && <span className="cs-task-meta">{timerText}</span>}
                          </div>
                        </label>

                        <div className="cs-task-controls">
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
                  })}
                </ul>
              </div>
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
  const [taskHistory, setTaskHistory] = useState(cloneContent(DEFAULT_CONTENT).taskHistory);
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
      setTodaysTasksText(tasksToText(saved.todaysTasks));
      setTaskHistory(saved.taskHistory);
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
      phase: phase.trim() || DEFAULT_CONTENT.phase,
      todaysTasks: mergedTasks,
      todaysTasksDate,
      taskHistory,
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
          <a className="subtle-link" href="/">
            Back
          </a>
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
                      {historyDateFormatter.format(new Date(entry.completedAt || entry.checkedAt))} | Total {formatDuration(entry.totalElapsedMs || 0)}
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

function HistoryPage() {
  const [taskHistory, setTaskHistory] = useState([]);
  const historyDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    []
  );
  const historyWindowFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    []
  );

  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((content) => {
      if (isMounted) setTaskHistory(content.taskHistory);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="history-page">
      <div className="history-shell">
        <header className="history-header">
          <h1>Task History</h1>
          <nav className="history-nav" aria-label="History navigation">
            <a className="subtle-link" href="/">
              Dashboard
            </a>
            <a className="subtle-link" href="/admin">
              Edit
            </a>
          </nav>
        </header>

        <section className="history-card">
          {taskHistory.length === 0 ? (
            <p className="history-empty">No completed tasks yet.</p>
          ) : (
            <ul className="history-list">
              {taskHistory.map((entry) => (
                <li key={entry.id} className="history-item">
                  <span className="history-item-text">{entry.text}</span>
                  <div className="history-item-meta">
                    <span className="history-item-time">Completed {historyDateFormatter.format(new Date(entry.completedAt || entry.checkedAt))}</span>
                    <span className="history-item-time">Total {formatDuration(entry.totalElapsedMs || 0)}</span>
                    <span className="history-item-time">Work {formatDuration(entry.totalWorkMs || 0)}</span>
                    <span className="history-item-time">Rest {formatDuration(entry.totalRestMs || 0)}</span>
                  </div>
                  {Array.isArray(entry.sessions) && entry.sessions.length > 0 ? (
                    <ul className="history-session-list">
                      {entry.sessions.map((session) => (
                        <li key={session.id} className="history-session-item">
                          <span className="history-session-type">{session.type === "work" ? "Work" : "Rest"}</span>
                          <span className="history-session-time">
                            {historyWindowFormatter.format(new Date(session.start))} - {historyWindowFormatter.format(new Date(session.end))}
                          </span>
                          <span className="history-session-duration">{formatDuration(session.durationMs || 0)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export default function App() {
  if (window.location.pathname === "/admin") {
    return <AdminPage />;
  }

  if (window.location.pathname === "/history") {
    return <HistoryPage />;
  }

  return <DashboardPage />;
}
