import { useEffect, useRef, useState } from "react";
import {
  PRIORITY_LEVELS,
  RECURRENCE_TYPES,
  formatPriority,
  formatRecurrence,
  formatDuration,
} from "../../utils/taskUtils.js";
import InsightsPanel from "./InsightsPanel.jsx";

/* Tag chip input — each existing tag renders as a pill with an × button;
   a "+ Add tag" affordance at the end expands to an inline input that
   commits on Enter and cancels on Esc/blur. Tags are normalized to
   lowercase, comma stripped, dedup'd on commit. */
function TagChipInput({ tags, onChange }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const safeTags = tags || [];

  function removeTag(tag) {
    onChange(safeTags.filter((t) => t !== tag));
  }
  function startAdd() {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function cancelAdd() {
    setAdding(false);
    setDraft("");
  }
  function commitAdd() {
    const next = draft.trim().toLowerCase().replace(/,/g, "");
    if (!next) { cancelAdd(); return; }
    if (safeTags.includes(next)) { cancelAdd(); return; }
    onChange([...safeTags, next]);
    cancelAdd();
  }

  return (
    <div className="tp-tag-chips" role="group" aria-label="Tags">
      {safeTags.map((tag) => (
        <span key={tag} className="tp-tag-chip">
          <span className="tp-tag-chip-name">#{tag}</span>
          <button
            type="button"
            className="tp-tag-chip-remove"
            onClick={() => removeTag(tag)}
            aria-label={`Remove tag ${tag}`}
            title={`Remove ${tag}`}
          >×</button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          type="text"
          className="tp-tag-chip-input"
          placeholder="tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
            else if (e.key === "Escape") { e.preventDefault(); cancelAdd(); }
          }}
          onBlur={commitAdd}
        />
      ) : (
        <button
          type="button"
          className="tp-tag-chip-add"
          onClick={startAdd}
          aria-label="Add tag"
        >
          <span aria-hidden="true">+</span>
          <span>Add tag</span>
        </button>
      )}
    </div>
  );
}

