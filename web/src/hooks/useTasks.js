import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  getProjectName,
  formatPriority,
  formatRecurrence,
  isTaskOverdue,
  taskMatchesSidebarSection,
  createRecurringTaskFromCompleted,
  persistContent,
  saveContent,
  completeTask,
  createHistoryEntry,
  removeLatestHistoryEntry,
  getTaskSearchIndex,
  compareTasksBySort,
} from "../utils/taskUtils.js";
import { useContent } from "../contexts/ContentContext.jsx";

/* useTasks — task page state + handlers.

   Content (tasks, projects, pomodoro, taskHistory, phase,
   todaysTasksDate) is no longer owned here. It comes from
   ContentProvider via useContent(). The hook keeps a thin layer of
   wrapped setters that update the shared content state through
   setContent for immediate UI + debounced persistContent for backend
   saves, so the external API the TodoPage consumes (setTasks,
   setProjects, ...) stays the same while the per-page fetch goes away.

   UI-only state (filters, drag, selectedTaskId, etc) stays local. */

const SAVE_DEBOUNCE_MS = 500;

export function useTasks(setStatus) {
  const { content, setContent, updateContent } = useContent();

  // Content slices, derived from the shared document. Reading these on
  // every render is cheap and ensures cross-page updates (e.g., /settings
  // adding a project) are reflected immediately on /todo.
  const phase = content.phase;
  const projects = content.projects;
  const tasks = content.todaysTasks;
  const taskHistory = content.taskHistory;
  const pomodoro = content.pomodoro;
  const todaysTasksDate = content.todaysTasksDate;

  // Debounced save plumbing. Track the LATEST content via a ref kept in
  // sync with the provider's content state. When the debounce timer
  // fires, we read the latest content rather than a captured snapshot,
  // so if another tab/page updated content between scheduleSave and
  // the timer firing (e.g., visibility-change refresh pulled remote
  // edits), the PUT carries the merged result instead of overwriting
  // with stale data.
  const latestContentRef = useRef(content);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persistContent(latestContentRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  // Flush any pending save on unmount so leaving /todo doesn't strand
  // an edit in the debounce timer.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        // Latest content already reflects any pending edit (setContent
        // was synchronous), so persistContent here flushes the right
        // thing.
        persistContent(latestContentRef.current);
      }
    };
  }, []);

  /* Build setters that mirror useState's API (accept value or
     prev=>next function) but update the shared content document. Each
     setter:
       1. Computes the next content via setContent's updater (so we see
          the latest provider state, not a closure-captured snapshot).
       2. Schedules a debounced persist with that new content.

     The handlers below (handleAddTask, handleTaskDone, etc.) all call
     these setters — no internal-code changes needed beyond the
     replacement of the local useState pairs. */
  function makeSliceSetter(key) {
    return (next) => {
      setContent((prev) => {
        const current = prev[key];
        const newValue = typeof next === "function" ? next(current) : next;
        if (newValue === current) return prev;
        const updated = { ...prev, [key]: newValue };
        // Eager localStorage write so the edit survives navigation /
        // refresh even if the debounced PUT hasn't fired yet.
        saveContent(updated);
        scheduleSave();
        return updated;
      });
    };
  }

  /* Multi-slice updater for handlers that need to mutate two or more
     slices atomically (e.g., completing a task also writes a history
     entry). The naive pattern would call setTasks inside a setTasks
     updater, but with all slices funneled through one provider state,
     a nested setContent call inside an outer setContent body loses the
     inner write — the outer's "contentRef = value" assignment overwrites
     the inner's. applyContent gives a single updater(prev) that returns
     the full new content; we commit it once. */
  const applyContent = useCallback((updater) => {
    setContent((prev) => {
      const updated = updater(prev);
      if (updated === prev) return prev;
      saveContent(updated);
      scheduleSave();
      return updated;
    });
  }, [setContent, scheduleSave]);

  const setPhase = useCallback(makeSliceSetter("phase"), [setContent, scheduleSave]);
  const setProjects = useCallback(makeSliceSetter("projects"), [setContent, scheduleSave]);
  const setTasks = useCallback(makeSliceSetter("todaysTasks"), [setContent, scheduleSave]);
  const setTaskHistory = useCallback(makeSliceSetter("taskHistory"), [setContent, scheduleSave]);
  const setPomodoro = useCallback(makeSliceSetter("pomodoro"), [setContent, scheduleSave]);
  const setTodaysTasksDate = useCallback(makeSliceSetter("todaysTasksDate"), [setContent, scheduleSave]);

  // UI-only state — stays local since it's per-page chrome, not data.
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("today");
  const [filterProjectId, setFilterProjectId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterTag, setFilterTag] = useState("");
  const [sortBy, setSortBy] = useState("manual");
  const [dragTaskId, setDragTaskId] = useState("");
  const [dragOverTaskId, setDragOverTaskId] = useState("");
  const [dragOverSectionId, setDragOverSectionId] = useState("");
  const [dragOverProjectId, setDragOverProjectId] = useState("");

  const defaultProjectId = projects[0]?.id || DEFAULT_PROJECT.id;

  // Re-render at midnight so overdue status updates
  const [dayKey, setDayKey] = useState(getTodayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const now = getTodayKey();
      if (now !== dayKey) setDayKey(now);
    }, 60000);
    return () => clearInterval(id);
  }, [dayKey]);

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
    if (!taskMatchesSidebarSection(task, activeSectionId || "all", todayKey, defaultProjectId)) return false;
    if (filterProjectId !== "all" && task.projectId !== filterProjectId) return false;
    if (filterTag && !(task.tags || []).includes(filterTag)) return false;
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

  /* Immediate persist path — used by the explicit "Save" button and the
     project add/remove flows where we want a synchronous round-trip
     rather than the debounced autosave. Cancels any pending debounce
     so we don't double-PUT, then routes through updateContent which
     does both setState (provider) and persist (localStorage + remote)
     in one call. */
  function normalizeAndPersist(next) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    let result = null;
    updateContent((prev) => {
      const normalized = normalizeContentRecord({ ...prev, ...next });
      result = normalized;
      return normalized;
    });
    return result;
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

    // Atomic: tasks + taskHistory both mutate together. Using applyContent
    // (rather than nested setTasks/setTaskHistory calls) so both writes
    // land in a single provider commit.
    applyContent((prev) => {
      let completedTask = null;
      let recurringTask = null;
      const nextTasks = prev.todaysTasks.map((task) => {
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

      let nextHistory = prev.taskHistory;
      if (checked && completedTask) {
        nextHistory = [createHistoryEntry(completedTask, nowIso, todayKey), ...prev.taskHistory]
          .slice(0, MAX_TASK_HISTORY_ITEMS);
      } else if (!checked) {
        nextHistory = removeLatestHistoryEntry(prev.taskHistory, taskId);
      }

      let finalTasks = nextTasks;
      if (recurringTask) {
        const recurringKey = `${recurringTask.recurrenceSeedId || recurringTask.id}::${recurringTask.dueDate || ""}`;
        const exists = nextTasks.some(
          (task) => `${task.recurrenceSeedId || task.id}::${task.dueDate || ""}` === recurringKey && !task.done
        );
        if (!exists) finalTasks = [...nextTasks, recurringTask];
      }

      return { ...prev, todaysTasks: finalTasks, taskHistory: nextHistory };
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

    // Tasks + history both mutate — single applyContent so the writes
    // commit atomically.
    applyContent((prev) => {
      const completedEntries = [];
      const nextTasks = prev.todaysTasks.map((task) => {
        if (!ids.has(task.id)) return task;
        const completed = completeTask(task, nowIso, nowMs);
        completedEntries.push(createHistoryEntry(completed, nowIso, day));
        return completed;
      });
      const nextHistory = [...completedEntries, ...prev.taskHistory].slice(0, MAX_TASK_HISTORY_ITEMS);
      return { ...prev, todaysTasks: nextTasks, taskHistory: nextHistory };
    });
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
    setFilterTag("");
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
    setActiveSectionId("");
    setFilterProjectId(projectId);
    setFilterTag("");
    setFilterStatus("all");
  }

  // Drilldown handler used by the sidebar's per-project sub-items (file-tag
  // children of each area-project). Sets both filters so the visible list is
  // the intersection: tasks in the project AND carrying the tag.
  function handleSelectFileTag(projectId, tag) {
    setActiveSectionId("");
    setFilterProjectId(projectId);
    setFilterTag(tag);
    setFilterStatus("all");
  }

  function handleResetFilters() {
    setActiveSectionId("today");
    setSearchTerm("");
    setFilterProjectId("all");
    setFilterTag("");
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
    filterTag,
    setFilterTag,
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
    handleSelectFileTag,
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
