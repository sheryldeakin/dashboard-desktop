/* RelativeTime — renders a human-readable "X ago" string and auto-updates
   every 30s so the value stays fresh without manual refresh.
   Pass `since` as an ms timestamp or Date.
   Variants:
     "ago"  → "3m ago" / "just now"
     "in"   → "in 5m" (future timestamps)
   For timestamps more than ~24h old, falls back to a date string. */

import { useEffect, useState } from "react";

const MS_PER_MIN = 60 * 1000;
const MS_PER_HR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HR;

function format(ms, variant) {
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const absDiff = Math.abs(diff);
  const future = diff < 0;

  if (absDiff < MS_PER_MIN) return future ? "in a moment" : "just now";

  if (absDiff < MS_PER_HR) {
    const min = Math.floor(absDiff / MS_PER_MIN);
    return future ? `in ${min}m` : `${min}m ago`;
  }

  if (absDiff < MS_PER_DAY) {
    const hr = Math.floor(absDiff / MS_PER_HR);
    return future ? `in ${hr}h` : `${hr}h ago`;
  }

  if (absDiff < 7 * MS_PER_DAY) {
    const day = Math.floor(absDiff / MS_PER_DAY);
    return future ? `in ${day}d` : `${day}d ago`;
  }

  // Older than a week — return an absolute short date instead
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function RelativeTime({ since, variant = "ago", className = "" }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const ms = since instanceof Date ? since.getTime() : since;
  return (
    <span className={`ui-relative-time ${className}`.trim()} title={new Date(ms).toLocaleString()}>
      {format(ms, variant)}
    </span>
  );
}
