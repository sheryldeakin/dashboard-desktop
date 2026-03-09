import { formatDuration, formatClock, getLiveDurations } from "../../utils/taskUtils.js";

export default function TimerBar({
  task,
  pomodoroRun,
  onAction,
  onOpenDrawer,
  onEnterFocus,
  onPausePomodoro,
  onStartPomodoro,
}) {
  if (!task) return null;

  const isRunning = task.timer.status === "running";
  const isPaused = task.timer.status === "paused";
  const isTimerActive = isRunning || isPaused;
  const isPomodoroActive = pomodoroRun.status === "running" || pomodoroRun.status === "paused";

  if (!isTimerActive && !isPomodoroActive) return null;

  const runtime = getLiveDurations(task, Date.now());
  const timerDisplay = isRunning
    ? formatDuration(runtime.workMs)
    : isPaused
      ? formatDuration(runtime.restMs)
      : "";

  return (
    <div className="tp-timer-bar">
      <div className="tp-timer-bar-left">
        <span className="tp-timer-bar-dot" />
        <button type="button" className="tp-timer-bar-task" onClick={onOpenDrawer}>
          {task.text}
        </button>
      </div>
      <div className="tp-timer-bar-center">
        {isPomodoroActive && (
          <span className="tp-timer-bar-pomo">{formatClock(pomodoroRun.remainingSeconds)}</span>
        )}
        {timerDisplay && <span className="tp-timer-bar-time">{timerDisplay}</span>}
      </div>
      <div className="tp-timer-bar-right">
        {isRunning ? (
          <button type="button" className="tp-timer-bar-btn" onClick={() => onAction(task.id, "rest")} aria-label="Pause">
            <svg viewBox="0 0 24 24" className="tp-icon"><rect x="6" y="4" width="4" height="16" rx="1.5" /><rect x="14" y="4" width="4" height="16" rx="1.5" /></svg>
          </button>
        ) : isPaused ? (
          <button type="button" className="tp-timer-bar-btn" onClick={() => onAction(task.id, "resume")} aria-label="Resume">
            <svg viewBox="0 0 24 24" className="tp-icon"><path d="M8 5v14l11-7z" /></svg>
          </button>
        ) : null}
        {(isRunning || isPaused) && (
          <button type="button" className="tp-timer-bar-btn" onClick={() => onAction(task.id, "stop")} aria-label="Stop">
            <svg viewBox="0 0 24 24" className="tp-icon"><rect x="6" y="6" width="12" height="12" rx="1.8" /></svg>
          </button>
        )}
        <button type="button" className="tp-timer-bar-btn tp-timer-bar-focus" onClick={onEnterFocus}>
          Focus
        </button>
      </div>
    </div>
  );
}
