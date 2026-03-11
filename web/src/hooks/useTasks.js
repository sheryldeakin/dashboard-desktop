import { useEffect, useMemo, useRef, useState } from "react";
import {
  SCHEMA_VERSION,
  DEFAULT_PROJECT,
  TODO_SIDEBAR_SECTIONS,
  MAX_TASK_HISTORY_ITEMS,
  parseIsoMs,
  getTodayKey,
  addDaysToDateKey,
  newId,
  createDefaultTimer,
  createDefaultTask,
  parseTagInput,
  normalizeTaskRecord,
  normalizeContentRecord,
  DEFAULT_CONTENT,
  cloneContent,
  getProjectName,
  formatPriority,
  formatRecurrence,
  isTaskOverdue,
  taskMatchesSidebarSection,
  createRecurringTaskFromCompleted,
  persistContent,
  completeTask,
  createHistoryEntry,
  removeLatestHistoryEntry,
  loadAndHydratePreferredContent,
  getTaskSearchIndex,
  compareTasksBySort,
} from "../utils/taskUtils.js";

export function useTasks(setStatus) {
  const fallback = cloneContent(DEFAULT_CONTENT);
  const [phase, setPhase] = useState(fallback.phase);
  const [projects, setProjects] = useState(fallback.projects);
  const [tasks, setTasks] = useState(fallback.todaysTasks);
  const [taskHistory, setTaskHistory] = useState(fallback.taskHistory);
  const [pomodoro, setPomodoro] = useState(fallback.pomodoro);
  const [todaysTasksDate, setTodaysTasksDate] = useState(getTodayKey());
  const [selectedTaskId, setSelectedTaskId] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("today");
  const [filterProjectId, setFilterProjectId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [sortBy, setSortBy] = useState("manual");
  const [dragTaskId, setDragTaskId] = useState("");
  const [dragOverTaskId, setDragOverTaskId] = useState("");
  const [dragOverSectionId, setDragOverSectionId] = useState("");
  const [dragOverProjectId, setDragOverProjectId] = useState("");

  const defaultProjectId = projects[0]?.id || DEFAULT_PROJECT.id;

  const isHydrated = useRef(false);
  const saveTimerRef = useRef(null);

  // Load content on mount
  useEffect(() => {
    let isMounted = true;

    loadAndHydratePreferredContent().then((saved) => {
      if (!isMounted) return;
      setPhase(saved.phase);
      setProjects(saved.projects);
      setTasks(saved.todaysTasks);
      setTaskHistory(saved.taskHistory);
      setPomodoro(saved.pomodoro);
      setTodaysTasksDate(saved.todaysTasksDate);
      setSelectedTaskId(saved.todaysTasks[0]?.id || "");
      // Mark hydration complete after React batches these state updates
      setTimeout(() => { isHydrated.current = true; }, 0);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-save: debounced persist on any meaningful state change
  useEffect(() => {
    if (!isHydrated.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistContent(normalizeContentRecord({
        schemaVersion: SCHEMA_VERSION,
        phase,
        projects,
        todaysTasks: tasks,
        todaysTasksDate,
        taskHistory,
        pomodoro,
      }));
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [tasks, taskHistory, phase, projects, pomodoro, todaysTasksDate]);

  // Sync selected task
  useEffect(() => {
    if (!selectedTaskId) {
      if (tasks.length > 0) setSelectedTaskId(tasks[0].id);
      return;
    }
    if (!tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0]?.id || "");
    }
  }, [tasks, selectedTaskId]);

  function taskMatchesCurrentFilters(task, query, todayKey) {
    if (!taskMatchesSidebarSection(task, activeSectionId, todayKey, defaultProjectId)) return false;
    if (filterProjectId !== "all" && task.projectId !== filterProjectId) return false;
    if (filterPriority !== "all" && task.priority !== filterPriority) return false;
    if (filterStatus === "active" && task.done) return false;
    if (filterStatus === "done" && !task.done) return false;
    if (filterStatus === "overdue" && !isTaskOverdue(task, todayKey)) return false;
    if (!query) return true;
    return getTaskSearchIndex(task, projects).includes(query);
  }

  const visibleTasks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const todayKey = getTodayKey();
    const filtered = tasks.filter((task) => taskMatchesCurrentFilters(task, query, todayKey));

    if (sortBy === "manual") return filtered;
    return [...filtered].sort((a, b) => compareTasksBySort(a, b, sortBy));
  }, [tasks, projects, searchTerm, activeSectionId, filterProjectId, filterPriority, filterStatus, sortBy, defaultProjectId]);

  const sectionCounts = useMemo(() => {
    const todayKey = getTodayKey();
    const counts = {};
    for (const section of TODO_SIDEBAR_SECTIONS) {
      counts[section.id] = tasks.filter((task) => taskMatchesSidebarSection(task, section.id, todayKey, defaultProjectId)).length;
    }
    return counts;
  }, [tasks, defaultProjectId]);

  // Sync selected task with visible tasks
  useEffect(() => {
    if (visibleTasks.length === 0) return;
    if (!visibleTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(visibleTasks[0].id);
    }
  }, [visibleTasks, selectedTaskId]);

  function normalizeAndPersist(next) {
    const normalized = normalizeContentRecord(next);
    persistContent(normalized);
    // Cancel pending auto-save — we just persisted
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setPhase(normalized.phase);
    setProjects(normalized.projects);
    setTasks(normalized.todaysTasks);
    setTaskHistory(normalized.taskHistory);
    setPomodoro(normalized.pomodoro);
    setTodaysTasksDate(normalized.todaysTasksDate);
    return normalized;
  }

  function handleSave(event) {
    event.preventDefault();
    normalizeAndPersist({
      schemaVersion: SCHEMA_VERSION,
      phase,
      projects,
      todaysTasks: tasks,
      todaysTasksDate,
      taskHistory,
      pomodoro,
    });
    setStatus("Saved and synced to dashboard.");
  }

  function handleAddProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const id = `project-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 5)}`;
    const palette = ["#b66e35", "#5b8a5a", "#477f99", "#a0678c", "#a27d3e"];
    const color = palette[projects.length % palette.length];
    const nextProjects = [...projects, { id, name, color }];
    normalizeAndPersist({
      schemaVersion: SCHEMA_VERSION,
      phase,
      projects: nextProjects,
      todaysTasks: tasks,
      todaysTasksDate,
      taskHistory,
      pomodoro,
    });
    setNewProjectName("");
    setStatus("");
  }

  // Project management state
  const [newProjectName, setNewProjectName] = useState("");

  function handleRemoveProject(projectId) {
    if (projectId === defaultProjectId) return;
    const nextProjects = projects.filter((project) => project.id !== projectId);
    const nextTasks = tasks.map((task) =>
      task.projectId === projectId
        ? {
            ...task,
            projectId: defaultProjectId,
            updatedAt: new Date().toISOString(),
          }
        : task
    );
    normalizeAndPersist({
      schemaVersion: SCHEMA_VERSION,
      phase,
      projects: nextProjects,
      todaysTasks: nextTasks,
      todaysTasksDate,
      taskHistory,
      pomodoro,
    });
    setStatus("");
  }

  function handleAddTask(text, options = {}) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) return;
    const task = createDefaultTask({
      text: trimmed,
      done: false,
      inTodayQueue: options.inTodayQueue ?? (activeSectionId === "today"),
      projectId: options.projectId || defaultProjectId,
      priority: options.priority || "medium",
      dueDate: options.dueDate || null,
      recurrence: {
        type: options.recurrenceType || "none",
        interval: Math.max(1, Number(options.recurrenceInterval) || 1),
      },
      tags: parseTagInput(options.tags || ""),
      estimatedPomodoros: Math.max(0, Number(options.estimatedPomodoros) || 0),
      timer: createDefaultTimer(),
    });
    setTasks((previous) => [task, ...previous]);
    setSelectedTaskId(task.id);
    setStatus("");
    return task;
  }

  function handleTaskField(taskId, updater) {
    setTasks((previous) =>
      previous.map((task) => {
        if (task.id !== taskId) return task;
        const nextValue = updater(task);
        const normalized = normalizeTaskRecord(
          {
            ...nextValue,
            updatedAt: new Date().toISOString(),
          },
          defaultProjectId
        );
        return normalized || task;
      })
    );
    setStatus("");
  }

  function handleTaskDone(taskId, checked) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();
    const todayKey = getTodayKey(new Date(nowIso));

    setTasks((previous) => {
      let completedTask = null;
      let recurringTask = null;
      const nextTasks = previous.map((task) => {
        if (task.id !== taskId) return task;

        if (checked) {
          if (task.done) return task;
          completedTask = {
            ...completeTask(task, nowIso, nowMs),
            inTodayQueue: false,
          };
          recurringTask = createRecurringTaskFromCompleted(completedTask, completedTask.dueDate || todayKey);
          return completedTask;
        }

        if (!task.done) return task;
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

      if (checked && completedTask) {
        setTaskHistory((previousHistory) =>
          [createHistoryEntry(completedTask, nowIso, todayKey), ...previousHistory].slice(0, MAX_TASK_HISTORY_ITEMS)
        );
      } else if (!checked) {
        setTaskHistory((previousHistory) => removeLatestHistoryEntry(previousHistory, taskId));
      }

      if (!recurringTask) return nextTasks;
      const recurringKey = `${recurringTask.recurrenceSeedId || recurringTask.id}::${recurringTask.dueDate || ""}`;
      const exists = nextTasks.some(
        (task) => `${task.recurrenceSeedId || task.id}::${task.dueDate || ""}` === recurringKey && !task.done
      );
      return exists ? nextTasks : [...nextTasks, recurringTask];
    });

    setStatus("");
  }

  function handleDuplicateTask(taskId) {
    let duplicatedTaskId = "";
    setTasks((previous) => {
      const index = previous.findIndex((task) => task.id === taskId);
      if (index < 0) return previous;
      const source = previous[index];
      const duplicate = createDefaultTask({
        ...source,
        id: newId("task"),
        done: false,
        timer: createDefaultTimer(),
        completedPomodoros: 0,
        recurrenceSeedId: source.recurrence.type === "none" ? "" : newId("rec"),
      });
      duplicatedTaskId = duplicate.id;
      return [...previous.slice(0, index + 1), duplicate, ...previous.slice(index + 1)];
    });
    if (duplicatedTaskId) setSelectedTaskId(duplicatedTaskId);
    setStatus("");
  }

  function handleRemoveTask(taskId) {
    setTasks((previous) => previous.filter((task) => task.id !== taskId));
    setStatus("");
    return taskId;
  }

  function handleMarkVisibleDone() {
    const ids = new Set(visibleTasks.filter((task) => !task.done).map((task) => task.id));
    if (ids.size === 0) return;
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();
    const day = getTodayKey(new Date(nowIso));
    const completedEntries = [];

    setTasks((previous) =>
      previous.map((task) => {
        if (!ids.has(task.id)) return task;
        const completed = completeTask(task, nowIso, nowMs);
        completedEntries.push(createHistoryEntry(completed, nowIso, day));
        return completed;
      })
    );
    setTaskHistory((previous) => [...completedEntries, ...previous].slice(0, MAX_TASK_HISTORY_ITEMS));
    setStatus("");
  }

  function handleClearCompleted() {
    setTasks((previous) => previous.filter((task) => !task.done));
    setStatus("");
  }

  function handleSelectSidebarSection(sectionId) {
    setActiveSectionId(sectionId);
    setFilterProjectId("all");
    setFilterPriority("all");
    setSearchTerm("");
    if (sectionId === "done") {
      setFilterStatus("done");
    } else if (sectionId === "overdue") {
      setFilterStatus("overdue");
    } else {
      setFilterStatus("all");
    }
  }

  function handleSelectProjectFilter(projectId) {
    setActiveSectionId("all");
    setFilterProjectId(projectId);
    setFilterStatus("all");
  }

  function handleResetFilters() {
    setActiveSectionId("today");
    setSearchTerm("");
    setFilterProjectId("all");
    setFilterStatus("all");
    setFilterPriority("all");
    setSortBy("manual");
  }

  // Drag handlers
  function handleTaskDragStart(event, taskId) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDragTaskId(taskId);
    setDragOverTaskId(taskId);
    setDragOverSectionId("");
    setDragOverProjectId("");
  }

  function readDraggedTaskId(event) {
    return dragTaskId || event.dataTransfer.getData("text/plain");
  }

  function handleTaskDragOver(event, taskId) {
    if (sortBy !== "manual" || !dragTaskId) return;
    event.preventDefault();
    if (dragOverTaskId !== taskId) {
      setDragOverTaskId(taskId);
    }
  }

  function reorderTasksWithinVisibleSlice(taskList, sourceTaskId, targetTaskId) {
    if (sourceTaskId === targetTaskId) return taskList;
    const query = searchTerm.trim().toLowerCase();
    const todayKey = getTodayKey();
    const visibleTaskIds = taskList.filter((task) => taskMatchesCurrentFilters(task, query, todayKey)).map((task) => task.id);
    const sourceIndex = visibleTaskIds.indexOf(sourceTaskId);
    const targetIndex = visibleTaskIds.indexOf(targetTaskId);

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return taskList;

    const nextVisibleIds = [...visibleTaskIds];
    const [movedId] = nextVisibleIds.splice(sourceIndex, 1);
    nextVisibleIds.splice(targetIndex, 0, movedId);

    const taskById = new Map(taskList.map((task) => [task.id, task]));
    const visibleIdSet = new Set(visibleTaskIds);
    const orderedVisibleTasks = nextVisibleIds.map((id) => taskById.get(id)).filter(Boolean);
    let visibleCursor = 0;

    return taskList.map((task) => {
      if (!visibleIdSet.has(task.id)) return task;
      const reordered = orderedVisibleTasks[visibleCursor];
      visibleCursor += 1;
      return reordered || task;
    });
  }

  function handleTaskDrop(event, targetTaskId) {
    if (sortBy !== "manual") return;
    event.preventDefault();
    const sourceTaskId = readDraggedTaskId(event);

    if (!sourceTaskId || sourceTaskId === targetTaskId) {
      handleTaskDragEnd();
      return;
    }

    setTasks((previous) => reorderTasksWithinVisibleSlice(previous, sourceTaskId, targetTaskId));
    setStatus("");
    handleTaskDragEnd();
  }

  function applyTaskMoveForSection(taskId, sectionId) {
    const todayKey = getTodayKey();
    const tomorrowKey = addDaysToDateKey(todayKey, 1) || todayKey;
    const yesterdayKey = addDaysToDateKey(todayKey, -1) || todayKey;
    const sourceTask = tasks.find((task) => task.id === taskId);

    if (sectionId === "done") {
      handleTaskDone(taskId, true);
      handleSelectSidebarSection("done");
      setStatus("Moved task to Done.");
      return;
    }

    if (sectionId === "all") {
      handleSelectSidebarSection("all");
      setStatus("Showing all tasks.");
      return;
    }

    if (sourceTask?.done) {
      setTaskHistory((previousHistory) => removeLatestHistoryEntry(previousHistory, taskId));
    }

    setTasks((previous) =>
      previous.map((task) => {
        if (task.id !== taskId) return task;

        const nowIso = new Date().toISOString();
        const next = {
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

        if (sectionId === "today") {
          return {
            ...next,
            inTodayQueue: true,
            dueDate: todayKey,
          };
        }

        if (sectionId === "inbox") {
          return {
            ...next,
            inTodayQueue: false,
            projectId: defaultProjectId,
          };
        }

        if (sectionId === "planned") {
          return {
            ...next,
            inTodayQueue: false,
            dueDate: task.dueDate && task.dueDate > todayKey ? task.dueDate : tomorrowKey,
          };
        }

        if (sectionId === "recurring") {
          return {
            ...next,
            inTodayQueue: false,
            recurrence: task.recurrence.type === "none" ? { type: "daily", interval: 1 } : task.recurrence,
          };
        }

        if (sectionId === "overdue") {
          return {
            ...next,
            inTodayQueue: false,
            dueDate: yesterdayKey,
          };
        }

        return next;
      })
    );

    handleSelectSidebarSection(sectionId);
    setStatus(`Moved task to ${sectionId}.`);
  }

  function handleSectionDragOver(event, sectionId) {
    if (!dragTaskId) return;
    event.preventDefault();
    if (dragOverSectionId !== sectionId) setDragOverSectionId(sectionId);
  }

  function handleSectionDrop(event, sectionId) {
    event.preventDefault();
    const sourceTaskId = readDraggedTaskId(event);
    if (!sourceTaskId) {
      handleTaskDragEnd();
      return;
    }
    applyTaskMoveForSection(sourceTaskId, sectionId);
    handleTaskDragEnd();
  }

  function handleProjectDragOver(event, projectId) {
    if (!dragTaskId) return;
    event.preventDefault();
    if (dragOverProjectId !== projectId) setDragOverProjectId(projectId);
  }

  function handleProjectDrop(event, projectId) {
    event.preventDefault();
    const sourceTaskId = readDraggedTaskId(event);
    if (!sourceTaskId) {
      handleTaskDragEnd();
      return;
    }

    handleTaskField(sourceTaskId, (current) => ({
      ...current,
      inTodayQueue: false,
      projectId,
    }));
    handleSelectProjectFilter(projectId);
    setStatus("Moved task to project.");
    handleTaskDragEnd();
  }

  function handleTaskDragEnd() {
    setDragTaskId("");
    setDragOverTaskId("");
    setDragOverSectionId("");
    setDragOverProjectId("");
  }

  return {
    // Content state
    phase,
    setPhase,
    projects,
    setProjects,
    tasks,
    setTasks,
    taskHistory,
    setTaskHistory,
    pomodoro,
    setPomodoro,
    todaysTasksDate,
    selectedTaskId,
    setSelectedTaskId,
    defaultProjectId,

    // Filter/sort state
    searchTerm,
    setSearchTerm,
    activeSectionId,
    filterProjectId,
    setFilterProjectId,
    filterStatus,
    setFilterStatus,
    filterPriority,
    setFilterPriority,
    sortBy,
    setSortBy,

    // Computed
    visibleTasks,
    sectionCounts,

    // Project management
    newProjectName,
    setNewProjectName,
    handleAddProject,
    handleRemoveProject,

    // Task CRUD
    handleAddTask,
    handleTaskField,
    handleTaskDone,
    handleDuplicateTask,
    handleRemoveTask,
    handleMarkVisibleDone,
    handleClearCompleted,
    handleSave,

    // Section/filter
    handleSelectSidebarSection,
    handleSelectProjectFilter,
    handleResetFilters,

    // Drag
    dragTaskId,
    dragOverTaskId,
    dragOverSectionId,
    dragOverProjectId,
    handleTaskDragStart,
    handleTaskDragOver,
    handleTaskDrop,
    handleSectionDragOver,
    handleSectionDrop,
    handleProjectDragOver,
    handleProjectDrop,
    handleTaskDragEnd,
  };
}
