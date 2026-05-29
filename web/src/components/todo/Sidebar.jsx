import { useMemo, useState } from "react";
import { TODO_SIDEBAR_SECTIONS } from "../../utils/taskUtils.js";

// Slug helper mirrors the one in sync-todos.py so "PhD" project name lines up
// with the `#phd` tag it auto-generates.
function slug(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  activeSectionId,
  sectionCounts,
  onSelectSection,
  projects,
  defaultProjectId,
  filterProjectId,
  filterTag,
  onSelectProject,
  onSelectFileTag,
  tasks,
  newProjectName,
  onNewProjectNameChange,
  onAddProject,
  onRemoveProject,
  dragOverSectionId,
  onSectionDragOver,
  onSectionDrop,
  dragOverProjectId,
  onProjectDragOver,
  onProjectDrop,
}) {
  const sectionIcons = {
    today: "☀",
    inbox: "✉",
    planned: "📅",
    recurring: "↻",
    overdue: "⚠",
    done: "✓",
    all: "≡",
  };

  // Build per-project sub-items from each task's tags. The project's own slug
  // (matching the area tag the sync script generates, e.g. Research → #research)
  // is excluded so it doesn't duplicate. Sorted by count desc, then alpha.
  // Auto-discovered: any new file/folder in the vault adds itself here on the
  // next sync — no UI edits needed.
  const subItemsByProject = useMemo(() => {
    const result = {};
    for (const proj of projects) {
      const areaSlug = slug(proj.name);
      const projTasks = tasks.filter((t) => !t.done && t.projectId === proj.id);
      const counter = new Map();
      for (const task of projTasks) {
        for (const tag of task.tags || []) {
          if (tag === areaSlug) continue;
          counter.set(tag, (counter.get(tag) || 0) + 1);
        }
      }
      result[proj.id] = [...counter.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([tag, count]) => ({ tag, count }));
    }
    return result;
  }, [tasks, projects]);

  // Default: any project that has sub-items AND is the currently-filtered
  // project starts expanded; everything else collapsed. User can toggle.
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  function toggleExpand(projectId) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }
  const isExpanded = (projectId) =>
    expandedProjects.has(projectId) || filterProjectId === projectId;

  const totalProjectCount = (projectId) =>
    tasks.filter((t) => !t.done && t.projectId === projectId).length;

  return (
    <aside className={`tp-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="tp-sidebar-toggle"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? "›" : "‹"}
      </button>

      <nav className="tp-sidebar-sections">
        <div className="tp-sidebar-heading">{!collapsed && "Sections"}</div>
        <ul className="tp-section-list">
          {TODO_SIDEBAR_SECTIONS.map((section) => (
            <li
              key={section.id}
              className={`tp-section-item${dragOverSectionId === section.id ? " is-drop-target" : ""}`}
              onDragOver={(e) => onSectionDragOver(e, section.id)}
              onDrop={(e) => onSectionDrop(e, section.id)}
            >
              <button
                type="button"
                className={`tp-section-btn${activeSectionId === section.id ? " is-active" : ""}`}
                onClick={() => onSelectSection(section.id)}
                title={collapsed ? section.label : undefined}
              >
                <span className="tp-section-icon">{sectionIcons[section.id]}</span>
                {!collapsed && (
                  <>
                    <span className="tp-section-name">{section.label}</span>
                    <span className="tp-section-count">{sectionCounts[section.id] || 0}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {!collapsed && (
        <div className="tp-sidebar-projects">
          <div className="tp-sidebar-heading">Projects</div>
          <ul className="tp-project-list">
            {projects.map((project) => {
              const subItems = subItemsByProject[project.id] || [];
              const expanded = isExpanded(project.id);
              const projActive =
                filterProjectId === project.id && !filterTag;
              return (
                <li
                  key={project.id}
                  className={`tp-project-item${dragOverProjectId === project.id ? " is-drop-target" : ""}`}
                  onDragOver={(e) => onProjectDragOver(e, project.id)}
                  onDrop={(e) => onProjectDrop(e, project.id)}
                >
                  <div className="tp-project-row">
                    {subItems.length > 0 ? (
                      <button
                        type="button"
                        className={`tp-project-expand${expanded ? " is-open" : ""}`}
                        onClick={() => toggleExpand(project.id)}
                        aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
                        aria-expanded={expanded}
                      >
                        ▸
                      </button>
                    ) : (
                      <span className="tp-project-expand tp-project-expand-spacer" aria-hidden="true" />
                    )}
                    <button
                      type="button"
                      className={`tp-project-btn${projActive ? " is-active" : ""}`}
                      onClick={() => onSelectProject(project.id)}
                    >
                      <span className="tp-project-dot" style={{ backgroundColor: project.color }} />
                      <span className="tp-project-name">{project.name}</span>
                      <span className="tp-project-count">{totalProjectCount(project.id)}</span>
                    </button>
                    {project.id !== defaultProjectId && (
                      <button
                        type="button"
                        className="tp-project-remove"
                        onClick={() => onRemoveProject(project.id)}
                        aria-label={`Remove ${project.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {expanded && subItems.length > 0 && (
                    <ul className="tp-project-subitems">
                      {subItems.map(({ tag, count }) => {
                        const tagActive =
                          filterProjectId === project.id && filterTag === tag;
                        return (
                          <li key={tag} className="tp-subitem">
                            <button
                              type="button"
                              className={`tp-subitem-btn${tagActive ? " is-active" : ""}`}
                              onClick={() => onSelectFileTag(project.id, tag)}
                              title={`#${tag}`}
                            >
                              <span className="tp-subitem-name">#{tag}</span>
                              <span className="tp-subitem-count">{count}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="tp-project-add">
            <input
              type="text"
              className="tp-input tp-input-sm"
              placeholder="New project…"
              value={newProjectName}
              onChange={(e) => onNewProjectNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddProject();
                }
              }}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
