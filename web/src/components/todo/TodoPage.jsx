import { useState, useEffect, useCallback } from "react";
import {
  PRIORITY_LEVELS,
  TODO_SIDEBAR_SECTIONS,
  DEFAULT_PROJECT,
  formatPriority,
  formatRecurrence,
  RECURRENCE_TYPES,
} from "../../utils/taskUtils.js";
import { useTasks } from "../../hooks/useTasks.js";
import { usePomodoro } from "../../hooks/usePomodoro.js";
import { useTimer } from "../../hooks/useTimer.js";
import Sidebar from "./Sidebar.jsx";
import SummaryBar from "./SummaryBar.jsx";
import TaskList from "./TaskList.jsx";
import DetailDrawer from "./DetailDrawer.jsx";
import TimerBar from "./TimerBar.jsx";
import FocusMode from "./FocusMode.jsx";

export default function TodoPage() {
  const [status, setStatus] = useState("");
  const taskState = useTasks(setStatus);
  const {
    phase, projects, tasks, pomodoro, selectedTaskId, setSelectedTaskId,
    defaultProjectId, visibleTasks, sectionCounts,
    searchTerm, setSearchTerm, activeSectionId,
    filterProjectId, setFilterProjectId, filterStatus, setFilterStatus,
    filterPriority, setFilterPriority, sortBy, setSortBy,
    dragTaskId, dragOverTaskId, dragOverSectionId, dragOverProjectId,
    newProjectName, setNewProjectName, handleAddProject, handleRemoveProject,
    handleTaskField, handleTaskDone, handleDuplicateTask, handleRemoveTask,
    handleMarkVisibleDone, handleClearCompleted, handleSave,
    handleSelectSidebarSection, handleSelectProjectFilter, handleResetFilters,
    handleTaskDragStart, handleTaskDragOver, handleTaskDrop,
    handleSectionDragOver, handleSectionDrop, handleProjectDragOver,
    handleProjectDrop, handleTaskDragEnd,
    setTasks,
  } = taskState;

  const { handleTaskAction } = useTimer(setTasks, setStatus);
  const {
    pomodoroRun, setPomodoroRun,
    startPomodoro, pausePomodoro, resetPomodoro, skipPomodoro,
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
  const handleExitFocus = useCallback(() => setFocusMode(false), []);

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
          activeSectionId={activeSectionId}
          sectionCounts={sectionCounts}
          onSelectSection={handleSelectSidebarSection}
          projects={projects}
          defaultProjectId={defaultProjectId}
          filterProjectId={filterProjectId}
          onSelectProject={handleSelectProjectFilter}
          newProjectName={newProjectName}
          onNewProjectNameChange={setNewProjectName}
          onAddProject={handleAddProject}
          onRemoveProject={handleRemoveProject}
          dragOverSectionId={dragOverSectionId}
          onSectionDragOver={handleSectionDragOver}
          onSectionDrop={handleSectionDrop}
          dragOverProjectId={dragOverProjectId}
          onProjectDragOver={handleProjectDragOver}
          onProjectDrop={handleProjectDrop}
        />

        <div className="tp-main">
          <div className="tp-main-header">
            <div className="tp-main-title-row">
              <h1 className="tp-main-title">Tasks</h1>
            </div>
            <SummaryBar tasks={tasks} />
          </div>

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
                    onChange={(e) => { setFilterProjectId(e.target.value); if (e.target.value !== "all") taskState.handleSelectSidebarSection("all"); }}>
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

          <form className="tp-save-bar" onSubmit={handleSave}>
            <span className="tp-save-status">{status}</span>
            <button type="submit" className="tp-btn">Save</button>
          </form>
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
        task={timerTask || selectedTask}
        pomodoroRun={pomodoroRun}
        onAction={handleTaskAction}
        onTaskDone={handleTaskDone}
        onPausePomodoro={pausePomodoro}
        onStartPomodoro={startPomodoro}
      />
    </main>
  );
}
