import { formatDuration, getLiveDurations, getProjectName, isTaskOverdue, DEFAULT_PROJECT, getTodayKey } from "../../utils/taskUtils.js";

const PRIORITY_COLORS = {
  low: "#5b8a5a",
  medium: "#b6943e",
  high: "#c87a3e",
  urgent: "#b04a2e",
};

export default function TaskRow({
  task,
  projects,
  isSelected,
  isDragOver,
  isDragging,
  sortBy,
  pomodoroTaskId,
  onSelect,
  onCheckbox,
  onAction,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  const runtime = getLiveDurations(task, Date.now());
  const isRunning = task.timer.status === "running";
  const isPaused = task.timer.status === "paused";
  const hasTime = task.timer.totalWorkMs > 0 || isRunning || isPaused;
  const timeText = isRunning
    ? formatDuration(runtime.workMs)
    : isPaused
      ? formatDuration(runtime.restMs)
      : hasTime
        ? formatDuration(runtime.workMs)
        : "";
  const estText = task.estimatedPomodoros > 0
    ? `${task.completedPomodoros}/${task.estimatedPomodoros}p`
    : "";

  const borderColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

  // Meta info
  const todayKey = getTodayKey();
  const overdue = isTaskOverdue(task, todayKey);
  const projectName = getProjectName(projects, task.projectId);
  const showProject = task.projectId !== DEFAULT_PROJECT.id;
  const projectColor = projects.find((p) => p.id === task.projectId)?.color || DEFAULT_PROJECT.color;
  const tagsToShow = task.tags.slice(0, 2);
  const hasMeta = task.dueDate || showProject || tagsToShow.length > 0;

  let cls = "tp-task-row";
  if (task.done) cls += " is-done";
  if (isSelected) cls += " is-selected";
  if (isDragOver) cls += " is-drag-over";
  if (isDragging) cls += " is-dragging";
  if (isRunning) cls += " is-running";
  if (pomodoroTaskId === task.id) cls += " is-focus-task";

  return (
    <li
      className={cls}
      style={{ "--priority-color": borderColor }}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDrop={(e) => onDrop(e, task.id)}
    >
      <button
        type="button"
        className={`tp-drag-handle${sortBy === "manual" ? "" : " is-reorder-off"}`}
        draggable
        onDragStart={(e) => onDragStart(e, task.id)}
        onDragEnd={onDragEnd}
        aria-label="Drag to reorder"
      />

      <label className="tp-task-check">
        <input
          type="checkbox"
          checked={task.done}
          onChange={(e) => onCheckbox(task.id, e.target.checked)}
        />
      </label>

      <button
        type="button"
        className="tp-task-body"
        onClick={() => onSelect(task.id)}
      >
        <span className="tp-task-top">
          <span className="tp-task-text">{task.text}</span>
          <span className="tp-task-info">
            {estText && <span className="tp-task-est">{estText}</span>}
            {timeText && <span className="tp-task-time">{timeText}</span>}
          </span>
        </span>
        {hasMeta && (
          <span className="tp-row-meta">
            {task.dueDate && (
              <span className={`tp-meta-pill${overdue ? " is-overdue" : ""}`}>
                {task.dueDate}
              </span>
            )}
            {showProject && (
              <span className="tp-meta-pill">
                <span className="tp-meta-pill-dot" style={{ background: projectColor }} />
                {projectName}
              </span>
            )}
            {tagsToShow.map((tag) => (
              <span key={tag} className="tp-meta-pill">{tag}</span>
            ))}
          </span>
        )}
      </button>

      <div className="tp-task-end">
        {!task.done && (
          isRunning ? (
            <button
              type="button"
              className="tp-play-btn is-active"
              onClick={() => onAction(task.id, "rest")}
              aria-label="Pause"
            >
              <svg viewBox="0 0 24 24" className="tp-icon"><rect x="6" y="4" width="4" height="16" rx="1.5" /><rect x="14" y="4" width="4" height="16" rx="1.5" /></svg>
            </button>
          ) : isPaused ? (
            <button
              type="button"
              className="tp-play-btn"
              onClick={() => onAction(task.id, "resume")}
              aria-label="Resume"
            >
              <svg viewBox="0 0 24 24" className="tp-icon"><path d="M8 5v14l11-7z" /></svg>
            </button>
          ) : (
            <button
              type="button"
              className="tp-play-btn"
              onClick={() => onAction(task.id, "start")}
              aria-label="Start"
            >
              <svg viewBox="0 0 24 24" className="tp-icon"><path d="M8 5v14l11-7z" /></svg>
            </button>
          )
        )}
      </div>
    </li>
  );
}
