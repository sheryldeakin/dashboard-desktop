export const TITLE = "ARR Submission";
export const START_ISO = "2026-02-12T00:00:00";
export const DEADLINE_ISO = "2026-03-16T23:59:00";

export const STORAGE_KEY = "arr_dashboard_content_v1";
export const API_BASE_URL = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");
export const SCHEMA_VERSION = 2;
export const DEFAULT_PROJECT = {
  id: "project-inbox",
  name: "Inbox",
  color: "#b66e35",
};
export const PRIORITY_LEVELS = ["low", "medium", "high", "urgent"];
export const PRIORITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};
export const RECURRENCE_TYPES = ["none", "daily", "weekly", "monthly"];
export const TODO_SIDEBAR_SECTIONS = [
  { id: "today", label: "Today", description: "Items currently in today queue." },
  { id: "inbox", label: "Inbox", description: "Non-queue tasks in Inbox." },
  { id: "planned", label: "Planned", description: "Non-queue tasks due in future." },
  { id: "recurring", label: "Recurring", description: "Non-queue repeating tasks." },
  { id: "overdue", label: "Overdue", description: "Non-queue tasks past due." },
  { id: "done", label: "Done", description: "Completed tasks." },
  { id: "all", label: "All", description: "Everything in your queue." },
];
export const MAX_TAGS_PER_TASK = 8;
export const MAX_TASK_HISTORY_ITEMS = 500;
export const MAX_POMODORO_HISTORY_ITEMS = 1000;
export const dayMs = 1000 * 60 * 60 * 24;
export const hourMs = 1000 * 60 * 60;
export const minuteMs = 1000 * 60;
export const secondMs = 1000;

export function parseIsoMs(value) {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const ms = Date.parse(`${trimmed}T00:00:00`);
  if (Number.isNaN(ms)) return null;
  return getTodayKey(new Date(ms));
}

export function addDaysToDateKey(dateKey, days) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const date = new Date(`${parsed}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getTodayKey(date);
}

export function addMonthsToDateKey(dateKey, months) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const date = new Date(`${parsed}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return getTodayKey(date);
}

export function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultTimer() {
  return {
    status: "idle",
    runningStartedAt: null,
    pausedAt: null,
    totalWorkMs: 0,
    totalRestMs: 0,
    sessions: [],
  };
}

export function createDefaultPomodoro() {
  return {
    settings: {
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      cyclesBeforeLongBreak: 4,
      autoStartBreak: false,
      autoStartFocus: false,
    },
    history: [],
  };
}

export function normalizePriority(value) {
  return PRIORITY_LEVELS.includes(value) ? value : "medium";
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const next = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
    if (next.length >= MAX_TAGS_PER_TASK) break;
  }
  return next;
}

export function parseTagInput(value) {
  if (typeof value !== "string") return [];
  return normalizeTags(value.split(","));
}

export function normalizeRecurrence(value) {
  if (typeof value === "string") {
    return {
      type: RECURRENCE_TYPES.includes(value) ? value : "none",
      interval: 1,
    };
  }

  if (!value || typeof value !== "object") {
    return { type: "none", interval: 1 };
  }

  const typeRaw = typeof value.type === "string" ? value.type : typeof value.frequency === "string" ? value.frequency : "none";
  const type = RECURRENCE_TYPES.includes(typeRaw) ? typeRaw : "none";
  const intervalRaw = Number(value.interval ?? value.every ?? 1);
  const interval = Number.isFinite(intervalRaw) && intervalRaw >= 1 ? Math.floor(intervalRaw) : 1;

  return { type, interval };
}

export function getNextRecurringDate(task, referenceDateKey = getTodayKey()) {
  if (!task.recurrence || task.recurrence.type === "none") return null;
  const seedDate = parseDateKey(task.dueDate) || parseDateKey(referenceDateKey) || getTodayKey();
  const interval = task.recurrence.interval || 1;

  if (task.recurrence.type === "daily") return addDaysToDateKey(seedDate, interval);
  if (task.recurrence.type === "weekly") return addDaysToDateKey(seedDate, 7 * interval);
  if (task.recurrence.type === "monthly") return addMonthsToDateKey(seedDate, interval);
  return null;
}

