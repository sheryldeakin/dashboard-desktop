import {
  isTaskOverdue,
  formatDuration,
  formatPriority,
  PRIORITY_LEVELS,
  getTodayKey,
} from "../../utils/taskUtils.js";

export default function InsightsPanel({ tasks, projects, pomodoro, sectionCounts }) {
  const todayKey = getTodayKey();
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const active = total - done;
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Priority breakdown (active tasks only)
  const priorityCounts = {};
  for (const p of PRIORITY_LEVELS) priorityCounts[p] = 0;
  for (const t of tasks) {
    if (!t.done) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
  }

  // Overdue
  const overdueCount = tasks.filter((t) => isTaskOverdue(t, todayKey)).length;

  // Time tracked
  const totalWorkMs = tasks.reduce((s, t) => s + (t.timer.totalWorkMs || 0), 0);

  // Pomodoro stats
  const estPomos = tasks.reduce((s, t) => s + (t.done ? 0 : t.estimatedPomodoros || 0), 0);
  const donePomos = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);

  // Project breakdown
  const projectTaskCounts = {};
  for (const t of tasks) {
    if (!t.done) projectTaskCounts[t.projectId] = (projectTaskCounts[t.projectId] || 0) + 1;
  }
  const projectBreakdown = projects
    .map((p) => ({ ...p, count: projectTaskCounts[p.id] || 0 }))
    .filter((p) => p.count > 0);

  // Upcoming due (next 3 soonest due dates among active tasks)
  const upcomingDue = tasks
    .filter((t) => !t.done && t.dueDate && t.dueDate >= todayKey)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);

  const maxPriorityCount = Math.max(1, ...Object.values(priorityCounts));

  return (
    <div className="tp-insights">
      <div className="tp-insights-title">Insights</div>

      {/* Progress */}
      <div className="tp-insights-card">
        <div className="tp-insights-card-label">Progress</div>
        <div className="tp-insights-progress">
          <div className="tp-insights-progress-bar">
            <div
              className="tp-insights-progress-fill"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <div className="tp-insights-progress-text">
            {done}/{total} done ({completionPct}%)
          </div>
        </div>
      </div>

      {/* Priority Breakdown */}
      <div className="tp-insights-card">
        <div className="tp-insights-card-label">Priority Breakdown</div>
        <div className="tp-insights-priorities">
          {[...PRIORITY_LEVELS].reverse().map((p) => (
            <div key={p} className="tp-insights-priority-row">
              <span className={`tp-insights-priority-label is-${p}`}>{formatPriority(p)}</span>
              <div className="tp-insights-priority-bar">
                <div
                  className={`tp-insights-priority-fill is-${p}`}
                  style={{ width: `${(priorityCounts[p] / maxPriorityCount) * 100}%` }}
                />
              </div>
              <span className="tp-insights-priority-count">{priorityCounts[p]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      <div className="tp-insights-stats">
        <div className={`tp-insights-stat${overdueCount > 0 ? " is-alert" : ""}`}>
          <span className="tp-insights-stat-value">{overdueCount}</span>
          <span className="tp-insights-stat-label">Overdue</span>
        </div>
        <div className="tp-insights-stat">
          <span className="tp-insights-stat-value">{active}</span>
          <span className="tp-insights-stat-label">Active</span>
        </div>
        <div className="tp-insights-stat">
          <span className="tp-insights-stat-value">{formatDuration(totalWorkMs)}</span>
          <span className="tp-insights-stat-label">Time Tracked</span>
        </div>
        <div className="tp-insights-stat">
          <span className="tp-insights-stat-value">{donePomos}/{estPomos || "\u2014"}</span>
          <span className="tp-insights-stat-label">Pomodoros</span>
        </div>
      </div>

      {/* Project Breakdown */}
      {projectBreakdown.length > 0 && (
        <div className="tp-insights-card">
          <div className="tp-insights-card-label">Projects</div>
          <div className="tp-insights-projects">
            {projectBreakdown.map((p) => (
              <div key={p.id} className="tp-insights-project-row">
                <span className="tp-insights-project-dot" style={{ background: p.color }} />
                <span className="tp-insights-project-name">{p.name}</span>
                <span className="tp-insights-project-count">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Due */}
      {upcomingDue.length > 0 && (
        <div className="tp-insights-card">
          <div className="tp-insights-card-label">Upcoming Due</div>
          <ul className="tp-insights-upcoming">
            {upcomingDue.map((t) => (
              <li key={t.id} className="tp-insights-upcoming-item">
                <span className="tp-insights-upcoming-text">{t.text}</span>
                <span className="tp-insights-upcoming-date">{t.dueDate}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
