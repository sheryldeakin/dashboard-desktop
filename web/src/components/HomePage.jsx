import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadAndHydratePreferredContent,
  cloneContent,
  DEFAULT_CONTENT,
  persistContent,
  normalizeContentRecord,
  newId,
  parseIsoMs,
  createDefaultTask,
} from "../utils/taskUtils.js";

/* /home — daily-driver landing.
   Sections: header (date + deadline countdown), today's Top 3 (editable),
   unfinished from yesterday (carry/done/promote/drop actions).
   Other sections (peak hour, resume, up next) queued for follow-up turns.

   State pattern matches useTasks: pristineRef holds the full loaded content
   so save bodies preserve fields HomePage doesn't manage (workSessions,
   todaysTasks, etc.). Without it, every Top 3 edit would clobber those. */

const MS_PER_MIN = 60 * 1000;
const MS_PER_HR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HR;
const TOP3_TAG = "carried-from-top3";

function todayKey() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * MS_PER_MIN;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const tz = d.getTimezoneOffset() * MS_PER_MIN;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function dayCountUntil(iso) {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const now = Date.now();
  const days = Math.ceil((target - now) / MS_PER_DAY);
  return days;
}

function formatDateLong(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/* ── Schedule heartbeat status ── */
// Expected cadence per script + the multiplier at which we call it "stale".
// Stale threshold = expected × 2 — gives one missed run worth of grace before
// raising the alarm.
const HEARTBEAT_SPEC = [
  { key: "sync-top3",              label: "Top 3 sync",         expectedMin: 5 },
  { key: "sync-todos",             label: "Todos sync",         expectedMin: 15 },
  { key: "import-claude-sessions", label: "Claude import",      expectedMin: 60 },
  { key: "backup-dashboard",       label: "Daily backup",       expectedMin: 60 * 24 },
];

function relTime(ms) {
  const min = Math.floor(ms / MS_PER_MIN);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 60 / 24)}d ago`;
}

/* Shared hook so the banner (full-width, top of page) and the rail card
   (right column) read from the same computed rows. Ticks every 30s to keep
   "Xm ago" labels fresh. */
function useHeartbeatRows(heartbeats) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return HEARTBEAT_SPEC.map((s) => {
    const iso = heartbeats?.[s.key];
    const ts = iso ? Date.parse(iso) : null;
    const ageMs = ts ? now - ts : null;
    const stale = ts === null || ageMs > s.expectedMin * MS_PER_MIN * 2;
    return { ...s, iso, ts, ageMs, stale };
  });
}

/* Banner sits above the layout grid (full width). Only renders if at least
   one heartbeat is stale — otherwise the page should feel calm. */
function ScheduleBanner({ rows }) {
  const staleRows = rows.filter((r) => r.stale);
  if (staleRows.length === 0) return null;
  return (
    <section className="home-schedule-banner">
      <div className="home-schedule-banner-title">
        ⚠ Schedule issue: {staleRows.length} task{staleRows.length === 1 ? "" : "s"} not running
      </div>
      <ul className="home-schedule-banner-list">
        {staleRows.map((r) => (
          <li key={r.key}>
            <strong>{r.label}</strong> —{" "}
            {r.iso ? `last run ${relTime(r.ageMs)}` : "no run recorded"}
            {" "}(expected every {r.expectedMin < 60 ? `${r.expectedMin} min` : r.expectedMin === 60 ? "hour" : `${r.expectedMin / 60} hr`})
          </li>
        ))}
      </ul>
      <p className="home-schedule-banner-help">
        Run a script manually to diagnose, or check{" "}
        <code>schtasks /query /tn Dashboard{`<name>`} /v /fo LIST | findstr "Last Result"</code>
        {" "}— anything other than 0 means it crashed.
      </p>
    </section>
  );
}

/* Compact rail card. Headline = single status pill ("all running" / "X stale")
   with a fold-out detail list. Trades visibility-by-default for chrome. */
function ScheduleHealthCard({ rows }) {
  const staleCount = rows.filter((r) => r.stale).length;
  const [open, setOpen] = useState(staleCount > 0);
  return (
    <section className="home-rail-card">
      <button
        type="button"
        className="home-rail-card-toggle"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
      >
        <span className="home-rail-card-title">Schedule</span>
        <span className={`home-status-pill${staleCount === 0 ? " is-ok" : " is-warn"}`}>
          {staleCount === 0 ? "● all running" : `⚠ ${staleCount} stale`}
        </span>
      </button>
      {open && (
        <ul className="home-schedule-list">
          {rows.map((r) => (
            <li key={r.key} className={`home-schedule-row${r.stale ? " is-stale" : ""}`}>
              <span className="home-schedule-name">{r.label}</span>
              <span className="home-schedule-when">
                {r.iso ? relTime(r.ageMs) : "never"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Peak hour pattern (last 8 weeks) ── */
function computePeakHour(workSessions) {
  const cutoff = Date.now() - 8 * 7 * MS_PER_DAY;
  const hourMs = Array(24).fill(0);
  const hourDays = Array.from({ length: 24 }, () => new Set());
  for (const ws of workSessions || []) {
    const start = parseIsoMs(ws.startedAt);
    if (start === null || start < cutoff) continue;
    const end = parseIsoMs(ws.endedAt);
    if (end === null || end <= start) continue;
    const activeMs = ws.activeMs || end - start;
    const factor = activeMs / (end - start);
    let cursor = start;
    while (cursor < end) {
      const d = new Date(cursor);
      const hr = d.getHours();
      const nextBoundary = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        hr + 1,
        0,
        0
      ).getTime();
      const segEnd = Math.min(end, nextBoundary);
      hourMs[hr] += (segEnd - cursor) * factor;
      hourDays[hr].add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
      cursor = segEnd;
    }
  }
  let peakHr = -1;
  let peakTotalMs = 0;
  for (let h = 0; h < 24; h++) {
    if (hourMs[h] > peakTotalMs) {
      peakTotalMs = hourMs[h];
      peakHr = h;
    }
  }
  if (peakHr === -1) return null;
  const activeDays = hourDays[peakHr].size;
  return {
    hour: peakHr,
    avgMinPerActiveDay: activeDays > 0 ? Math.round(peakTotalMs / activeDays / MS_PER_MIN) : 0,
    activeDays,
    totalMs: peakTotalMs,
  };
}

/* Compact rail card. Hero number = peak hour; sub-line = the contextual
   "when" hint based on current clock vs peak. */
function PeakHourCard({ workSessions }) {
  const peak = useMemo(() => computePeakHour(workSessions), [workSessions]);
  if (!peak) return null;
  const now = new Date();
  const currentHr = now.getHours();
  const currentMin = now.getMinutes();
  const diff = currentHr - peak.hour;
  let when;
  let whenTone = "neutral";
  if (currentHr === peak.hour) {
    when = "in your green window";
    whenTone = "good";
  } else if (currentHr === peak.hour - 1) {
    when = `opens in ${60 - currentMin} min`;
    whenTone = "good";
  } else if (diff >= 1 && diff <= 3) {
    when = `${diff}h past peak`;
  } else if (diff > 3) {
    when = "well past peak";
  } else {
    when = `opens in ${peak.hour - currentHr}h`;
  }
  return (
    <section className="home-rail-card">
      <div className="home-rail-card-title">Peak hour</div>
      <div className="home-rail-stat">
        <span className="home-rail-stat-num">{peak.hour}:00</span>
        <span className="home-rail-stat-unit">avg {peak.avgMinPerActiveDay}m</span>
      </div>
      <div className={`home-rail-hint home-rail-hint-${whenTone}`}>{when}</div>
    </section>
  );
}

/* ── Up next (upcoming-due tasks) — compact rail card ── */
function UpNextCard({ tasks }) {
  const items = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    return (tasks || [])
      .filter((t) => !t.done && t.dueDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5)
      .map((t) => {
        const dueMs = Date.parse(t.dueDate + "T00:00:00") || Date.parse(t.dueDate);
        const days = Number.isFinite(dueMs) ? Math.ceil((dueMs - todayMs) / MS_PER_DAY) : null;
        return { id: t.id, text: t.text, daysUntil: days, priority: t.priority, dueDate: t.dueDate };
      });
  }, [tasks]);

  if (!items.length) {
    return (
      <section className="home-rail-card">
        <div className="home-rail-card-title">Up next</div>
        <p className="home-rail-empty">Nothing due. Add a date in /todo to surface here.</p>
      </section>
    );
  }
  return (
    <section className="home-rail-card">
      <div className="home-rail-card-title">Up next</div>
      <ul className="home-upnext-list">
        {items.map((it) => {
          const overdue = it.daysUntil !== null && it.daysUntil < 0;
          const dueLabel =
            it.daysUntil === null   ? it.dueDate
            : it.daysUntil < 0      ? `${-it.daysUntil}d over`
            : it.daysUntil === 0    ? "today"
            : it.daysUntil === 1    ? "tmrw"
            : `${it.daysUntil}d`;
          const prioLabel =
            it.priority === "high"   ? "high priority"
            : it.priority === "medium" ? "medium priority"
            : it.priority === "low"  ? "low priority"
            : null;
          return (
            <li key={it.id} className={`home-upnext-row${overdue ? " is-overdue" : ""}`}>
              <span className="home-upnext-text">
                {prioLabel && (
                  <span
                    className={`home-prio-dot home-prio-dot-${it.priority}`}
                    title={prioLabel}
                    aria-label={prioLabel}
                  />
                )}
                {it.text}
              </span>
              <span className="home-upnext-due">{dueLabel}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Countdown card — top of rail, gracefully omitted if no deadline. ── */
function CountdownCard({ content }) {
  const daysLeft = dayCountUntil(content.deadlineDate);
  if (daysLeft === null) return null;
  const title = content.title || "submission";
  return (
    <section className="home-rail-card">
      <div className="home-rail-card-title">Deadline</div>
      <div className="home-rail-stat">
        <span className="home-rail-stat-num">{daysLeft}</span>
        <span className="home-rail-stat-unit">{daysLeft === 1 ? "day" : "days"} left</span>
      </div>
      <div className="home-rail-hint">to {title}</div>
    </section>
  );
}

/* ── Header — stable "Today" anchor + the date. Countdown lives in the
   rail's CountdownCard now, so the header can stay calm. */
function HomeHeader() {
  return (
    <header className="home-header">
      <h1 className="home-page-title">Today</h1>
      <div className="home-subhead">{formatDateLong()}</div>
    </header>
  );
}

/* ── Snapshot pill — fixed bottom-right so it doesn't fight the header anchor.
   Stays available, but quiet. ── */
function SnapshotPill({ loadedAtMs }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const loadedMin = Math.floor((now - loadedAtMs) / 60000);
  const rel =
    loadedMin < 1 ? "just now"
    : loadedMin < 60 ? `${loadedMin}m ago`
    : loadedMin < 60 * 24 ? `${Math.floor(loadedMin / 60)}h ago`
    : `${Math.floor(loadedMin / 60 / 24)}d ago`;
  return (
    <div className="home-snapshot home-snapshot-fixed">
      <span className="home-snapshot-label">Loaded {rel}</span>
      <button
        type="button"
        className="home-snapshot-refresh"
        onClick={() => window.location.reload()}
        title="Reload to fetch the latest data"
      >
        ↻ refresh
      </button>
    </div>
  );
}

/* ── Today's Top 3 (editable) ── */
function Top3Editor({ dailyTop3, onSlotChange }) {
  const slots = dailyTop3.slots;
  return (
    <section className="home-section">
      <h2 className="home-section-title">Today's Top 3</h2>
      <ul className="home-top3-list">
        {[0, 1, 2].map((i) => {
          const s = slots[i];
          return (
            <li key={i} className={`home-top3-slot${s.done ? " is-done" : ""}`}>
              <span className="home-top3-num">{i + 1}.</span>
              <input
                type="checkbox"
                className="home-top3-check"
                checked={!!s.done}
                onChange={(e) =>
                  onSlotChange(i, {
                    done: e.target.checked,
                    completedAt: e.target.checked ? new Date().toISOString() : null,
                  })
                }
                aria-label={`Mark Top 3 slot ${i + 1} done`}
              />
              <input
                type="text"
                className="home-top3-input"
                placeholder={
                  i === 0
                    ? "What's your first priority today?"
                    : `Priority ${i + 1}…`
                }
                value={s.text}
                onChange={(e) => onSlotChange(i, { text: e.target.value })}
              />
            </li>
          );
        })}
      </ul>
      <p className="home-top3-footnote">
        Edits sync to today's daily note <code>## Top 3</code> section. Check the box from either side.
      </p>
    </section>
  );
}

/* ── Unfinished from yesterday ── */
function isSlotOpen(s) {
  return s.text && !s.done && !s.dropped && !s.carriedToDate && !s.promoted;
}

function UnfinishedSection({
  history,
  todaysSlots,
  onCarry,
  onDone,
  onPromote,
  onDrop,
}) {
  const yKey = yesterdayKey();
  const yesterdayEntry = history.find((h) => h.date === yKey);
  const yesterdayOpen = useMemo(
    () =>
      yesterdayEntry
        ? yesterdayEntry.slots
            .map((s, i) => ({ ...s, slotIdx: i }))
            .filter(isSlotOpen)
        : [],
    [yesterdayEntry]
  );

  const [showAll, setShowAll] = useState(false);
  const allOpen = useMemo(() => {
    const out = [];
    for (const h of history) {
      if (h.date === yKey) continue; // already in the yesterday section
      for (let i = 0; i < h.slots.length; i++) {
        const s = h.slots[i];
        if (isSlotOpen(s)) out.push({ ...s, slotIdx: i, dayDate: h.date });
      }
    }
    return out;
  }, [history, yKey]);

  // Always render the section — even when empty — so the affordance is
  // discoverable. Empty state lives below.
  const hasEmptySlotToday = todaysSlots.some((s) => !s.text);

  function renderRow(item, dayDate, dayLabel) {
    return (
      <li key={`${dayDate}-${item.slotIdx}`} className="home-unfinished-row">
        <span className="home-unfinished-text">{item.text}</span>
        {dayLabel && <span className="home-unfinished-date">{dayLabel}</span>}
        <span className="home-unfinished-actions">
          <button
            type="button"
            className="home-unf-action"
            disabled={!hasEmptySlotToday}
            onClick={() => onCarry(dayDate, item.slotIdx)}
            title={hasEmptySlotToday ? "Move to today's first empty Top 3 slot" : "All today's slots are filled"}
          >
            carry
          </button>
          <span className="home-unf-sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="home-unf-action"
            onClick={() => onDone(dayDate, item.slotIdx)}
            title="Mark done (app-only; doesn't rewrite yesterday's daily note)"
          >
            done
          </button>
          <span className="home-unf-sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="home-unf-action"
            onClick={() => onPromote(dayDate, item.slotIdx)}
            title="Promote to a regular task in your task list"
          >
            promote
          </button>
          <span className="home-unf-sep" aria-hidden="true">·</span>
          <button
            type="button"
            className="home-unf-action home-unf-action-drop"
            onClick={() => onDrop(dayDate, item.slotIdx)}
            title="Drop — not done, not carried forward"
          >
            drop
          </button>
        </span>
      </li>
    );
  }

  return (
    <section className="home-section">
      <h2 className="home-section-title">
        Unfinished from yesterday
        {yesterdayOpen.length > 0 && (
          <span className="home-section-count"> ({yesterdayOpen.length})</span>
        )}
      </h2>
      {yesterdayOpen.length === 0 ? (
        <p className="home-empty">Nothing from yesterday left open.</p>
      ) : (
        <ul className="home-unfinished-list">
          {yesterdayOpen.map((s) => renderRow(s, yKey, null))}
        </ul>
      )}
      {allOpen.length > 0 && (
        <>
          <button
            type="button"
            className="home-link-btn"
            onClick={() => setShowAll((p) => !p)}
          >
            {showAll ? "Hide" : `View all open intents (${allOpen.length})`}
          </button>
          {showAll && (
            <ul className="home-unfinished-list home-unfinished-list-older">
              {allOpen.map((s) => renderRow(s, s.dayDate, s.dayDate))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ── Page ── */
export default function HomePage() {
  const [content, setContent] = useState(() => cloneContent(DEFAULT_CONTENT));
  const [loaded, setLoaded] = useState(false);
  const [loadedAtMs, setLoadedAtMs] = useState(Date.now());
  const pristineRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent().then((c) => {
      if (!mounted) return;
      pristineRef.current = c;
      setContent(c);
      setLoadedAtMs(Date.now());
      setLoaded(true);
    });
    return () => {
      mounted = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Save: merge incoming patch into pristineRef base, normalize, persist
  // (debounced) and update local state. The pristine merge ensures we don't
  // wipe fields HomePage doesn't track (workSessions, todaysTasks, etc.).
  function patchContent(patch) {
    const next = normalizeContentRecord({
      ...(pristineRef.current || {}),
      ...content,
      ...patch,
    });
    pristineRef.current = next;
    setContent(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistContent(next), 400);
  }

  function updateSlot(idx, partial) {
    const nowIso = new Date().toISOString();
    const slots = content.dailyTop3.slots.map((s, i) =>
      i === idx ? { ...s, ...partial, updatedAt: nowIso } : s
    );
    patchContent({
      dailyTop3: { ...content.dailyTop3, slots, updatedAt: nowIso },
    });
  }

  function updateHistorySlot(dayDate, slotIdx, partial) {
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx ? { ...s, ...partial, updatedAt: new Date().toISOString() } : s
            ),
          }
        : h
    );
    patchContent({ dailyTop3History: history });
  }

  function handleCarry(dayDate, slotIdx) {
    const entry = content.dailyTop3History.find((h) => h.date === dayDate);
    if (!entry) return;
    const fromSlot = entry.slots[slotIdx];
    if (!fromSlot || !fromSlot.text) return;
    const emptyIdx = content.dailyTop3.slots.findIndex((s) => !s.text);
    if (emptyIdx === -1) return;
    const nowIso = new Date().toISOString();
    const todayKeyStr = todayKey();
    // 1) fill today's empty slot
    const slots = content.dailyTop3.slots.map((s, i) =>
      i === emptyIdx
        ? { ...s, text: fromSlot.text, updatedAt: nowIso }
        : s
    );
    // 2) mark history slot as carried to today
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx
                ? { ...s, carriedToDate: todayKeyStr, updatedAt: nowIso }
                : s
            ),
          }
        : h
    );
    patchContent({
      dailyTop3: { ...content.dailyTop3, slots, updatedAt: nowIso },
      dailyTop3History: history,
    });
  }

  function handleDone(dayDate, slotIdx) {
    updateHistorySlot(dayDate, slotIdx, {
      done: true,
      completedAt: new Date().toISOString(),
    });
  }

  function handleDrop(dayDate, slotIdx) {
    updateHistorySlot(dayDate, slotIdx, {
      dropped: true,
      droppedAt: new Date().toISOString(),
    });
  }

  function handlePromote(dayDate, slotIdx) {
    const entry = content.dailyTop3History.find((h) => h.date === dayDate);
    if (!entry) return;
    const slot = entry.slots[slotIdx];
    if (!slot || !slot.text) return;
    // Create a new task in todaysTasks tagged carried-from-top3
    const defaultProjectId =
      (content.projects && content.projects[0] && content.projects[0].id) || "";
    const newTask = createDefaultTask({
      id: newId("task"),
      text: slot.text,
      projectId: defaultProjectId,
      done: false,
      inTodayQueue: true,
      tags: [TOP3_TAG, `from-${dayDate}`],
    });
    const todaysTasks = [...(content.todaysTasks || []), newTask];
    const history = content.dailyTop3History.map((h) =>
      h.date === dayDate
        ? {
            ...h,
            slots: h.slots.map((s, i) =>
              i === slotIdx
                ? {
                    ...s,
                    promoted: true,
                    promotedTaskId: newTask.id,
                    updatedAt: new Date().toISOString(),
                  }
                : s
            ),
          }
        : h
    );
    patchContent({ todaysTasks, dailyTop3History: history });
  }

  if (!loaded) {
    return (
      <main className="home-page">
        <p className="home-empty">Loading…</p>
      </main>
    );
  }

  const heartbeatRows = useHeartbeatRows(content.scheduledTaskHeartbeats);

  return (
    <main className="home-page">
      {/* Banner sits full-width above the grid — only renders on failure. */}
      <ScheduleBanner rows={heartbeatRows} />

      <HomeHeader />

      <div className="home-layout">
        <div className="home-main">
          <Top3Editor dailyTop3={content.dailyTop3} onSlotChange={updateSlot} />

          <UnfinishedSection
            history={content.dailyTop3History}
            todaysSlots={content.dailyTop3.slots}
            onCarry={handleCarry}
            onDone={handleDone}
            onPromote={handlePromote}
            onDrop={handleDrop}
          />
        </div>

        <aside className="home-rail">
          <CountdownCard content={content} />
          <PeakHourCard workSessions={content.workSessions} />
          <UpNextCard tasks={content.todaysTasks} />
          <ScheduleHealthCard rows={heartbeatRows} />
        </aside>
      </div>

      <SnapshotPill loadedAtMs={loadedAtMs} />
    </main>
  );
}