export function createDefaultTask(overrides = {}) {
  const nowIso = new Date().toISOString();
  const id = overrides.id || newId("task");
  const recurrence = normalizeRecurrence(overrides.recurrence);
  return {
    id,
    text: typeof overrides.text === "string" && overrides.text.trim() ? overrides.text.trim() : "",
    done: Boolean(overrides.done),
    projectId: typeof overrides.projectId === "string" && overrides.projectId ? overrides.projectId : DEFAULT_PROJECT.id,
    tags: normalizeTags(overrides.tags),
    priority: normalizePriority(overrides.priority),
    dueDate: parseDateKey(overrides.dueDate),
    recurrence,
    recurrenceSeedId:
      typeof overrides.recurrenceSeedId === "string" && overrides.recurrenceSeedId
        ? overrides.recurrenceSeedId
        : recurrence.type !== "none"
          ? id
          : "",
    notes: typeof overrides.notes === "string" ? overrides.notes.trim() : "",
    estimatedPomodoros:
      typeof overrides.estimatedPomodoros === "number" && Number.isFinite(overrides.estimatedPomodoros) && overrides.estimatedPomodoros >= 0
        ? Math.floor(overrides.estimatedPomodoros)
        : 0,
    completedPomodoros:
      typeof overrides.completedPomodoros === "number" && Number.isFinite(overrides.completedPomodoros) && overrides.completedPomodoros >= 0
        ? Math.floor(overrides.completedPomodoros)
        : 0,
    inTodayQueue: Boolean(overrides.inTodayQueue),
    createdAt: parseIsoMs(overrides.createdAt) !== null ? overrides.createdAt : nowIso,
    updatedAt: parseIsoMs(overrides.updatedAt) !== null ? overrides.updatedAt : nowIso,
    timer: overrides.timer && typeof overrides.timer === "object" ? overrides.timer : createDefaultTimer(),
  };
}

