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

/* ── Header ── */
function HomeHeader({ content }) {
  const today = formatDateLong();
  const daysLeft = dayCountUntil(content.deadlineDate);
  const title = content.title || "submission";
  return (
    <header className="home-header">
      <div className="home-date">{today}</div>
      {daysLeft !== null && (
        <div className="home-countdown">
          {title} in <strong>{daysLeft}</strong> {daysLeft === 1 ? "day" : "days"}
        </div>
      )}
    </header>
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

  if (!yesterdayOpen.length && !allOpen.length) return null;

  const hasEmptySlotToday = todaysSlots.some((s) => !s.text);

  function renderRow(item, dayDate, dayLabel) {
    return (
      <li key={`${dayDate}-${item.slotIdx}`} className="home-unfinished-row">
        <span className="home-unfinished-text">{item.text}</span>
        {dayLabel && <span className="home-unfinished-date">{dayLabel}</span>}
        <div className="home-unfinished-actions">
          <button
            type="button"
            className="home-unf-btn"
            disabled={!hasEmptySlotToday}
            onClick={() => onCarry(dayDate, item.slotIdx)}
            title={hasEmptySlotToday ? "Move to today's first empty Top 3 slot" : "All today's slots are filled"}
          >
            Carry
          </button>
          <button
            type="button"
            className="home-unf-btn"
            onClick={() => onDone(dayDate, item.slotIdx)}
            title="Mark done (app-only; doesn't rewrite yesterday's daily note)"
          >
            Done
          </button>
          <button
            type="button"
            className="home-unf-btn"
            onClick={() => onPromote(dayDate, item.slotIdx)}
            title="Promote to a regular task in your task list"
          >
            Promote
          </button>
          <button
            type="button"
            className="home-unf-btn home-unf-btn-drop"
            onClick={() => onDrop(dayDate, item.slotIdx)}
            title="Drop — not done, not carried forward"
          >
            Drop
          </button>
        </div>
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
  const pristineRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadAndHydratePreferredContent().then((c) => {
      if (!mounted) return;
      pristineRef.current = c;
      setContent(c);
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

  return (
    <main className="home-page">
      <HomeHeader content={content} />

      <Top3Editor dailyTop3={content.dailyTop3} onSlotChange={updateSlot} />

      <UnfinishedSection
        history={content.dailyTop3History}
        todaysSlots={content.dailyTop3.slots}
        onCarry={handleCarry}
        onDone={handleDone}
        onPromote={handlePromote}
        onDrop={handleDrop}
      />

      <p className="home-footnote">
        More sections (peak-hour pattern, resume / start, up next) coming soon.
      </p>
    </main>
  );
}
