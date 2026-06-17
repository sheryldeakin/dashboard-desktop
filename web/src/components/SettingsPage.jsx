/* SettingsPage — single config surface, consolidates the old
   /admin + /settings into one page. Layout follows the rest of the
   app: app-shell + SideNav (caller wraps), unified outer container,
   PageHeader + Section components.

   Sections:
     - Dashboard config: title, dates, phase
     - Projects: list with drag-reorder, edit name + color, default
       new-task project picker, add / remove
     - Pomodoro: focus / short break / long break minutes,
       cycles before long break, auto-start toggles
     - Display preferences: placeholder section for future dark mode /
       time format / etc.

   Save behavior: single "Save changes" button at the bottom. All
   pending edits are batched into one PUT. Reset button discards
   pending edits and reverts to the loaded snapshot. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TITLE,
  START_ISO,
  DEADLINE_ISO,
  DEFAULT_PROJECT,
  DEFAULT_CONTENT,
  cloneContent,
  normalizeContentRecord,
} from "../utils/taskUtils.js";
import { useContent } from "../contexts/ContentContext.jsx";
import PageHeader from "./PageHeader.jsx";
import Section from "./Section.jsx";
import Collapsible from "./Collapsible.jsx";
import EmptyState from "./EmptyState.jsx";
import Chip from "./Chip.jsx";
import Dot from "./Dot.jsx";
import { softenColor } from "./WeekRecap.jsx";

/* The only fields any section on this page can edit. Used by isDirty so
   the comparison doesn't have to stringify workSessions/taskHistory/etc.
   Keep this in sync with the form controls below — if a new field is
   added to a section, list it here. */
function pickEditableFields(c) {
  return {
    title: c.title,
    phase: c.phase,
    startDate: c.startDate,
    deadlineDate: c.deadlineDate,
    projects: c.projects,
    defaultNewTaskProjectId: c.defaultNewTaskProjectId,
    pomodoroSettings: c.pomodoro?.settings,
  };
}

/* Inline SVG grip handle — used as the drag affordance on project
   rows. 6 dots in a 2×3 grid, sized to read as "drag here" without
   competing with the row's content. */
const GRIP_ICON = (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="2" cy="3" r="1.2" />
    <circle cx="8" cy="3" r="1.2" />
    <circle cx="2" cy="7" r="1.2" />
    <circle cx="8" cy="7" r="1.2" />
    <circle cx="2" cy="11" r="1.2" />
    <circle cx="8" cy="11" r="1.2" />
  </svg>
);