export function normalizeSessions(value) {
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

export function normalizeTimer(value, done) {
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

export function normalizeProjects(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ ...DEFAULT_PROJECT }];
  }

  const result = [];
  const seen = new Set();

  for (const project of value) {
    if (!project || typeof project !== "object") continue;
    const name = typeof project.name === "string" ? project.name.trim() : "";
    if (!name) continue;
    const id =
      typeof project.id === "string" && project.id.trim()
        ? project.id.trim()
        : `project-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 5)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      name,
      color: typeof project.color === "string" && project.color.trim() ? project.color.trim() : DEFAULT_PROJECT.color,
    });
  }

  if (!seen.has(DEFAULT_PROJECT.id)) {
    result.unshift({ ...DEFAULT_PROJECT });
  }

  return result.length > 0 ? result : [{ ...DEFAULT_PROJECT }];
}

export function normalizeTaskRecord(task, defaultProjectId) {
  if (!task || typeof task !== "object" || typeof task.text !== "string") return null;
  const text = task.text.trim();
  if (!text) return null;

  const doneFromData = Boolean(task.done);
  const timer = normalizeTimer(task.timer, doneFromData);
  const done = doneFromData || timer.status === "completed";
  const nowIso = new Date().toISOString();
  const recurrence = normalizeRecurrence(task.recurrence);
  const dueDate = parseDateKey(task.dueDate);
  const hasQueueFlag = Object.prototype.hasOwnProperty.call(task, "inTodayQueue");
  const inferredQueueMembership = Boolean(!done && dueDate && dueDate <= getTodayKey());

  return {
    id: typeof task.id === "string" && task.id ? task.id : newId("task"),
    text,
    done,
    projectId: typeof task.projectId === "string" && task.projectId ? task.projectId : defaultProjectId,
    tags: normalizeTags(task.tags),
    priority: normalizePriority(task.priority),
    dueDate,
    recurrence,
    recurrenceSeedId:
      typeof task.recurrenceSeedId === "string" && task.recurrenceSeedId
        ? task.recurrenceSeedId
        : recurrence.type !== "none" && typeof task.id === "string"
          ? task.id
          : "",
    notes: typeof task.notes === "string" ? task.notes.trim() : "",
    estimatedPomodoros:
      typeof task.estimatedPomodoros === "number" && Number.isFinite(task.estimatedPomodoros) && task.estimatedPomodoros >= 0
        ? Math.floor(task.estimatedPomodoros)
        : 0,
    completedPomodoros:
      typeof task.completedPomodoros === "number" && Number.isFinite(task.completedPomodoros) && task.completedPomodoros >= 0
        ? Math.floor(task.completedPomodoros)
        : 0,
    inTodayQueue: hasQueueFlag ? Boolean(task.inTodayQueue) : inferredQueueMembership,
    createdAt: parseIsoMs(task.createdAt) !== null ? task.createdAt : nowIso,
    updatedAt: parseIsoMs(task.updatedAt) !== null ? task.updatedAt : nowIso,
    timer: normalizeTimer(task.timer, done),
  };
}

function normalizeTasks(value, projects) {
  const defaultProjectId = projects[0]?.id || DEFAULT_PROJECT.id;
  const projectIds = new Set(projects.map((project) => project.id));

  if (Array.isArray(value)) {
    return value
      .map((task) => normalizeTaskRecord(task, defaultProjectId))
      .filter(Boolean)
      .map((task) =>
        projectIds.has(task.projectId)
          ? task
          : {
              ...task,
              projectId: defaultProjectId,
            }
      );
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) =>
        createDefaultTask({
          id: newId("task"),
          text,
          projectId: defaultProjectId,
          done: false,
          inTodayQueue: true,
          timer: createDefaultTimer(),
        })
      );
  }

  return cloneContent(DEFAULT_CONTENT).todaysTasks;
}

function normalizeHistory(value, defaultProjectId) {
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
        projectId: typeof entry.projectId === "string" && entry.projectId ? entry.projectId : defaultProjectId,
        tags: normalizeTags(entry.tags),
        priority: normalizePriority(entry.priority),
        dueDate: parseDateKey(entry.dueDate),
        recurrence: normalizeRecurrence(entry.recurrence),
        pomodorosCompleted:
          typeof entry.pomodorosCompleted === "number" && Number.isFinite(entry.pomodorosCompleted) && entry.pomodorosCompleted >= 0
            ? Math.floor(entry.pomodorosCompleted)
            : 0,
        completedAt: completedAtRaw,
        day: typeof entry.day === "string" && entry.day ? entry.day : getTodayKey(new Date(completedAtRaw)),
        totalWorkMs,
        totalRestMs,
        totalElapsedMs,
        sessions,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_TASK_HISTORY_ITEMS);
}

export function normalizePomodoro(value) {
  const fallback = createDefaultPomodoro();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const settingsRaw = value.settings && typeof value.settings === "object" ? value.settings : {};

  const settings = {
    focusMinutes:
      typeof settingsRaw.focusMinutes === "number" && Number.isFinite(settingsRaw.focusMinutes) && settingsRaw.focusMinutes >= 5
        ? Math.min(180, Math.floor(settingsRaw.focusMinutes))
        : fallback.settings.focusMinutes,
    shortBreakMinutes:
      typeof settingsRaw.shortBreakMinutes === "number" &&
      Number.isFinite(settingsRaw.shortBreakMinutes) &&
      settingsRaw.shortBreakMinutes >= 1
        ? Math.min(60, Math.floor(settingsRaw.shortBreakMinutes))
        : fallback.settings.shortBreakMinutes,
    longBreakMinutes:
      typeof settingsRaw.longBreakMinutes === "number" &&
      Number.isFinite(settingsRaw.longBreakMinutes) &&
      settingsRaw.longBreakMinutes >= 1
        ? Math.min(90, Math.floor(settingsRaw.longBreakMinutes))
        : fallback.settings.longBreakMinutes,
    cyclesBeforeLongBreak:
      typeof settingsRaw.cyclesBeforeLongBreak === "number" &&
      Number.isFinite(settingsRaw.cyclesBeforeLongBreak) &&
      settingsRaw.cyclesBeforeLongBreak >= 1
        ? Math.min(12, Math.floor(settingsRaw.cyclesBeforeLongBreak))
        : fallback.settings.cyclesBeforeLongBreak,
    autoStartBreak: Boolean(settingsRaw.autoStartBreak),
    autoStartFocus: Boolean(settingsRaw.autoStartFocus),
  };

  const history = Array.isArray(value.history)
    ? value.history
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const startedAtMs = parseIsoMs(entry.startedAt);
          const endedAtMs = parseIsoMs(entry.endedAt);
          if (startedAtMs === null || endedAtMs === null || endedAtMs <= startedAtMs) return null;
          const type = entry.type === "shortBreak" || entry.type === "longBreak" ? entry.type : "focus";
          const durationMs =
            typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs) && entry.durationMs > 0
              ? entry.durationMs
              : endedAtMs - startedAtMs;
          return {
            id: typeof entry.id === "string" && entry.id ? entry.id : newId("pom"),
            taskId: typeof entry.taskId === "string" ? entry.taskId : "",
            type,
            startedAt: new Date(startedAtMs).toISOString(),
            endedAt: new Date(endedAtMs).toISOString(),
            durationMs,
          };
        })
        .filter(Boolean)
        .slice(0, MAX_POMODORO_HISTORY_ITEMS)
    : [];

  return {
    settings,
    history,
  };
}

export const DEFAULT_CONTENT = {
  schemaVersion: SCHEMA_VERSION,
  title: TITLE,
  startDate: START_ISO,
  deadlineDate: DEADLINE_ISO,
  phase: "Phase 2 - Revision",
  projects: [{ ...DEFAULT_PROJECT }],
  todaysTasks: [
    createDefaultTask({
      id: "task-default-1",
      text: "Finalize abstract edits and update citations.",
      projectId: DEFAULT_PROJECT.id,
      done: false,
      inTodayQueue: true,
      timer: createDefaultTimer(),
    }),
  ],
  todaysTasksDate: getTodayKey(),
  taskHistory: [],
  pomodoro: createDefaultPomodoro(),
};

export function cloneTask(task) {
  return {
    ...task,
    tags: Array.isArray(task.tags) ? [...task.tags] : [],
    recurrence: normalizeRecurrence(task.recurrence),
    timer: {
      ...task.timer,
      sessions: task.timer.sessions.map((session) => ({ ...session })),
    },
  };
}

export function cloneContent(content) {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: content.title || TITLE,
    startDate: content.startDate || START_ISO,
    deadlineDate: content.deadlineDate || DEADLINE_ISO,
    phase: content.phase,
    projects: Array.isArray(content.projects) ? content.projects.map((project) => ({ ...project })) : [{ ...DEFAULT_PROJECT }],
    todaysTasks: content.todaysTasks.map(cloneTask),
    todaysTasksDate: content.todaysTasksDate,
    taskHistory: content.taskHistory.map((entry) => ({
      ...entry,
      tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
      recurrence: normalizeRecurrence(entry.recurrence),
      sessions: Array.isArray(entry.sessions) ? entry.sessions.map((session) => ({ ...session })) : [],
    })),
    pomodoro: {
      settings: {
        ...content.pomodoro.settings,
      },
      history: Array.isArray(content.pomodoro.history)
        ? content.pomodoro.history.map((entry) => ({
            ...entry,
          }))
        : [],
    },
  };
}

export function normalizeContentRecord(record) {
  if (!record || typeof record !== "object") {
    return cloneContent(DEFAULT_CONTENT);
  }

  const projects = normalizeProjects(record.projects);
  const defaultProjectId = projects[0]?.id || DEFAULT_PROJECT.id;
  const tasks = normalizeTasks(record.todaysTasks ?? record.todaysTask, projects);

  return {
    schemaVersion: SCHEMA_VERSION,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : TITLE,
    startDate: typeof record.startDate === "string" && parseIsoMs(record.startDate) !== null ? record.startDate : START_ISO,
    deadlineDate: typeof record.deadlineDate === "string" && parseIsoMs(record.deadlineDate) !== null ? record.deadlineDate : DEADLINE_ISO,
    phase: typeof record.phase === "string" && record.phase.trim() ? record.phase.trim() : DEFAULT_CONTENT.phase,
    projects,
    todaysTasks: tasks,
    todaysTasksDate: parseDateKey(record.todaysTasksDate) || getTodayKey(),
    taskHistory: normalizeHistory(record.taskHistory, defaultProjectId),
    pomodoro: normalizePomodoro(record.pomodoro),
  };
}

export function tasksToText(tasks) {
  return tasks.map((task) => task.text).join("\n");
}

export function mergeTasksFromText(text, previousTasks) {
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
        updatedAt: new Date().toISOString(),
      };
    }

    return createDefaultTask({
      id: newId("task"),
      text: line,
      done: false,
      projectId: DEFAULT_PROJECT.id,
      inTodayQueue: true,
      timer: createDefaultTimer(),
    });
  });
}

export function getProjectName(projects, projectId) {
  const project = projects.find((item) => item.id === projectId);
  return project ? project.name : "Inbox";
}

export function formatPriority(priority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function formatRecurrence(recurrence) {
  if (!recurrence || recurrence.type === "none") return "No repeat";
  if (recurrence.interval <= 1) {
    if (recurrence.type === "daily") return "Daily";
    if (recurrence.type === "weekly") return "Weekly";
    if (recurrence.type === "monthly") return "Monthly";
    return "No repeat";
  }
  return `Every ${recurrence.interval} ${recurrence.type}`;
}

export function isTaskOverdue(task, todayKey = getTodayKey()) {
  return Boolean(!task.done && task.dueDate && task.dueDate < todayKey);
}

export function taskMatchesSidebarSection(task, sectionId, todayKey, defaultProjectId) {
  if (sectionId === "all") return true;
  if (sectionId === "done") return task.done;
  if (task.done) return false;

  if (sectionId === "today") {
    return Boolean(task.inTodayQueue);
  }
  if (task.inTodayQueue) return false;
  if (sectionId === "inbox") {
    return task.projectId === defaultProjectId;
  }
  if (sectionId === "planned") {
    return Boolean(task.dueDate && task.dueDate > todayKey);
  }
  if (sectionId === "recurring") {
    return task.recurrence?.type && task.recurrence.type !== "none";
  }
  if (sectionId === "overdue") {
    return Boolean(task.dueDate && task.dueDate < todayKey);
  }

  return true;
}

export function createRecurringTaskFromCompleted(task, referenceDate = getTodayKey()) {
  if (!task.done || !task.recurrence || task.recurrence.type === "none") return null;
  const nextDueDate = getNextRecurringDate(task, referenceDate);
  if (!nextDueDate) return null;
  const nowIso = new Date().toISOString();
  return createDefaultTask({
    text: task.text,
    projectId: task.projectId,
    tags: task.tags,
    priority: task.priority,
    dueDate: nextDueDate,
    recurrence: task.recurrence,
    recurrenceSeedId: task.recurrenceSeedId || task.id,
    notes: task.notes,
    estimatedPomodoros: task.estimatedPomodoros,
    completedPomodoros: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    timer: createDefaultTimer(),
  });
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

export function persistContent(nextContent) {
  saveContent(nextContent);

  if (!API_BASE_URL) return;

  saveRemoteContent(nextContent).catch((error) => {
    console.error("Failed to sync content to API:", error);
  });
}

export function appendWorkSession(timer, nowIso, nowMs) {
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

export function appendRestSession(timer, nowIso, nowMs) {
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

export function startTask(task, nowIso) {
  if (task.done || task.timer.status === "running") return task;

  if (task.timer.status === "paused") {
    return resumeTask(task, nowIso, parseIsoMs(nowIso) ?? Date.now());
  }

  return {
    ...task,
    updatedAt: nowIso,
    timer: {
      ...task.timer,
      status: "running",
      runningStartedAt: nowIso,
      pausedAt: null,
    },
  };
}

export function pauseTask(task, nowIso, nowMs) {
  if (task.done || task.timer.status !== "running") return task;

  const worked = appendWorkSession(task.timer, nowIso, nowMs);
  return {
    ...task,
    updatedAt: nowIso,
    timer: {
      ...worked,
      status: "paused",
      pausedAt: nowIso,
    },
  };
}

export function resumeTask(task, nowIso, nowMs) {
  if (task.done || task.timer.status !== "paused") return task;

  const rested = appendRestSession(task.timer, nowIso, nowMs);
  return {
    ...task,
    updatedAt: nowIso,
    timer: {
      ...rested,
      status: "running",
      runningStartedAt: nowIso,
      pausedAt: null,
    },
  };
}

export function stopTask(task, nowIso, nowMs) {
  if (task.done) return task;

  let timer = { ...task.timer };
  if (timer.status === "running") {
    timer = appendWorkSession(timer, nowIso, nowMs);
  } else if (timer.status === "paused") {
    timer = appendRestSession(timer, nowIso, nowMs);
  }

  return {
    ...task,
    updatedAt: nowIso,
    timer: {
      ...timer,
      status: "stopped",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

export function completeTask(task, nowIso, nowMs) {
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
    inTodayQueue: false,
    updatedAt: nowIso,
    timer: {
      ...timer,
      status: "completed",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

export function freezeTaskForRollover(task, nowIso, nowMs) {
  if (task.done) return task;

  let timer = { ...task.timer };
  if (timer.status === "running") {
    timer = appendWorkSession(timer, nowIso, nowMs);
  } else if (timer.status === "paused") {
    timer = appendRestSession(timer, nowIso, nowMs);
  }

  return {
    ...task,
    updatedAt: nowIso,
    timer: {
      ...timer,
      status: "idle",
      runningStartedAt: null,
      pausedAt: null,
    },
  };
}

export function createHistoryEntry(task, nowIso, day) {
  const totalWorkMs = task.timer.totalWorkMs;
  const totalRestMs = task.timer.totalRestMs;
  return {
    id: newId("hist"),
    sourceTaskId: task.id,
    text: task.text,
    projectId: task.projectId,
    tags: [...task.tags],
    priority: task.priority,
    dueDate: task.dueDate,
    recurrence: { ...task.recurrence },
    pomodorosCompleted: task.completedPomodoros || 0,
    completedAt: nowIso,
    day,
    totalWorkMs,
    totalRestMs,
    totalElapsedMs: totalWorkMs + totalRestMs,
    sessions: task.timer.sessions.map((session) => ({ ...session })),
  };
}

export function removeLatestHistoryEntry(history, taskId) {
  const index = history.findIndex((entry) => entry.sourceTaskId === taskId);
  if (index < 0) return history;
  return history.filter((_, i) => i !== index);
}

export function applyDailyRollover(content) {
  const todayKey = getTodayKey();
  if (content.todaysTasksDate === todayKey) {
    return { content, changed: false };
  }

  const nowIso = new Date().toISOString();
  const nowMs = parseIsoMs(nowIso) ?? Date.now();
  const frozenOpenTasks = content.todaysTasks
    .filter((task) => !task.done)
    .map((task) => freezeTaskForRollover(task, nowIso, nowMs));
  const openRecurringKeys = new Set(
    frozenOpenTasks.map((task) => `${task.recurrenceSeedId || task.id}::${task.dueDate || ""}`)
  );

  const recurringTasks = content.todaysTasks
    .map((task) => createRecurringTaskFromCompleted(task, content.todaysTasksDate))
    .filter(Boolean)
    .filter((task) => {
      const key = `${task.recurrenceSeedId || task.id}::${task.dueDate || ""}`;
      if (openRecurringKeys.has(key)) return false;
      openRecurringKeys.add(key);
      return true;
    });

  return {
    content: {
      ...content,
      todaysTasks: [...frozenOpenTasks, ...recurringTasks],
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

export async function loadAndHydratePreferredContent() {
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

export function formatDeadlineLocal(deadlineMs) {
  return new Date(deadlineMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function getLiveDurations(task, nowMs) {
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

export function getTaskProjectName(task, projects) {
  return getProjectName(projects, task.projectId);
}

export function getTaskSearchIndex(task, projects) {
  const project = getTaskProjectName(task, projects);
  return [
    task.text,
    task.notes,
    project,
    task.priority,
    task.dueDate || "",
    task.tags.join(" "),
    task.recurrence.type,
  ]
    .join(" ")
    .toLowerCase();
}

export function compareTasksBySort(a, b, sortBy) {
  if (sortBy === "manual") {
    return 0;
  }

  if (sortBy === "priority") {
    const diff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
    if (diff !== 0) return diff;
  }

  if (sortBy === "dueDate") {
    const aDue = a.dueDate || "9999-99-99";
    const bDue = b.dueDate || "9999-99-99";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
  }

  if (sortBy === "updatedAt") {
    const aMs = parseIsoMs(a.updatedAt) || 0;
    const bMs = parseIsoMs(b.updatedAt) || 0;
    if (aMs !== bMs) return bMs - aMs;
  }

  if (sortBy === "alphabetical") {
    return a.text.localeCompare(b.text, undefined, { sensitivity: "base" });
  }

  const aCreated = parseIsoMs(a.createdAt) || 0;
  const bCreated = parseIsoMs(b.createdAt) || 0;
  return bCreated - aCreated;
}

export function createPomodoroSessionEntry({ taskId, type, startedAt, endedAt, durationMs }) {
  return {
    id: newId("pom"),
    taskId: taskId || "",
    type,
    startedAt,
    endedAt,
    durationMs,
  };
}

export function appendSessionToTaskTimer(task, sessionType, startedAt, endedAt, durationMs) {
  const nextTimer = {
    ...task.timer,
    status: "stopped",
    runningStartedAt: null,
    pausedAt: null,
    sessions: [
      ...task.timer.sessions,
      {
        id: newId("sess"),
        type: sessionType,
        start: startedAt,
        end: endedAt,
        durationMs,
      },
    ],
  };

  if (sessionType === "work") {
    nextTimer.totalWorkMs += durationMs;
  } else {
    nextTimer.totalRestMs += durationMs;
  }

  return {
    ...task,
    updatedAt: endedAt,
    timer: nextTimer,
  };
}

export function getPomodoroModeSeconds(mode, settings) {
  if (mode === "shortBreak") return Math.max(60, settings.shortBreakMinutes * 60);
  if (mode === "longBreak") return Math.max(60, settings.longBreakMinutes * 60);
  return Math.max(300, settings.focusMinutes * 60);
}

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
