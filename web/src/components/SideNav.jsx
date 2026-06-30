/* Left sidebar nav. Two groups:
   - Primary: daily-driver routes (Today / Tasks / Focus / Stats / History)
   - System: utility/admin routes, pinned to the bottom of the sidebar
     (Display / Edit / Settings). Matches the convention in Linear/Things/
     Todoist where settings + system surfaces sit at the bottom, separate
     from primary navigation.

   Below 720px the nav becomes a hamburger-triggered slide-in drawer
   (the dominant SaaS mobile pattern). State is owned here:
     - isOpen: boolean
     - Close on Esc, on backdrop click, on link tap, on viewport resize
       past the desktop breakpoint. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import OfflineBadge from "./OfflineBadge.jsx";
import { useContent } from "../contexts/ContentContext.jsx";

/* Stroke-based icon set matching the /home rail icon family
   (1.8px strokes, 16×16 viewBox, currentColor). Each link in the
   nav gets one so the nav can be scanned by shape as well as label. */
const NAV_ICONS = {
  today: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M5.5 2v3M10.5 2v3M2.5 7h11" />
      <circle cx="8" cy="10" r="1.25" fill="currentColor" />
    </svg>
  ),
  tasks: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="4" height="4" rx="0.8" />
      <path d="M3 5.5l1 1 1.5-1.5" />
      <path d="M8.5 5.5h5" />
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.8" />
      <path d="M8.5 11.5h5" />
    </svg>
  ),
  focus: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  stats: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 13.5V10M6 13.5V6M9.5 13.5V8M13 13.5V3.5" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2 2.5v3h3" />
      <path d="M8 5v3.2l2 1.3" />
    </svg>
  ),
  display: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" />
      <path d="M6 14h4M8 11.5V14" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 13.5h3l7-7-3-3-7 7z" />
      <path d="M9.5 3.5l3 3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M2.5 8H.9M15.1 8h-1.6M3.6 3.6L2.5 2.5M13.5 13.5l-1.1-1.1M3.6 12.4L2.5 13.5M13.5 2.5l-1.1 1.1" />
    </svg>
  ),
  chatsLive: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7L5 11V9.5H3.5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
      <path d="M7.5 12.5h5a1 1 0 0 0 1-1v-3" />
      <circle cx="5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="7" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const PRIMARY_LINKS = [
  { href: "/home", label: "Today", icon: NAV_ICONS.today },
  { href: "/todo", label: "Tasks", icon: NAV_ICONS.tasks },
  { href: "/todo?focus=1", label: "Focus", icon: NAV_ICONS.focus },
  { href: "/chats-live", label: "Chats", icon: NAV_ICONS.chatsLive },
  { href: "/stats", label: "Stats", icon: NAV_ICONS.stats },
  { href: "/history", label: "History", icon: NAV_ICONS.history },
];

const SYSTEM_LINKS = [
  { href: "/", label: "Display", icon: NAV_ICONS.display },
  { href: "/settings", label: "Settings", icon: NAV_ICONS.settings },
];

function isActiveLink(href, path, isFocusActive) {
  if (href === "/todo?focus=1") return isFocusActive;
  if (href === "/todo") return path === "/todo" && !isFocusActive;
  return path === href;
}

function NavLink({ href, label, icon, active, onNavigate }) {
  return (
    <RouterLink
      to={href}
      className={active ? "side-nav-link is-active" : "side-nav-link"}
      onClick={onNavigate}
    >
      {icon && <span className="side-nav-link-icon" aria-hidden="true">{icon}</span>}
      <span className="side-nav-link-label">{label}</span>
    </RouterLink>
  );
}

/* Hamburger icon — 3 stroked lines, currentColor so it inherits the
   button's text color. Drawn at 18×18 with 1.8px strokes. */
function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="2.5" y1="5" x2="15.5" y2="5" />
      <line x1="2.5" y1="9" x2="15.5" y2="9" />
      <line x1="2.5" y1="13" x2="15.5" y2="13" />
    </svg>
  );
}

