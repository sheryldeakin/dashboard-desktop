import { TODO_SIDEBAR_SECTIONS } from "../../utils/taskUtils.js";

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  activeSectionId,
  sectionCounts,
  onSelectSection,
  projects,
  defaultProjectId,
  filterProjectId,
  onSelectProject,
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
            {projects.map((project) => (
              <li
                key={project.id}
                className={`tp-project-item${dragOverProjectId === project.id ? " is-drop-target" : ""}`}
                onDragOver={(e) => onProjectDragOver(e, project.id)}
                onDrop={(e) => onProjectDrop(e, project.id)}
              >
                <button
                  type="button"
                  className={`tp-project-btn${filterProjectId === project.id ? " is-active" : ""}`}
                  onClick={() => onSelectProject(project.id)}
                >
                  <span className="tp-project-dot" style={{ backgroundColor: project.color }} />
                  <span className="tp-project-name">{project.name}</span>
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
              </li>
            ))}
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
