import {
  parseIsoMs,
  startTask,
  pauseTask,
  resumeTask,
  stopTask,
  formatDuration,
  getLiveDurations,
} from "../utils/taskUtils.js";

export function useTimer(setTasks, setStatus) {
  function handleTaskAction(taskId, action) {
    const nowIso = new Date().toISOString();
    const nowMs = parseIsoMs(nowIso) ?? Date.now();

    setTasks((previous) =>
      previous.map((task) => {
        if (task.id !== taskId) return task;
        if (action === "start") return startTask(task, nowIso);
        if (action === "rest") return pauseTask(task, nowIso, nowMs);
        if (action === "resume") return resumeTask(task, nowIso, nowMs);
        if (action === "stop") return stopTask(task, nowIso, nowMs);
        return task;
      })
    );
    setStatus("");
  }

  function getTimerText(task, nowMs) {
    if (!task) return "";
    const runtime = getLiveDurations(task, nowMs);
    if (task.timer.status === "running") return `Work ${formatDuration(runtime.workMs)}`;
    if (task.timer.status === "paused") return `Rest ${formatDuration(runtime.restMs)}`;
    return `Total ${formatDuration(runtime.workMs + runtime.restMs)}`;
  }

  return { handleTaskAction, getTimerText };
}