/* Projects panel — route-scoped to /todo. Sits between primary nav and
   system nav with a tinted background + hairline rules, so it feels
   like a contextual filter band rather than a permanent column.
   Reads projects from ContentProvider and the active filter from the
   ?project= URL param so it stays in sync with the page state without
   any cross-component plumbing. */
// Slug helper mirrors sync-todos.py so "PhD" project name lines up with
// the #phd tag it auto-generates. Used to filter out a project's own
// area-tag from its tag drilldown list (Phase D).
function slug(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ProjectsPanel({ onNavigate }) {
  const { content, updateContent } = useContent();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeProjectId = searchParams.get("project") || "all";
  const activeTag = searchParams.get("tag") || "";

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef(null);

  const projects = content.projects || [];

  // Active task counts per project, derived from todaysTasks. Matches the
  // count semantics in the old sidebar (active = not done).
  const countByProject = useMemo(() => {
    const counter = new Map();
    for (const t of content.todaysTasks || []) {
      if (t.done) continue;
      counter.set(t.projectId, (counter.get(t.projectId) || 0) + 1);
    }
    return counter;
  }, [content.todaysTasks]);

  // Phase D: tag drilldown. For the currently-active project, build a
  // sorted list of its task tags (count-desc, then alpha). The project's
  // own area-tag (#<slug>) is filtered out so it doesn't show as a
  // self-link. Empty list when no project is active.
  const activeProjectTags = useMemo(() => {
    if (activeProjectId === "all") return [];
    const project = projects.find((p) => p.id === activeProjectId);
    if (!project) return [];
    const areaSlug = slug(project.name);
    const counter = new Map();
    for (const t of content.todaysTasks || []) {
      if (t.done) continue;
      if (t.projectId !== activeProjectId) continue;
      for (const tag of t.tags || []) {
        if (tag === areaSlug) continue;
        counter.set(tag, (counter.get(tag) || 0) + 1);
      }
    }
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  }, [content.todaysTasks, projects, activeProjectId]);

  function selectTag(tag) {
    const next = new URLSearchParams(searchParams);
    if (activeTag === tag) next.delete("tag");
    else next.set("tag", tag);
    // ?project stays; ?section is already cleared by project selection.
    navigate({ pathname: "/todo", search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
    onNavigate?.();
  }

  function selectProject(projectId) {
    // Click-active-to-deselect: clicking the current filter clears it.
    // Build the next URL preserving any other params (taskId).
    const next = new URLSearchParams(searchParams);
    if (activeProjectId === projectId) {
      next.delete("project");
      next.delete("tag");
    } else {
      next.set("project", projectId);
      // Project filter and section filter are mutually exclusive in
      // useTasks; clear the section so the new selection takes effect.
      // Switching to a different project also clears any leftover tag.
      next.delete("section");
      next.delete("tag");
    }
    navigate({ pathname: "/todo", search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
    onNavigate?.();
  }

  function startAdd() {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }
  function cancelAdd() {
    setAdding(false);
    setDraftName("");
  }
  function commitAdd() {
    const name = draftName.trim();
    if (!name) {
      cancelAdd();
      return;
    }
    const id = `project-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 5)}`;
    const palette = ["#b66e35", "#5b8a5a", "#477f99", "#a0678c", "#a27d3e"];
    updateContent((prev) => {
      const color = palette[(prev.projects || []).length % palette.length];
      return { ...prev, projects: [...(prev.projects || []), { id, name, color }] };
    });
    cancelAdd();
  }

  return (
    <div className="side-nav-projects" aria-label="Projects filter">
      <div className="side-nav-projects-heading">Projects</div>
      <ul className="side-nav-projects-list">
        {projects.map((project) => {
          const active = activeProjectId === project.id;
          const count = countByProject.get(project.id) || 0;
          return (
            <li key={project.id}>
              <button
                type="button"
                className={`side-nav-project${active ? " is-active" : ""}`}
                onClick={() => selectProject(project.id)}
                aria-pressed={active}
                title={active ? `Clear ${project.name} filter` : `Filter by ${project.name}`}
              >
                <span
                  className="side-nav-project-dot"
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                />
                <span className="side-nav-project-name">{project.name}</span>
                {count > 0 && <span className="side-nav-project-count">{count}</span>}
              </button>
              {/* Phase D: tag drilldown rows. Only the active project's
                  tags are shown, indented under the row with a hairline
                  guide on the left so the parent-child relationship is
                  visual. Counts mirror the project row pattern. */}
              {active && activeProjectTags.length > 0 && (
                <ul className="side-nav-project-tags">
                  {activeProjectTags.map(({ tag, count }) => {
                    const tagActive = activeTag === tag;
                    return (
                      <li key={tag}>
                        <button
                          type="button"
                          className={`side-nav-project-tag${tagActive ? " is-active" : ""}`}
                          onClick={() => selectTag(tag)}
                          aria-pressed={tagActive}
                          title={tagActive ? `Clear #${tag} filter` : `Filter by #${tag}`}
                        >
                          <span className="side-nav-project-tag-name">#{tag}</span>
                          <span className="side-nav-project-tag-count">{count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        <li>
          {adding ? (
            <input
              ref={inputRef}
              type="text"
              className="side-nav-project-add-input"
              placeholder="New project…"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
                else if (e.key === "Escape") { e.preventDefault(); cancelAdd(); }
              }}
              onBlur={commitAdd}
            />
          ) : (
            <button
              type="button"
              className="side-nav-project-add"
              onClick={startAdd}
              aria-label="Add project"
            >
              <span className="side-nav-project-add-icon" aria-hidden="true">+</span>
              <span className="side-nav-project-add-label">Add project</span>
            </button>
          )}
        </li>
      </ul>
    </div>
  );
}

/* Close (X) icon for the drawer header in mobile mode. */
function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

export default function SideNav() {
  const location = useLocation();
  const path = location.pathname;
  const isFocusActive =
    path === "/todo" && location.search.includes("focus=1");

  const [isOpen, setIsOpen] = useState(false);

  // Close on Escape key — accessibility convention for dismissible overlays.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Close when crossing into desktop layout (drawer no longer needed).
  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 720 && isOpen) setIsOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen]);

  // Lock body scroll while the drawer is open so the page behind
  // doesn't scroll under the user's finger on touch devices.
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
  }

  // Link clicks navigate normally; we just close the drawer so the
  // user lands on the new route with a clean view.
  function handleNavigate() {
    setIsOpen(false);
  }

  return (
    <>
      {/* Hamburger trigger — only visible at the mobile breakpoint.
          Lives outside the <aside> so the drawer can slide independently. */}
      <button
        type="button"
        className="side-nav-trigger"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation"
        aria-expanded={isOpen}
        aria-controls="side-nav"
      >
        <HamburgerIcon />
      </button>

      {/* Backdrop — only rendered when drawer is open. Click closes. */}
      {isOpen && (
        <div
          className="side-nav-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <aside
        id="side-nav"
        className={`side-nav${isOpen ? " is-open" : ""}`}
        aria-label="Main navigation"
      >
        {/* Drawer header — only visible in mobile mode. Shows brand + close. */}
        <div className="side-nav-drawer-header">
          <span className="side-nav-brand-mobile">Dashboard</span>
          <button
            type="button"
            className="side-nav-close"
            onClick={closeDrawer}
            aria-label="Close navigation"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="side-nav-brand">Dashboard</div>

        <nav className="side-nav-links side-nav-links-primary">
          {PRIMARY_LINKS.map(({ href, label, icon }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        {/* Projects band — only when on /todo. Sits between the daily-driver
            links and the system links, with a tinted background to read as
            a contextual filter rather than additional nav. */}
        {path === "/todo" && <ProjectsPanel onNavigate={handleNavigate} />}

        <nav className="side-nav-links side-nav-links-system">
          {SYSTEM_LINKS.map(({ href, label, icon }) => (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={isActiveLink(href, path, isFocusActive)}
              onNavigate={handleNavigate}
            />
          ))}
        </nav>

        {/* Offline badge — renders nothing when online. Pinned below the
            system links so it doesn't push primary nav around. */}
        <OfflineBadge className="side-nav-offline" />
      </aside>
    </>
  );
}
