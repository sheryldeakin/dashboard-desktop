/* Background tick driver. Main-thread setInterval gets throttled by Chrome
   when the window is unfocused or backgrounded (~1Hz or less, sometimes
   minutes-apart in inactive tabs). Workers run independently and aren't
   throttled by main-window focus, so timer displays driven from this
   worker keep ticking even when you're working on another monitor. */

let intervalId = null;

self.onmessage = (e) => {
  if (e.data === "start") {
    if (intervalId) return;
    // Post immediately so subscribers don't wait up to 1s for the first tick
    self.postMessage(Date.now());
    intervalId = setInterval(() => self.postMessage(Date.now()), 1000);
  } else if (e.data === "stop") {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
