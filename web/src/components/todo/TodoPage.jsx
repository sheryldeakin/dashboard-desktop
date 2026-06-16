import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PRIORITY_LEVELS,
  TODO_SIDEBAR_SECTIONS,
  DEFAULT_PROJECT,
  formatPriority,
  formatRecurrence,
  RECURRENCE_TYPES,
  getLastSyncedAt,
  isTaskOverdue,
} from "../../utils/taskUtils.js";

// Small "synced Xm ago" indicator near the save bar. Reads localStorage on a
// 15s interval — set when saveRemoteContent succeeds. Goes red if the last
// successful push was >30 min ago so the user notices broken sync.
function SyncIndicator() {
  const [iso, setIso] = useState(() => getLastSyncedAt());
  useEffect(() => {
    const id = setInterval(() => setIso(getLastSyncedAt()), 15000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return <span className="tp-sync-indicator">not synced yet</span>;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  let label;
  if (mins < 1) label = "just now";
  else if (mins < 60) label = `${mins}m ago`;
  else if (mins < 60 * 24) label = `${Math.floor(mins / 60)}h ago`;
  else label = `${Math.floor(mins / 60 / 24)}d ago`;
  const stale = mins > 30;
  return (
    <span
      className={`tp-sync-indicator${stale ? " is-stale" : ""}`}
      title={`Last successful sync: ${new Date(iso).toLocaleString()}`}
    >
      synced {label}
    </span>
  );
}
import { useTasks } from "../../hooks/useTasks.js";
import { usePomodoro } from "../../hooks/usePomodoro.js";
import { useTimer } from "../../hooks/useTimer.js";
import Sidebar from "./Sidebar.jsx";
import TaskList from "./TaskList.jsx";
import DetailDrawer from "./DetailDrawer.jsx";
import TimerBar from "./TimerBar.jsx";
import FocusMode from "./FocusMode.jsx";
import PageHeader from "../PageHeader.jsx";
import Chip from "../Chip.jsx";
import Tabs from "../Tabs.jsx";

export default function TodoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const taskState = useTasks(setStatus);
  const {
    phase, projects, tasks, pomodoro, selectedTaskId, setSelectedTaskId,
    defaultProjectId, visibleTasks, sectionCounts,
    searchTerm, setSearchTerm, activeSectionId,
    filterProjectId, setFilterProjectId, filterStatus, setFilterStatus,
    filterPriority, setFilterPriority, filterTag, sortBy, setSortBy,
    dragTaskId, dragOverTaskId, dragOverSectionId, dragOverProjectId,
    newProjectName, setNewProjectName, handleAddProject, handleRemoveProject,
    handleTaskField, handleTaskDone, handleDuplicateTask, handleRemoveTask,
    handleMarkVisibleDone, handleClearCompleted, handleSave,
    handleSelectSidebarSection, handleSelectProjectFilter, handleSelectFileTag, handleResetFilters,
    handleTaskDragStart, handleTaskDragOver, handleTaskDrop,
    handleSectionDragOver, handleSectionDrop, handleProjectDragOver,
    handleProjectDrop, handleTaskDragEnd,
    setTasks,
  } = taskState;

  const { handleTaskAction } = useTimer(setTasks, setStatus);
  const {
    pomodoroRun, setPomodoroRun,
    startPomodoro, pausePomodoro, resetPomodoro, skipPomodoro, stopPomodoro,
    assignPomodoroTask, updatePomodoroSetting,
  } = usePomodoro(pomodoro, taskState.setPomodoro, tasks, setTasks, setStatus);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [quickAddText, setQuickAddText] = useState("");
  const [isWideScreen, setIsWideScreen] = useState(false);

  // Filter panel state
  const [filtersOpen, setFiltersOpen] = useState(false);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null;
  const activeTasks = tasks.filter((t) => !t.done);
  const activeSection = TODO_SIDEBAR_SECTIONS.find((s) => s.id === activeSectionId) || TODO_SIDEBAR_SECTIONS[0];

  // Find the task that has an active timer or pomodoro
  const timerTask = tasks.find((t) =>
    (t.timer.status === "running" || t.timer.status === "paused") ||
    (pomodoroRun.taskId === t.id && (pomodoroRun.status === "running" || pomodoroRun.status === "paused"))
  ) || null;

  function handleQuickAdd() {
    const text = quickAddText.trim();
    if (!text) return;
    taskState.handleAddTask(text, {
      inTodayQueue: activeSectionId === "today",
      projectId: defaultProjectId,
    });
    setQuickAddText("");
  }

  // URL-sync wrappers for the sidebar selectors. The underlying handlers
  // (from useTasks) own the state — we just mirror the choice into
  // ?section= / ?project= so refresh restores it. replace:true keeps
  // sidebar clicks out of the back-button stack.
  function setSectionInUrl(sectionId) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("project");
        // "today" is the default; omit param to keep the URL clean.
        if (sectionId === "today") next.delete("section");
        else next.set("section", sectionId);
        return next;
      },
      { replace: true },
    );
  }

  function setProjectInUrl(projectId) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("section");
        if (!projectId || projectId === "all") next.delete("project");
        else next.set("project", projectId);
        return next;
      },
      { replace: true },
    );
  }

  function handleSelectSidebarSectionWithUrl(sectionId) {
    handleSelectSidebarSection(sectionId);
    setSectionInUrl(sectionId);
  }

  function handleSelectProjectFilterWithUrl(projectId) {
    handleSelectProjectFilter(projectId);
    setProjectInUrl(projectId);
  }

  // Distinct dropdown handler: picking "All Projects" should clear the
  // filter without disrupting the active sidebar section. (Original code
  // here had a setFilterProjectId + handleSelectSidebarSection("all")
  // pair that clobbered itself — the section call reset filterProjectId
  // back to "all" before the user-selected project could land.) Specific
  // projects still go through handleSelectProjectFilterWithUrl which
  // does the cross-section filter UX correctly.
  function handleDropdownProjectFilter(projectId) {
    if (projectId === "all") {
      setFilterProjectId("all");
      setProjectInUrl("all");
      return;
    }
    handleSelectProjectFilterWithUrl(projectId);
  }

  // On mount: restore section/project from URL if present. Project takes
  // precedence over section (matches the mutually-exclusive semantics of
  // the handlers — selecting one clears the other). Guarded by a ref so
  // we don't re-apply if searchParams change later from other paths.
  const sectionRestoredRef = useRef(false);
  useEffect(() => {
    if (sectionRestoredRef.current) return;
    const urlProject = searchParams.get("project");
    const urlSection = searchParams.get("section");
    if (urlProject) handleSelectProjectFilter(urlProject);
    else if (urlSection) handleSelectSidebarSection(urlSection);
    sectionRestoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectTask(taskId) {
    if (isWideScreen) {
      // Toggle selection: clicking same task deselects (returns to insights)
      setSelectedTaskId((prev) => prev === taskId ? null : taskId);
    } else {
      setSelectedTaskId(taskId);
      setDrawerOpen(true);
    }
  }

  const handleCloseDrawer = useCallback(() => setDrawerOpen(false), []);
  const handleExitFocus = useCallback(() => {
    setFocusMode(false);
    // Clear ?focus=1 (and any other params) from the URL so the address
    // bar reflects the actual page state. Using replace: true so we don't
    // pollute the history stack with an extra "exited focus" entry.
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  function handleRemoveTaskFull(taskId) {
    handleRemoveTask(taskId);
    setPomodoroRun((prev) =>
      prev.taskId === taskId ? { ...prev, taskId: "" } : prev
    );
    if (isWideScreen) {
      setSelectedTaskId(null);
    } else {
      setDrawerOpen(false);
    }
  }

  // Auto-collapse sidebar on narrow viewports
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1200px)");
    function handle(e) {
      if (e.matches) setSidebarCollapsed(true);
    }
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  // Wide screen detection for inline detail panel
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1500px)");
    function handle(e) {
      setIsWideScreen(e.matches);
    }
    handle(mq);
    mq.addEventListener("change", handle);
    return () => mq.removeEventListener("change", handle);
  }, []);

  // Auto-open focus mode from ?focus=1 query (TopNav Focus link, dashboard
  // Focus button, sidebar Focus link all use this same handoff).
  useEffect(() => {
    if (searchParams.get("focus") === "1") setFocusMode(true);
  }, [searchParams]);

  // Sync the task's work timer with the pomodoro state.
  // Merged-timer model: work timer runs only when pomodoro is in focus mode AND
  // running. During breaks, paused, or idle states the work timer is paused.
  // This means: focus ends -> break auto-starts -> work timer pauses automatically;
  // break ends -> focus auto-starts -> work timer resumes automatically.
  useEffect(() => {
    if (!pomodoroRun.taskId) return;
    const pomoTask = tasks.find((t) => t.id === pomodoroRun.taskId);
    if (!pomoTask) return;
    const shouldRunWorkTimer = pomodoroRun.mode === "focus" && pomodoroRun.status === "running";
    const workTimerRunning = pomoTask.timer.status === "running";
    if (shouldRunWorkTimer && !workTimerRunning) {
      handleTaskAction(pomoTask.id, pomoTask.timer.status === "paused" ? "resume" : "start");
    } else if (!shouldRunWorkTimer && workTimerRunning && pomodoroRun.status !== "idle") {
      // Pause the work timer when the pomodoro is paused or on a break — but NOT when
      // the pomodoro is idle. An idle pomodoro means it isn't driving; leave the work
      // timer free so the focus-mode controls can run it directly (pomodoro-off mode).
      handleTaskAction(pomoTask.id, "rest");
    }
  }, [pomodoroRun.mode, pomodoroRun.status, pomodoroRun.taskId, tasks, handleTaskAction]);

  // Auto-assign task to pomodoro from ?focus=1&taskId=X (set by dashboard
  // Focus button). The focus=1 gate is important: without it, a bare
  // ?taskId=X means "open detail panel" (handled by the next effect),
  // not "assign for pomodoro." Once we've consumed it, drop the param so
  // a reload doesn't re-trigger; ?focus=1 stays so we remain in focus
  // mode after the handoff.
  const taskIdAssignedRef = useRef(false);
  useEffect(() => {
    if (taskIdAssignedRef.current || tasks.length === 0) return;
    if (searchParams.get("focus") !== "1") return;
    const taskIdParam = searchParams.get("taskId");
    if (taskIdParam && tasks.some((t) => t.id === taskIdParam && !t.done)) {
      assignPomodoroTask(taskIdParam);
    }
    taskIdAssignedRef.current = true;
    if (taskIdParam) {
      const next = new URLSearchParams(searchParams);
      next.delete("taskId");
      setSearchParams(next, { replace: true });
    }
  }, [tasks, assignPomodoroTask, searchParams, setSearchParams]);

  // Detail-panel deep-link: ?taskId=X without ?focus=1 means "open this
  // task's detail panel." Restore from URL once we have the REAL task
  // for it — not just any non-empty task list.
  //
  // Gotcha: useTasks momentarily holds DEFAULT_CONTENT (task-default-1)
  // when localStorage is empty and the API fetch is in flight. If we
  // claim "restored" off that intermediate state — when the URL task
  // doesn't exist yet — we'd lock the ref guard before the real tasks
  // arrive, and the deep-link gets clobbered. Instead: only set the
  // ref AFTER successfully matching the URL task in the loaded set, OR
  // after confirming there's nothing to restore (?taskId missing or
  // owned by focus=1).
  const taskIdRestoredRef = useRef(false);
  useEffect(() => {
    if (taskIdRestoredRef.current) return;
    if (tasks.length === 0) return; // wait for any tasks

    // Focus handoff owns ?taskId on its own path; nothing to do here.
    if (searchParams.get("focus") === "1") {
      taskIdRestoredRef.current = true;
      return;
    }

    const urlTaskId = searchParams.get("taskId");
    if (!urlTaskId) {
      taskIdRestoredRef.current = true;
      return;
    }

    // Only claim restored once the deep-linked task actually exists in
    // the current task set. If it doesn't (we're still on default seed
    // content), bail without setting the ref — the effect re-fires when
    // tasks updates and we get another shot.
    const task = tasks.find((t) => t.id === urlTaskId);
    if (task) {
      setSelectedTaskId(urlTaskId);
      taskIdRestoredRef.current = true;

      // Cross-section deep-link: if the task isn't going to appear in
      // the default Today section's visibleTasks (it's done, or not in
      // today's queue), the visibility-check effect in useTasks would
      // immediately swap selectedTaskId to the first visible task.
      // Pre-empt that by auto-switching to a section the task IS in:
      // "done" for completed tasks, "all" otherwise. Skip if the URL
      // already has an explicit ?section= choice.
      if (!searchParams.get("section")) {
        if (task.done) {
          handleSelectSidebarSectionWithUrl("done");
        } else if (!task.inTodayQueue) {
          handleSelectSidebarSectionWithUrl("all");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Sync selectedTaskId → ?taskId in the URL. Runs only after the initial
  // restore above, so we don't blow away the URL param on first render.
  // Reads window.location.search directly (not the setSearchParams updater's
  // `prev`) because React Router batches setSearchParams calls in a way
  // that can stale-out `prev` when multiple sources update URL in the same
  // tick (e.g., the restore effect's section auto-switch). Using the live
  // URL guarantees we preserve any params written just before us.
  useEffect(() => {
    if (!taskIdRestoredRef.current) return;
    const next = new URLSearchParams(window.location.search);
    // Don't fight the focus-handoff effect — if ?focus=1 is active,
    // ?taskId is owned by that path.
    if (next.get("focus") === "1") return;
    if (selectedTaskId) next.set("taskId", selectedTaskId);
    else next.delete("taskId");
    setSearchParams(next, { replace: true });
  }, [selectedTaskId, setSearchParams]);

  const drawerProps = {
    task: selectedTask,
    projects,
    pomodoro,
    pomodoroRun,
    onTaskField: handleTaskField,
    onTaskDone: handleTaskDone,
    onDuplicate: handleDuplicateTask,
    onRemove: handleRemoveTaskFull,
    onTaskAction: handleTaskAction,
    onAssignPomodoro: assignPomodoroTask,
    onStartPomodoro: startPomodoro,
    onPausePomodoro: pausePomodoro,
    onResetPomodoro: resetPomodoro,
    onSkipPomodoro: skipPomodoro,
    onUpdatePomodoroSetting: updatePomodoroSetting,
    activeTasks,
    onSetPomodoroRun: setPomodoroRun,
  };

  return (
    <main className="tp-page">
      <TimerBar
        task={timerTask}
        pomodoroRun={pomodoroRun}
        onAction={handleTaskAction}
        onOpenDrawer={() => {
          if (timerTask) {
            setSelectedTaskId(timerTask.id);
            if (!isWideScreen) setDrawerOpen(true);
          }
        }}
        onEnterFocus={() => setFocusMode(true)}
        onPausePomodoro={pausePomodoro}
        onStartPomodoro={startPomodoro}
      />

      <div className="tp-layout">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((p) => !p)}
          projects={projects}
          defaultProjectId={defaultProjectId}
          filterProjectId={filterProjectId}
          filterTag={filterTag}
          onSelectProject={handleSelectProjectFilterWithUrl}
          onSelectFileTag={handleSelectFileTag}
          tasks={tasks}
          newProjectName={newProjectName}
          onNewProjectNameChange={setNewProjectName}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          dragOverProjectId={dragOverProjectId}
          onProjectDragOver={handleProjectDragOver}
          onProjectDrop={handleProjectDrop}
        />

        <div className="tp-main">
          {/* Summary chip values are computed inline below — chips now
              ride in the PageHeader slot, not as a SummaryBar row. */}
          <PageHeader
            title="Tasks"
            chips={(() => {
              const active = tasks.filter((t) => !t.done).length;
              const done = tasks.filter((t) => t.done).length;
              const overdue = tasks.filter((t) => isTaskOverdue(t)).length;
              const estPomos = tasks.reduce(
                (s, t) => s + (t.done ? 0 : t.estimatedPomodoros || 0),
                0,
              );
              const donePomos = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);
              return [
                <Chip key="active">
                  <strong>{active}</strong> active
                </Chip>,
                <Chip key="done">
                  <strong>{done}</strong> done
                </Chip>,
                overdue > 0 && (
                  <Chip key="overdue" tone="warning">
                    <strong>{overdue}</strong> overdue
                  </Chip>
                ),
                <Chip key="pomos">
                  <strong>{donePomos}</strong>/{estPomos || "—"} pomos
                </Chip>,
              ].filter(Boolean);
            })()}
            actions={
              <form className="tp-header-actions" onSubmit={handleSave}>
                {status && <span className="tp-header-status">{status}</span>}
                <SyncIndicator />
                <button type="submit" className="settings-btn is-primary">
                  Save
                </button>
              </form>
            }
          />

          {/* Section tabs (Phase B). Replaces the old .tp-sidebar-sections
              column. Counts come from useTasks's sectionCounts map. Tabs
              with no items collapse the count badge; the falsy-count
              check inside <Tabs> handles that. */}
          <Tabs
            tabs={TODO_SIDEBAR_SECTIONS.map((s) => ({
              id: s.id,
              label: s.label,
              count: sectionCounts[s.id] || 0,
            }))}
            active={activeSectionId}
            onChange={handleSelectSidebarSectionWithUrl}
            className="tp-section-tabs"
          />

          {/* Filters accordion */}
          <div className="tp-filters-bar">
            <button type="button" className="tp-filters-toggle" onClick={() => setFiltersOpen((p) => !p)}>
              {filtersOpen ? "Hide Filters" : "Filters & Sort"}
            </button>
            {filtersOpen && (
              <div className="tp-filters-panel">
                <label className="tp-field">
                  <span className="tp-field-label">Search</span>
                  <input className="tp-input" type="search" placeholder="Find tasks…"
                    value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </label>
                <label className="tp-field">
                  <span className="tp-field-label">Project</span>
                  <select className="tp-select" value={filterProjectId}
                    onChange={(e) => handleDropdownProjectFilter(e.target.value)}>
                    <option value="all">All Projects</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="tp-field">
                  <span className="tp-field-label">Status</span>
                  <select className="tp-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="done">Done</option>
                    <option value="overdue">Overdue</option>
                  </select>
                </label>
                <label className="tp-field">
                  <span className="tp-field-label">Priority</span>
                  <select className="tp-select" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
                    <option value="all">All</option>
                    {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{formatPriority(p)}</option>)}
                  </select>
                </label>
                <label className="tp-field">
                  <span className="tp-field-label">Sort</span>
                  <select className="tp-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="manual">Manual</option>
                    <option value="priority">Priority</option>
                    <option value="dueDate">Due Date</option>
                    <option value="updatedAt">Updated</option>
                    <option value="alphabetical">A-Z</option>
                  </select>
                </label>
                <div className="tp-filters-actions">
                  <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={handleMarkVisibleDone}>Mark Done</button>
                  <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={handleClearCompleted}>Clear Done</button>
                  <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={handleResetFilters}>Reset</button>
                </div>
              </div>
            )}
          </div>

          <TaskList
            visibleTasks={visibleTasks}
            totalCount={tasks.length}
            selectedTaskId={selectedTaskId}
            sortBy={sortBy}
            dragTaskId={dragTaskId}
            dragOverTaskId={dragOverTaskId}
            pomodoroTaskId={pomodoroRun.taskId}
            activeSection={activeSection}
            projects={projects}
            onSelectTask={handleSelectTask}
            onTaskCheckbox={handleTaskDone}
            onTaskAction={handleTaskAction}
            onTaskDragStart={handleTaskDragStart}
            onTaskDragOver={handleTaskDragOver}
            onTaskDrop={handleTaskDrop}
            onTaskDragEnd={handleTaskDragEnd}
            quickAddValue={quickAddText}
            onQuickAddChange={setQuickAddText}
            onQuickAdd={handleQuickAdd}
          />

        </div>

        {/* Inline detail panel on wide screens */}
        {isWideScreen && (
          <DetailDrawer
            mode="inline"
            {...drawerProps}
            tasks={tasks}
            sectionCounts={sectionCounts}
          />
        )}
      </div>

      {/* Overlay drawer on narrow screens */}
      {!isWideScreen && (
        <DetailDrawer
          mode="overlay"
          open={drawerOpen}
          onClose={handleCloseDrawer}
          {...drawerProps}
        />
      )}

      <FocusMode
        open={focusMode}
        onExit={handleExitFocus}
        task={(pomodoroRun.taskId && tasks.find((t) => t.id === pomodoroRun.taskId)) || timerTask || selectedTask}
        pomodoroRun={pomodoroRun}
        pomodoroSettings={pomodoro.settings}
        onAction={handleTaskAction}
        onTaskDone={handleTaskDone}
        onPausePomodoro={pausePomodoro}
        onStartPomodoro={startPomodoro}
        onSkipPomodoro={skipPomodoro}
        onStopPomodoro={stopPomodoro}
        onAssignPomodoroTask={assignPomodoroTask}
        onUpdatePomodoroSetting={updatePomodoroSetting}
      />
    </main>
  );
}
