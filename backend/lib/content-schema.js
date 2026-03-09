export const SCHEMA_VERSION = 2;

const DEFAULT_PROJECT = {
  id: "project-inbox",
  name: "Inbox",
  color: "#b66e35",
};

const PRIORITY_LEVELS = new Set(["low", "medium", "high", "urgent"]);
const RECURRENCE_TYPES = new Set(["none", "daily", "weekly", "monthly"]);
const MAX_TAGS_PER_TASK = 8;
const MAX_TASK_HISTORY_ITEMS = 500;
const MAX_POMODORO_HISTORY_ITEMS = 1000;

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function parseDateKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const ms = Date.parse(`${trimmed}T00:00:00`);
  if (Number.isNaN(ms)) return null;
  return getTodayKey(new Date(ms));
}

function normalizePriority(value) {
  return PRIORITY_LEVELS.has(value) ? value : "medium";
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const next = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    next.push(tag);
    seen.add(tag);
    if (next.length >= MAX_TAGS_PER_TASK) break;
  }
  return next;
}

function normalizeRecurrence(value) {
  if (typeof value === "string") {
    return {
      type: RECURRENCE_TYPES.has(value) ? value : "none",
      interval: 1,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      type: "none",
      interval: 1,
    };
  }

  const typeRaw =
    typeof value.type === "string"
      ? value.type
      : typeof value.frequency === "string"
        ? value.frequency
        : "none";
  const type = RECURRENCE_TYPES.has(typeRaw) ? typeRaw : "none";
  const intervalRaw = Number(value.interval ?? value.every ?? 1);
  const interval = Number.isFinite(intervalRaw) && intervalRaw >= 1 ? Math.floor(intervalRaw) : 1;

  return {
    type,
    interval,
  };
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

function createDefaultPomodoro() {
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

function createDefaultTask(overrides = {}) {
  const nowIso = new Date().toISOString();
  const id = overrides.id || newId("task");
  const recurrence = normalizeRecurrence(overrides.recurrence);
  return {
    id,
    text: typeof overrides.text === "string" ? overrides.text.trim() : "",
    done: Boolean(overrides.done),
    projectId:
      typeof overrides.projectId === "string" && overrides.projectId
        ? overrides.projectId
        : DEFAULT_PROJECT.id,
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
      typeof overrides.estimatedPomodoros === "number" &&
      Number.isFinite(overrides.estimatedPomodoros) &&
      overrides.estimatedPomodoros >= 0
        ? Math.floor(overrides.estimatedPomodoros)
        : 0,
    completedPomodoros:
      typeof overrides.completedPomodoros === "number" &&
      Number.isFinite(overrides.completedPomodoros) &&
      overrides.completedPomodoros >= 0
        ? Math.floor(overrides.completedPomodoros)
        : 0,
    inTodayQueue: Boolean(overrides.inTodayQueue),
    createdAt: parseIsoMs(overrides.createdAt) !== null ? overrides.createdAt : nowIso,
    updatedAt: parseIsoMs(overrides.updatedAt) !== null ? overrides.updatedAt : nowIso,
    timer: overrides.timer && typeof overrides.timer === "object" ? overrides.timer : createDefaultTimer(),
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

function normalizeProjects(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ ...DEFAULT_PROJECT }];
  }

  const next = [];
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
    next.push({
      id,
      name,
      color:
        typeof project.color === "string" && project.color.trim()
          ? project.color.trim()
          : DEFAULT_PROJECT.color,
    });
  }

  if (!seen.has(DEFAULT_PROJECT.id)) next.unshift({ ...DEFAULT_PROJECT });
  return next.length > 0 ? next : [{ ...DEFAULT_PROJECT }];
}

function normalizeTaskRecord(task, defaultProjectId, projectIds) {
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

  const projectId =
    typeof task.projectId === "string" && task.projectId && projectIds.has(task.projectId)
      ? task.projectId
      : defaultProjectId;

  return {
    id: typeof task.id === "string" && task.id ? task.id : newId("task"),
    text,
    done,
    projectId,
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
      typeof task.estimatedPomodoros === "number" &&
      Number.isFinite(task.estimatedPomodoros) &&
      task.estimatedPomodoros >= 0
        ? Math.floor(task.estimatedPomodoros)
        : 0,
    completedPomodoros:
      typeof task.completedPomodoros === "number" &&
      Number.isFinite(task.completedPomodoros) &&
      task.completedPomodoros >= 0
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
      .map((task) => normalizeTaskRecord(task, defaultProjectId, projectIds))
      .filter(Boolean);
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
          inTodayQueue: true,
          timer: createDefaultTimer(),
        })
      );
  }

  return createDefaultContent().todaysTasks;
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
          typeof entry.pomodorosCompleted === "number" &&
          Number.isFinite(entry.pomodorosCompleted) &&
          entry.pomodorosCompleted >= 0
            ? Math.floor(entry.pomodorosCompleted)
            : 0,
        completedAt: completedAtRaw,
        day: typeof entry.day === "string" && entry.day ? entry.day : getTodayKey(new Date(completedAtRaw)),
        totalWorkMs,
        totalRestMs,
        totalElapsedMs,
        sessions: normalizeSessions(entry.sessions),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_TASK_HISTORY_ITEMS);
}

function normalizePomodoro(value) {
  const fallback = createDefaultPomodoro();
  if (!value || typeof value !== "object") return fallback;

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
          const type =
            entry.type === "shortBreak" || entry.type === "longBreak" ? entry.type : "focus";
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

export function createDefaultContent() {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: "ARR Submission",
    startDate: "2026-02-12T00:00:00",
    deadlineDate: "2026-03-16T23:59:00",
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
}

export function normalizeContentRecord(record) {
  if (!record || typeof record !== "object") return createDefaultContent();

  const projects = normalizeProjects(record.projects);
  const defaultProjectId = projects[0]?.id || DEFAULT_PROJECT.id;

  const defaults = createDefaultContent();

  return {
    schemaVersion: SCHEMA_VERSION,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : defaults.title,
    startDate: typeof record.startDate === "string" && parseIsoMs(record.startDate) !== null ? record.startDate : defaults.startDate,
    deadlineDate: typeof record.deadlineDate === "string" && parseIsoMs(record.deadlineDate) !== null ? record.deadlineDate : defaults.deadlineDate,
    phase:
      typeof record.phase === "string" && record.phase.trim()
        ? record.phase.trim()
        : defaults.phase,
    projects,
    todaysTasks: normalizeTasks(record.todaysTasks ?? record.todaysTask, projects),
    todaysTasksDate: parseDateKey(record.todaysTasksDate) || getTodayKey(),
    taskHistory: normalizeHistory(record.taskHistory, defaultProjectId),
    pomodoro: normalizePomodoro(record.pomodoro),
  };
}

export function isContentPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (typeof payload.phase !== "string") return false;
  if (!Array.isArray(payload.todaysTasks) && typeof payload.todaysTask !== "string") return false;
  if (payload.taskHistory !== undefined && !Array.isArray(payload.taskHistory)) return false;
  if (payload.projects !== undefined && !Array.isArray(payload.projects)) return false;
  return true;
}
