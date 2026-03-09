import { useEffect, useState } from "react";
import {
  parseIsoMs,
  MAX_POMODORO_HISTORY_ITEMS,
  createPomodoroSessionEntry,
  appendSessionToTaskTimer,
  getPomodoroModeSeconds,
} from "../utils/taskUtils.js";

export function usePomodoro(pomodoro, setPomodoro, tasks, setTasks, setStatus) {
  const initialFocusSeconds = getPomodoroModeSeconds("focus", pomodoro.settings);
  const [pomodoroRun, setPomodoroRun] = useState({
    mode: "focus",
    status: "idle",
    taskId: "",
    remainingSeconds: initialFocusSeconds,
    segmentSeconds: initialFocusSeconds,
    startedAt: null,
    cycleCount: 0,
  });

  function initPomodoroRun(settings) {
    const focusSeconds = getPomodoroModeSeconds("focus", settings);
    setPomodoroRun({
      mode: "focus",
      status: "idle",
      taskId: "",
      remainingSeconds: focusSeconds,
      segmentSeconds: focusSeconds,
      startedAt: null,
      cycleCount: 0,
    });
  }

  // Sync pomodoro task validity
  useEffect(() => {
    if (!pomodoroRun.taskId) return;
    if (!tasks.some((task) => task.id === pomodoroRun.taskId && !task.done)) {
      setPomodoroRun((previous) => ({
        ...previous,
        taskId: "",
      }));
    }
  }, [tasks, pomodoroRun.taskId]);

  // Sync settings to idle timer
  useEffect(() => {
    if (pomodoroRun.status !== "idle") return;
    const nextSeconds = getPomodoroModeSeconds(pomodoroRun.mode, pomodoro.settings);
    setPomodoroRun((previous) => {
      if (previous.status !== "idle") return previous;
      if (previous.mode !== pomodoroRun.mode) return previous;
      return {
        ...previous,
        remainingSeconds: nextSeconds,
        segmentSeconds: nextSeconds,
      };
    });
  }, [
    pomodoro.settings.focusMinutes,
    pomodoro.settings.shortBreakMinutes,
    pomodoro.settings.longBreakMinutes,
    pomodoroRun.mode,
    pomodoroRun.status,
  ]);

  // Tick timer
  useEffect(() => {
    if (pomodoroRun.status !== "running") return;

    const id = window.setInterval(() => {
      setPomodoroRun((previous) => {
        if (previous.status !== "running") return previous;
        return {
          ...previous,
          remainingSeconds: Math.max(0, previous.remainingSeconds - 1),
        };
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [pomodoroRun.status]);

  // Handle completion
  useEffect(() => {
    if (pomodoroRun.status !== "running" || pomodoroRun.remainingSeconds > 0) return;

    const endedAt = new Date().toISOString();
    const startedAt =
      parseIsoMs(pomodoroRun.startedAt) !== null
        ? pomodoroRun.startedAt
        : new Date(Date.now() - pomodoroRun.segmentSeconds * 1000).toISOString();
    const durationMs = pomodoroRun.segmentSeconds * 1000;
    const entryType = pomodoroRun.mode;

    setPomodoro((previous) => ({
      ...previous,
      history: [
        createPomodoroSessionEntry({
          taskId: pomodoroRun.taskId,
          type: entryType,
          startedAt,
          endedAt,
          durationMs,
        }),
        ...previous.history,
      ].slice(0, MAX_POMODORO_HISTORY_ITEMS),
    }));

    if (pomodoroRun.taskId) {
      setTasks((previous) =>
        previous.map((task) => {
          if (task.id !== pomodoroRun.taskId) return task;
          const withSession = appendSessionToTaskTimer(
            task,
            entryType === "focus" ? "work" : "rest",
            startedAt,
            endedAt,
            durationMs
          );
          return entryType === "focus"
            ? {
                ...withSession,
                completedPomodoros: (withSession.completedPomodoros || 0) + 1,
              }
            : withSession;
        })
      );
    }

    const nextCycleCount = entryType === "focus" ? pomodoroRun.cycleCount + 1 : pomodoroRun.cycleCount;
    const nextMode =
      entryType === "focus"
        ? nextCycleCount % Math.max(1, pomodoro.settings.cyclesBeforeLongBreak) === 0
          ? "longBreak"
          : "shortBreak"
        : "focus";
    const autoStart = entryType === "focus" ? pomodoro.settings.autoStartBreak : pomodoro.settings.autoStartFocus;
    const nextSeconds = getPomodoroModeSeconds(nextMode, pomodoro.settings);

    setPomodoroRun({
      mode: nextMode,
      status: autoStart ? "running" : "idle",
      taskId: pomodoroRun.taskId,
      remainingSeconds: nextSeconds,
      segmentSeconds: nextSeconds,
      startedAt: autoStart ? endedAt : null,
      cycleCount: nextCycleCount,
    });
    setStatus(
      `Pomodoro ${entryType === "focus" ? "focus" : "break"} complete.${autoStart ? "" : " Press save to sync changes."}`
    );
  }, [
    pomodoroRun.status,
    pomodoroRun.remainingSeconds,
    pomodoroRun.startedAt,
    pomodoroRun.segmentSeconds,
    pomodoroRun.mode,
    pomodoroRun.taskId,
    pomodoroRun.cycleCount,
    pomodoro.settings.cyclesBeforeLongBreak,
    pomodoro.settings.autoStartBreak,
    pomodoro.settings.autoStartFocus,
    pomodoro.settings.focusMinutes,
    pomodoro.settings.shortBreakMinutes,
    pomodoro.settings.longBreakMinutes,
  ]);

  function startPomodoro() {
    if (pomodoroRun.mode === "focus" && !pomodoroRun.taskId) {
      setStatus("Select a task for focus mode first.");
      return;
    }
    const nowIso = new Date().toISOString();
    setPomodoroRun((previous) => ({
      ...previous,
      status: "running",
      startedAt: previous.startedAt || nowIso,
    }));
  }

  function pausePomodoro() {
    setPomodoroRun((previous) => ({
      ...previous,
      status: "paused",
    }));
  }

  function resetPomodoro() {
    const seconds = getPomodoroModeSeconds("focus", pomodoro.settings);
    setPomodoroRun({
      mode: "focus",
      status: "idle",
      taskId: "",
      remainingSeconds: seconds,
      segmentSeconds: seconds,
      startedAt: null,
      cycleCount: 0,
    });
  }

  function skipPomodoro() {
    setPomodoroRun((previous) => ({
      ...previous,
      status: "running",
      remainingSeconds: 0,
      startedAt: previous.startedAt || new Date().toISOString(),
    }));
  }

  function assignPomodoroTask(taskId) {
    setPomodoroRun((previous) => ({
      ...previous,
      taskId,
    }));
    setStatus("");
  }

  function updatePomodoroSetting(key, rawValue) {
    setPomodoro((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        [key]: rawValue,
      },
    }));
    setStatus("");
  }

  return {
    pomodoroRun,
    setPomodoroRun,
    initPomodoroRun,
    startPomodoro,
    pausePomodoro,
    resetPomodoro,
    skipPomodoro,
    assignPomodoroTask,
    updatePomodoroSetting,
  };
}