function TaskDetail({
  task,
  projects,
  pomodoro,
  pomodoroRun,
  onTaskField,
  onDuplicate,
  onRemove,
  onTaskAction,
  onAssignPomodoro,
}) {
  // Slice of recent pomodoro sessions to surface within the drawer. Sheryl
  // keeps this rather than dropping to /stats because she likes the
  // immediate "what did I just do" glance while a task is open.
  const recentPomodoroHistory = (pomodoro.history || []).slice(0, 4);
  const liveWorkMs = (() => {
    const t = task.timer || {};
    let workMs = t.totalWorkMs || 0;
    if (t.status === "running" && t.startedAt) {
      const startMs = new Date(t.startedAt).getTime();
      if (!isNaN(startMs) && Date.now() > startMs) workMs += Date.now() - startMs;
    }
    return workMs;
  })();
  const isFocusTask = pomodoroRun.taskId === task.id;

  return (
    <div className="tp-drawer-body">
      {/* Title — no label wrapper; bigger headline-style input. */}
      <div className="tp-drawer-section">
        <input
          className="settings-input tp-drawer-title-input"
          value={task.text}
          onChange={(e) => onTaskField(task.id, (c) => ({ ...c, text: e.target.value }))}
          placeholder="Task title"
          aria-label="Task title"
        />
      </div>

      {/* WHAT — identity: project, tags, notes. */}
      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">What</div>
        <label className="settings-field">
          <span className="settings-label">Project</span>
          <select
            className="settings-select"
            value={task.projectId}
            onChange={(e) => onTaskField(task.id, (c) => ({ ...c, projectId: e.target.value }))}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <div className="settings-field">
          <span className="settings-label">Tags</span>
          <TagChipInput
            tags={task.tags}
            onChange={(tags) => onTaskField(task.id, (c) => ({ ...c, tags }))}
          />
        </div>

        <label className="settings-field">
          <span className="settings-label">Notes</span>
          <textarea
            className="settings-input settings-textarea"
            rows={3}
            placeholder="Details and next steps…"
            value={task.notes}
            onChange={(e) => onTaskField(task.id, (c) => ({ ...c, notes: e.target.value }))}
          />
        </label>
      </div>

      {/* WHEN — scheduling: due date, priority, recurrence. */}
      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">When</div>
        <div className="settings-field-grid tp-drawer-field-grid">
          <label className="settings-field">
            <span className="settings-label">Due Date</span>
            <input
              type="date"
              className="settings-input"
              value={task.dueDate || ""}
              onChange={(e) => onTaskField(task.id, (c) => ({ ...c, dueDate: e.target.value || null }))}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Priority</span>
            <select
              className="settings-select"
              value={task.priority}
              onChange={(e) => onTaskField(task.id, (c) => ({ ...c, priority: e.target.value }))}
            >
              {PRIORITY_LEVELS.map((p) => (
                <option key={p} value={p}>{formatPriority(p)}</option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            <span className="settings-label">Recurrence</span>
            <select
              className="settings-select"
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
            <label className="settings-field">
              <span className="settings-label">Interval</span>
              <input
                type="number"
                className="settings-input"
                min={1}
                value={task.recurrence.interval}
                onChange={(e) => onTaskField(task.id, (c) => ({
                  ...c, recurrence: { ...c.recurrence, interval: Math.max(1, Number(e.target.value) || 1) },
                }))}
              />
            </label>
          )}
        </div>
      </div>

      {/* EFFORT — est pomodoros + done count + per-task timer. */}
      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">Effort</div>
        <div className="settings-field-grid tp-drawer-field-grid">
          <label className="settings-field">
            <span className="settings-label">Est. Pomodoros</span>
            <input
              type="number"
              className="settings-input"
              min={0}
              value={task.estimatedPomodoros}
              onChange={(e) => onTaskField(task.id, (c) => ({
                ...c, estimatedPomodoros: Math.max(0, Number(e.target.value) || 0),
              }))}
            />
          </label>

          <div className="settings-field">
            <span className="settings-label">Done</span>
            <div className="tp-drawer-readout">
              {task.completedPomodoros}/{task.estimatedPomodoros || "—"}
            </div>
          </div>
        </div>

        <div className="tp-drawer-timer-row">
          <div className="tp-drawer-timer-text">
            <span className="settings-label">Time spent</span>
            <span className="tp-drawer-timer-value">{formatDuration(liveWorkMs)}</span>
          </div>
          {!task.done && (
            <div className="tp-drawer-timer-actions">
              {task.timer.status === "running" ? (
                <>
                  <button type="button" className="settings-btn is-primary" onClick={() => onTaskAction(task.id, "rest")}>Pause</button>
                  <button type="button" className="settings-btn" onClick={() => onTaskAction(task.id, "stop")}>Stop</button>
                </>
              ) : task.timer.status === "paused" ? (
                <>
                  <button type="button" className="settings-btn is-primary" onClick={() => onTaskAction(task.id, "resume")}>Resume</button>
                  <button type="button" className="settings-btn" onClick={() => onTaskAction(task.id, "stop")}>Stop</button>
                </>
              ) : (
                <button type="button" className="settings-btn is-primary" onClick={() => onTaskAction(task.id, "start")}>
                  {task.timer.totalWorkMs > 0 ? "Resume" : "Start"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ACTIONS — Focus + Duplicate (benign, side-by-side). Remove
          lives in the Danger zone at the bottom, isolated to prevent
          mis-clicks. */}
      <div className="tp-drawer-section">
        <div className="tp-drawer-section-title">Actions</div>
        <div className="tp-drawer-actions">
          {!task.done && (
            <button
              type="button"
              className={`settings-btn is-primary${isFocusTask ? " is-active" : ""}`}
              onClick={() => onAssignPomodoro(task.id)}
            >
              {isFocusTask ? "✓ Focus task" : "Set as focus task"}
            </button>
          )}
          <button type="button" className="settings-btn" onClick={() => onDuplicate(task.id)}>Duplicate</button>
        </div>
      </div>

      {recentPomodoroHistory.length > 0 && (
        <div className="tp-drawer-section">
          <div className="tp-drawer-section-title">Recent pomodoros</div>
          <ul className="tp-pomo-history">
            {recentPomodoroHistory.map((entry) => (
              <li key={entry.id} className="tp-pomo-history-item">
                <span>{entry.type === "focus" ? "Focus" : "Break"}</span>
                <span>{formatDuration(entry.durationMs)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* DANGER \u2014 Remove isolated at the bottom, full width, separated. */}
      <div className="tp-drawer-section tp-drawer-danger-zone">
        <button
          type="button"
          className="settings-btn settings-btn-danger tp-drawer-remove-btn"
          onClick={() => onRemove(task.id)}
        >
          Remove task
        </button>
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
  onDuplicate,
  onRemove,
  onTaskAction,
  onAssignPomodoro,
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
    onDuplicate,
    onRemove,
    onTaskAction,
    onAssignPomodoro,
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
