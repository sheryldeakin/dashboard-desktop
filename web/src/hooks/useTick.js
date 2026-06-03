import { useEffect, useState } from "react";
import TickWorker from "../workers/tick-worker.js?worker";

/* Shared 1Hz tick driven by a Web Worker so it doesn't freeze when the
   window is unfocused or backgrounded (main-thread setInterval gets
   throttled hard in those states; workers don't to the same degree).

   Singleton + ref-count: one worker for the whole app, spun up on first
   subscriber, torn down when the last one unmounts. Returns Date.now()
   as the tick value so consumers can drive Date.now()-based displays
   with no further work. */

let worker = null;
const listeners = new Set();

function ensureWorker() {
  if (worker) return;
  worker = new TickWorker();
  worker.onmessage = (e) => {
    for (const cb of listeners) cb(e.data);
  };
  worker.postMessage("start");
}

function maybeTeardownWorker() {
  if (worker && listeners.size === 0) {
    worker.postMessage("stop");
    worker.terminate();
    worker = null;
  }
}

/**
 * Subscribe a component to a 1Hz tick. Returns the current Date.now()
 * value, updated each second. Pass `enabled=false` to opt out (e.g. only
 * tick while a timer is active).
 *
 * Hook is always called even when disabled — Rules of Hooks. The
 * conditional logic lives inside the effect.
 */
export function useTick(enabled = true) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    ensureWorker();
    listeners.add(setTick);
    return () => {
      listeners.delete(setTick);
      maybeTeardownWorker();
    };
  }, [enabled]);

  return tick;
}