export default function SettingsPage() {
  // Content from ContentProvider — single source of truth shared across
  // pages. updateContent persists + propagates the save app-wide.
  const { content, updateContent, loaded } = useContent();
  // Snapshot baseline for reset. Captured from context when content first
  // becomes ready, then refreshed on each successful save.
  const [snapshot, setSnapshot] = useState(() => cloneContent(content));
  // Working edits — independent draft until Save flushes them.
  const [draft, setDraft] = useState(() => cloneContent(content));
  const [status, setStatus] = useState({ phase: "idle", message: "" });
  const initializedRef = useRef(false);

  // Hydrate snapshot + draft once ContentProvider's initial load resolves.
  // Runs exactly once per mount; subsequent context updates from other
  // pages don't blow away the user's pending edits.
  useEffect(() => {
    if (!loaded || initializedRef.current) return;
    setSnapshot(cloneContent(content));
    setDraft(cloneContent(content));
    initializedRef.current = true;
  }, [loaded, content]);

  // Generic field setter — patches the draft. All form controls go
  // through this so save/reset/dirty-check is unified.
  function setDraftField(patch) {
    setDraft((d) => ({ ...d, ...patch }));
  }

  // Dirty check stringifies ONLY the editable surface, not the full content
  // document. Stringifying the whole content (workSessions, taskHistory,
  // pomodoroHistory — easily 500KB+) on every keystroke was burning frames
  // while typing in any field. /settings only edits a handful of fields, so
  // we just compare those.
  const isDirty = useMemo(() => {
    const editableSnap = pickEditableFields(snapshot);
    const editableDraft = pickEditableFields(draft);
    return JSON.stringify(editableSnap) !== JSON.stringify(editableDraft);
  }, [snapshot, draft]);

  function handleSave() {
    setStatus({ phase: "saving", message: "Saving…" });
    try {
      const normalized = normalizeContentRecord(draft);
      // Backend now merges projects union-by-id (stale-snapshot defence),
      // so a removed project in `draft.projects` is invisible to the merge
      // and won't delete. Explicit deletes go through `projectDeletes`,
      // which backend applies last. Diff against the snapshot to find them.
      const removedProjectIds = (snapshot?.projects || [])
        .map((p) => p.id)
        .filter((id) => id && !(normalized.projects || []).some((p) => p.id === id));
      const payload = removedProjectIds.length
        ? { ...normalized, projectDeletes: removedProjectIds }
        : normalized;
      // updateContent propagates the save through ContentProvider so /home,
      // /todo, /stats etc all see the new projects/dates/pomodoro settings
      // without a page reload. The projectDeletes field is a one-shot
      // directive — backend reads it, applies it, then normalize drops it
      // on the next read.
      updateContent(() => payload);
      setSnapshot(normalized);
      setDraft(cloneContent(normalized));
      setStatus({ phase: "saved", message: "Saved" });
      setTimeout(() => setStatus({ phase: "idle", message: "" }), 2500);
    } catch (e) {
      console.error("Settings save failed:", e);
      setStatus({ phase: "error", message: "Save failed" });
      setTimeout(() => setStatus({ phase: "idle", message: "" }), 5000);
    }
  }

  function handleReset() {
    setDraft(cloneContent(snapshot));
    setStatus({ phase: "idle", message: "" });
  }

  if (!loaded) {
    return (
      <main className="settings-page">
        <PageHeader title="Settings" />
        <p className="settings-loading">Loading…</p>
      </main>
    );
  }

  const projectCount = (draft.projects || []).length;
  const focusMin = draft.pomodoro?.settings?.focusMinutes ?? 25;
  const headerChips = [
    <Chip key="projects">
      <strong>{projectCount}</strong> {projectCount === 1 ? "project" : "projects"}
    </Chip>,
    <Chip key="focus">
      <strong>{focusMin}</strong>-min focus default
    </Chip>,
  ];

  return (
    <main className="settings-page">
      <PageHeader
        title="Settings"
        chips={headerChips}
        actions={
          <div className="settings-actions">
            {status.phase !== "idle" && (
              <span className={`settings-status is-${status.phase}`}>{status.message}</span>
            )}
            {isDirty && (
              <button
                type="button"
                className="settings-btn"
                onClick={handleReset}
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="settings-btn is-primary"
              onClick={handleSave}
              disabled={!isDirty || status.phase === "saving"}
            >
              Save changes
            </button>
          </div>
        }
      />

      <DashboardConfigSection draft={draft} setDraftField={setDraftField} />

      <ProjectsSection draft={draft} setDraftField={setDraftField} />

      <PomodoroSection draft={draft} setDraftField={setDraftField} />

      <DisplayPreferencesSection />
    </main>
  );
}

/* ── Dashboard config ─────────────────────────────────────────────── */
function DashboardConfigSection({ draft, setDraftField }) {
  return (
    <Section title="Dashboard">
      <div className="settings-field-grid">
        <label className="settings-field">
          <span className="settings-label">Title</span>
          <input
            type="text"
            className="settings-input"
            value={draft.title || ""}
            onChange={(e) => setDraftField({ title: e.target.value })}
            placeholder={TITLE}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Phase</span>
          <input
            type="text"
            className="settings-input"
            value={draft.phase || ""}
            onChange={(e) => setDraftField({ phase: e.target.value })}
            placeholder={DEFAULT_CONTENT.phase}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Start date</span>
          <input
            type="datetime-local"
            className="settings-input"
            value={(draft.startDate || START_ISO).slice(0, 16)}
            onChange={(e) => setDraftField({
              startDate: e.target.value ? `${e.target.value}:00` : START_ISO,
            })}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Deadline</span>
          <input
            type="datetime-local"
            className="settings-input"
            value={(draft.deadlineDate || DEADLINE_ISO).slice(0, 16)}
            onChange={(e) => setDraftField({
              deadlineDate: e.target.value ? `${e.target.value}:00` : DEADLINE_ISO,
            })}
          />
        </label>
      </div>
    </Section>
  );
}

/* ── Projects (with drag-reorder + default picker) ────────────────── */
function ProjectsSection({ draft, setDraftField }) {
  const projects = draft.projects || [];
  const [newName, setNewName] = useState("");
  const dragIdxRef = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function updateProject(i, patch) {
    setDraftField({
      projects: projects.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    });
  }

  function removeProject(i) {
    const removedId = projects[i]?.id;
    setDraftField({
      projects: projects.filter((_, idx) => idx !== i),
      // If the default-new-task project was the one we're removing,
      // reset to "" (which falls back to projects[0]).
      defaultNewTaskProjectId:
        draft.defaultNewTaskProjectId === removedId ? "" : draft.defaultNewTaskProjectId,
    });
  }

  function addProject() {
    const name = newName.trim();
    if (!name) return;
    const id = `proj_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)}_${Math.random().toString(36).slice(2, 6)}`;
    const palette = [
      "#5a7e5f", "#8a6940", "#4a5a70", "#c45c4a",
      "#7a5b9c", "#5c8aa8", "#8aa05c", "#9c6a8a", "#a05c5c",
    ];
    // Pick the first palette color not already used by another project.
    const used = new Set(projects.map((p) => (p.color || "").toLowerCase()));
    const color = palette.find((c) => !used.has(c.toLowerCase())) || palette[projects.length % palette.length];
    setDraftField({ projects: [...projects, { id, name, color }] });
    setNewName("");
  }

  function handleDragStart(e, idx) {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  }

  function handleDragLeave() {
    setDragOverIdx(null);
  }

  function handleDrop(e, idx) {
    e.preventDefault();
    const from = dragIdxRef.current;
    dragIdxRef.current = null;
    setDragOverIdx(null);
    if (from === null || from === idx) return;
    const next = [...projects];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    setDraftField({ projects: next });
  }

  return (
    <Section title="Projects">
      <p className="settings-help">
        Drag rows to reorder. The first project is the implicit default
        for new tasks unless you pick a specific default below.
      </p>

      <ul className="settings-project-list">
        {projects.map((p, i) => {
          const isDefault = p.id === DEFAULT_PROJECT.id;
          return (
            <li
              key={p.id}
              className={`settings-project-row${dragOverIdx === i ? " is-drag-over" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, i)}
            >
              <span className="settings-drag-handle" aria-hidden="true" title="Drag to reorder">
                {GRIP_ICON}
              </span>
              {/* Dot doubles as the click target for the native color
                  picker — the <input type="color"> is visually hidden but
                  positioned over the dot so the system swatch opens on
                  click. Soften the rendered fill so it matches the bar
                  segments on /home and /stats (raw stored color is kept
                  in state, softened only at render time). */}
              <label className="settings-color-swatch" title={`Color: ${p.color || ""}`}>
                <Dot
                  color={softenColor(p.color || "rgba(0,0,0,0.25)", 0.45)}
                  size={14}
                />
                <input
                  type="color"
                  className="settings-color-input"
                  value={p.color || "#b66e35"}
                  onChange={(e) => updateProject(i, { color: e.target.value })}
                  aria-label={`Color for ${p.name}`}
                />
              </label>
              <input
                type="text"
                className="settings-input settings-project-name"
                value={p.name || ""}
                onChange={(e) => updateProject(i, { name: e.target.value })}
                placeholder="Project name"
              />
              <button
                type="button"
                className="settings-remove-btn"
                onClick={() => removeProject(i)}
                disabled={isDefault}
                title={isDefault ? "Inbox can't be removed" : "Remove project"}
                aria-label={`Remove ${p.name}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <div className="settings-add-row">
        <input
          type="text"
          className="settings-input settings-add-input"
          placeholder="New project name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addProject();
            }
          }}
        />
        <button type="button" className="settings-btn" onClick={addProject}>
          Add project
        </button>
      </div>

      {/* Default new-task project — picker for which project new tasks
          (Top 3 promote, /todo quick-add) default to. Empty = fall back
          to projects[0]. Solves the "everything → Inbox" attribution
          issue without forcing a reorder. */}
      <label className="settings-field settings-default-project">
        <span className="settings-label">Default project for new tasks</span>
        <select
          className="settings-select"
          value={draft.defaultNewTaskProjectId || ""}
          onChange={(e) => setDraftField({ defaultNewTaskProjectId: e.target.value })}
        >
          <option value="">— first in list ({projects[0]?.name || "—"})</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="settings-help-inline">
          Used when a slot or quick-add doesn't specify a project explicitly.
        </span>
      </label>
    </Section>
  );
}

/* ── Pomodoro ──────────────────────────────────────────────────────── */
function PomodoroSection({ draft, setDraftField }) {
  const settings = draft.pomodoro?.settings || {};
  function updateSetting(key, value) {
    setDraftField({
      pomodoro: {
        ...draft.pomodoro,
        settings: { ...settings, [key]: value },
      },
    });
  }
  return (
    <Section title="Pomodoro">
      <p className="settings-help">
        Defaults for the in-app pomodoro timer. Auto-start means the next
        phase begins as soon as the previous one ends (classic continuous
        flow); turn off to be prompted between each phase.
      </p>
      <div className="settings-field-grid">
        <label className="settings-field">
          <span className="settings-label">Focus (min)</span>
          <input
            type="number"
            className="settings-input"
            min={5}
            max={180}
            value={settings.focusMinutes ?? 25}
            onChange={(e) => updateSetting("focusMinutes", Math.max(5, Math.min(180, Number(e.target.value) || 25)))}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Short break (min)</span>
          <input
            type="number"
            className="settings-input"
            min={1}
            max={60}
            value={settings.shortBreakMinutes ?? 5}
            onChange={(e) => updateSetting("shortBreakMinutes", Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Long break (min)</span>
          <input
            type="number"
            className="settings-input"
            min={1}
            max={90}
            value={settings.longBreakMinutes ?? 15}
            onChange={(e) => updateSetting("longBreakMinutes", Math.max(1, Math.min(90, Number(e.target.value) || 15)))}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Cycles before long break</span>
          <input
            type="number"
            className="settings-input"
            min={1}
            max={12}
            value={settings.cyclesBeforeLongBreak ?? 4}
            onChange={(e) => updateSetting("cyclesBeforeLongBreak", Math.max(1, Math.min(12, Number(e.target.value) || 4)))}
          />
        </label>
      </div>
      <ul className="settings-toggle-list">
        <li className="settings-toggle-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings.autoStartBreak)}
              onChange={(e) => updateSetting("autoStartBreak", e.target.checked)}
            />
            <span>Auto-start break when focus ends</span>
          </label>
        </li>
        <li className="settings-toggle-row">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(settings.autoStartFocus)}
              onChange={(e) => updateSetting("autoStartFocus", e.target.checked)}
            />
            <span>Auto-start focus when break ends</span>
          </label>
        </li>
      </ul>
    </Section>
  );
}

/* ── Display preferences (placeholder for future toggles) ─────────── */
function DisplayPreferencesSection() {
  return (
    <Section title="Display preferences">
      <EmptyState
        variant="inline"
        message="No display preferences yet."
        hint="Dark mode, time format (12h/24h), and date format will live here."
      />
    </Section>
  );
}
