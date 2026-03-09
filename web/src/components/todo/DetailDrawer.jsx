import { useEffect } from "react";
import {
  PRIORITY_LEVELS,
  RECURRENCE_TYPES,
  formatPriority,
  formatRecurrence,
  formatDuration,
  formatClock,
  isTaskOverdue,
  getLiveDurations,
} from "../../utils/taskUtils.js";
import InsightsPanel from "./InsightsPanel.jsx";

function TaskDetail({
  task,
  projects,
  pomodoro,
  pomodoroRun,
  onTaskField,
  onTaskDone,
  onDuplicate,
  onRemove,
  onTaskAction,
  onAssignPomodoro,
  onStartPomodoro,
  onPausePomodoro,
  onResetPomodoro,
  onSkipPomodoro,
  onUpdatePomodoroSetting,
  activeTasks,
  onSetPomodoroRun,
}) {
  const pomodoroModeLabel =
    pomodoroRun.mode === "focus" ? "Focus" : pomodoroRun.mode === "shortBreak" ? "Short Break" : "Long Break";
  const recentPomodoroHistory = pomodoro.history.slice(0, 4);

  return (
    <div className="tp-drawer-body">
      <div className="tp-drawer-section">
        <label className="tp-field">
          <span className="tp-field-label">Title</span>
          <input
            className="tp-input"
            value={task.text}
            onChange={(e) => onTaskField(task.id, (c) => ({ ...c, text: e.target.value }))}
          />
        </label>

        <div className="tp-field-grid">
          <label className="tp-field">
            <span className="tp-field-label">Project</span>
            <select
              className="tp-select"
              value={task.projectId}
              onChange={(e) => onTaskField(task.id, (c) => ({ ...c, projectId: e.target.value }))}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="tp-field">
            <span className="tp-field-label">Priority</span>
            <select
              className="tp-select"
              value={task.priority}
              onChange={(e) => onTaskField(task.id, (c) => ({ ...c, priority: e.target.value }))}
            >
              {PRIORITY_LEVELS.map((p) => (
                <option key={p} value={p}>{formatPriority(p)}</option>
              ))}
            </select>
          </label>

          <label className="tp-field">
            <span className="tp-field-label">Due Date</span>
            <input
              type="date"
              className="tp-input"
              value={task.dueDate || ""}
              onChange={(e) => onTaskField(task.id, (c) => ({ ...c, dueDate: e.target.value || null }))}
            />
          </label>

          <label className="tp-field">
            <span className="tp-field-label">Recurrence</span>
            <select
              className="tp-select"
              value={task.recurrence.type}
              onChange={(e) => onTaskField(task.id, (c) => ({
                ...c, recurrence: { ...c.recurrence, type: e.target.value },
              }))}
            >
              {RECURRENCE_TYPES.map((t) => (
                <option key={t} value={t}>{formatRecurrence({ type: t, interval: 1 })}</option>
              ))}
            </select>
          </label>

          {task.recurrence.type !== "none" && (
            <label className="tp-field">
              <span className="tp-field-label">Interval</span>
              <input
                type="number"
                className="tp-input"
                min={1}
                value={task.recurrence.interval}
                onChange={(e) => onTaskField(task.id, (c) => ({
                  ...c, recurrence: { ...c.recurrence, interval: Math.max(1, Number(e.target.value) || 1) },
                }))}
              />
            </label>
          )}

          <label className="tp-field">
            <span className="tp-field-label">Est. Pomodoros</span>
            <input
              type="number"
              className="tp-input"
              min={0}
              value={task.estimatedPomodoros}
              onChange={(e) => onTaskField(task.id, (c) => ({
                ...c, estimatedPomodoros: Math.max(0, Number(e.target.value) || 0),
              }))}
            />
          </label>
        </div>

        <label className="tp-field">
          <span className="tp-field-label">Tags</span>
          <input
            className="tp-input"
            placeholder="comma separated"
            value={task.tags.join(", ")}
            onChange={(e) => {
              const tags = e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
              onTaskField(task.id, (c) => ({ ...c, tags }));
            }}
          />
        </label>

        <label className="tp-field">
          <span className="tp-field-label">Notes</span>
          <textarea
            className="tp-textarea"
            rows={3}
            placeholder="Details and next steps…"
            value={task.notes}
            onChange={(e) => onTaskField(task.id, (c) => ({ ...c, notes: e.target.value }))}
          />
        </label>
      </div>

      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">Timer</div>
        <div className="tp-drawer-timer-display">
          {(() => {
            const rt = getLiveDurations(task, Date.now());
            const label = task.timer.status === "running"
              ? "Working"
              : task.timer.status === "paused"
                ? "Resting"
                : "Total";
            const val = task.timer.status === "running"
              ? rt.workMs
              : task.timer.status === "paused"
                ? rt.restMs
                : rt.workMs + rt.restMs;
            return (
              <>
                <span className="tp-timer-label">{label}</span>
                <span className="tp-timer-value">{formatDuration(val)}</span>
              </>
            );
          })()}
        </div>
        {!task.done && (
          <div className="tp-drawer-timer-actions">
            {task.timer.status === "running" ? (
              <>
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onTaskAction(task.id, "rest")}>Pause</button>
                <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={() => onTaskAction(task.id, "stop")}>Stop</button>
              </>
            ) : task.timer.status === "paused" ? (
              <>
                <button type="button" className="tp-btn tp-btn-sm" onClick={() => onTaskAction(task.id, "resume")}>Resume</button>
                <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={() => onTaskAction(task.id, "stop")}>Stop</button>
              </>
            ) : (
              <button type="button" className="tp-btn tp-btn-sm" onClick={() => onTaskAction(task.id, "start")}>
                {task.timer.totalWorkMs > 0 ? "Resume" : "Start"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">Actions</div>
        <div className="tp-drawer-actions">
          {!task.done && (
            <button
              type="button"
              className={`tp-btn tp-btn-sm${pomodoroRun.taskId === task.id ? " is-active" : ""}`}
              onClick={() => onAssignPomodoro(task.id)}
            >
              Set as Focus Task
            </button>
          )}
          <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={() => onDuplicate(task.id)}>Duplicate</button>
          <button type="button" className="tp-btn tp-btn-sm tp-btn-danger" onClick={() => onRemove(task.id)}>Remove</button>
        </div>
      </div>

      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">Pomodoro</div>
        <div className="tp-pomo-mini">
          <div className="tp-pomo-display">
            <span className="tp-pomo-mode">{pomodoroModeLabel}</span>
            <span className="tp-pomo-clock">{formatClock(pomodoroRun.remainingSeconds)}</span>
          </div>
          <label className="tp-field">
            <span className="tp-field-label">Focus Task</span>
            <select
              className="tp-select"
              value={pomodoroRun.taskId}
              onChange={(e) => onSetPomodoroRun((prev) => ({ ...prev, taskId: e.target.value }))}
            >
              <option value="">Select task…</option>
              {activeTasks.map((t) => (
                <option key={t.id} value={t.id}>{t.text}</option>
              ))}
            </select>
          </label>
          <div className="tp-pomo-controls">
            {pomodoroRun.status === "running" ? (
              <button type="button" className="tp-btn tp-btn-sm" onClick={onPausePomodoro}>Pause</button>
            ) : (
              <button type="button" className="tp-btn tp-btn-sm" onClick={onStartPomodoro}>
                {pomodoroRun.status === "paused" ? "Resume" : "Start"}
              </button>
            )}
            <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={onSkipPomodoro}>Skip</button>
            <button type="button" className="tp-btn tp-btn-sm tp-btn-ghost" onClick={onResetPomodoro}>Reset</button>
          </div>
          <div className="tp-pomo-settings-grid">
            <label className="tp-field">
              <span className="tp-field-label">Focus</span>
              <input type="number" className="tp-input" min={5} max={180}
                value={pomodoro.settings.focusMinutes}
                onChange={(e) => onUpdatePomodoroSetting("focusMinutes", Math.max(5, Math.min(180, Number(e.target.value) || 25)))}
              />
            </label>
            <label className="tp-field">
              <span className="tp-field-label">Short</span>
              <input type="number" className="tp-input" min={1} max={60}
                value={pomodoro.settings.shortBreakMinutes}
                onChange={(e) => onUpdatePomodoroSetting("shortBreakMinutes", Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
              />
            </label>
            <label className="tp-field">
              <span className="tp-field-label">Long</span>
              <input type="number" className="tp-input" min={1} max={90}
                value={pomodoro.settings.longBreakMinutes}
                onChange={(e) => onUpdatePomodoroSetting("longBreakMinutes", Math.max(1, Math.min(90, Number(e.target.value) || 15)))}
              />
            </label>
            <label className="tp-field">
              <span className="tp-field-label">Cycles</span>
              <input type="number" className="tp-input" min={1} max={12}
                value={pomodoro.settings.cyclesBeforeLongBreak}
                onChange={(e) => onUpdatePomodoroSetting("cyclesBeforeLongBreak", Math.max(1, Math.min(12, Number(e.target.value) || 4)))}
              />
            </label>
          </div>
          <div className="tp-pomo-toggles">
            <label className="tp-toggle">
              <input type="checkbox" checked={pomodoro.settings.autoStartBreak}
                onChange={(e) => onUpdatePomodoroSetting("autoStartBreak", e.target.checked)} />
              <span>Auto break</span>
            </label>
            <label className="tp-toggle">
              <input type="checkbox" checked={pomodoro.settings.autoStartFocus}
                onChange={(e) => onUpdatePomodoroSetting("autoStartFocus", e.target.checked)} />
              <span>Auto focus</span>
            </label>
          </div>
          {recentPomodoroHistory.length > 0 && (
            <ul className="tp-pomo-history">
              {recentPomodoroHistory.map((entry) => (
                <li key={entry.id} className="tp-pomo-history-item">
                  <span>{entry.type === "focus" ? "Focus" : "Break"}</span>
                  <span>{formatDuration(entry.durationMs)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="tp-drawer-meta">
        {task.dueDate && (
          <span className={`tp-meta-tag${isTaskOverdue(task) ? " is-overdue" : ""}`}>
            Due {task.dueDate}
          </span>
        )}
        <span className="tp-meta-tag">Pomodoros {task.completedPomodoros}/{task.estimatedPomodoros || "\u2014"}</span>
      </div>
    </div>
  );
}

export default function DetailDrawer({
  mode = "overlay",
  open,
  onClose,
  task,
  projects,
  pomodoro,
  pomodoroRun,
  onTaskField,
  onTaskDone,
  onDuplicate,
  onRemove,
  onTaskAction,
  onAssignPomodoro,
  onStartPomodoro,
  onPausePomodoro,
  onResetPomodoro,
  onSkipPomodoro,
  onUpdatePomodoroSetting,
  activeTasks,
  onSetPomodoroRun,
  // Inline-mode props for InsightsPanel
  tasks,
  sectionCounts,
}) {
  useEffect(() => {
    if (mode === "inline" || !open) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode, open, onClose]);

  const sharedTaskProps = {
    task,
    projects,
    pomodoro,
    pomodoroRun,
    onTaskField,
    onTaskDone,
    onDuplicate,
    onRemove,
    onTaskAction,
    onAssignPomodoro,
    onStartPomodoro,
    onPausePomodoro,
    onResetPomodoro,
    onSkipPomodoro,
    onUpdatePomodoroSetting,
    activeTasks,
    onSetPomodoroRun,
  };

  // Inline mode: rendered inside .tp-layout as a third column
  if (mode === "inline") {
    return (
      <aside className="tp-detail-panel">
        {task ? (
          <>
            <div className="tp-drawer-header">
              <h2 className="tp-drawer-title">Task Details</h2>
            </div>
            <TaskDetail {...sharedTaskProps} />
          </>
        ) : (
          <InsightsPanel
            tasks={tasks || []}
            projects={projects}
            pomodoro={pomodoro}
            sectionCounts={sectionCounts}
          />
        )}
      </aside>
    );
  }

  // Overlay mode: current behavior
  return (
    <>
      <div
        className={`tp-drawer-backdrop${open ? " is-open" : ""}`}
        onClick={onClose}
      />
      <aside className={`tp-drawer${open ? " is-open" : ""}`}>
        <div className="tp-drawer-header">
          <h2 className="tp-drawer-title">Task Details</h2>
          <button type="button" className="tp-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {task ? (
          <TaskDetail {...sharedTaskProps} />
        ) : (
          <div className="tp-drawer-empty">Select a task to view details.</div>
        )}
      </aside>
    </>
  );
}
