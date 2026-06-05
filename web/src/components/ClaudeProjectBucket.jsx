/* ClaudeProjectBucket — collapsible card showing one project's Claude
   sessions for some time window, with a completions list and a session
   list inside. Originally inline in HistoryPage; extracted here when
   /stats Today tab + /home main column needed the same grouped-by-
   project drill-down for today's sessions.

   Component takes a pre-built `bucket` (projectId, sessions, totals,
   completions) so callers can decide how to group (by date+project on
   /history, by project-only on /home/today). For the latter case the
   buildClaudeBuckets helper below covers the whole "filter + group"
   pipeline.

   Props:
     bucket          { projectId, sessions, totalMs, totalMsg, completions, projectName?, projectColor? }
     projectName     override (falls back to bucket.projectName or "Unassigned")
     projectColor    override (falls back to bucket.projectColor or null)
     defaultOpen     pass-through to Collapsible (default false)
*/

import Collapsible from "./Collapsible.jsx";
import Dot from "./Dot.jsx";
import Tooltip from "./Tooltip.jsx";
import RelativeTime from "./RelativeTime.jsx";

const MS_PER_MIN = 60 * 1000;

function fmtHrMin(ms) {
  const min = Math.floor(ms / MS_PER_MIN);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function ClaudeProjectBucket({
  bucket,
  projectName,
  projectColor,
  defaultOpen = false,
}) {
  const name = projectName ?? bucket.projectName ?? "Unassigned";
  const color = projectColor ?? bucket.projectColor ?? null;
  const sessionCount = bucket.sessions.length;
  const completionCount = bucket.completions.length;

  const summary = (
    <>
      <Dot color={color || "rgba(0,0,0,0.25)"} size={8} />
      <span className="history-claude-bucket-name">{name}</span>
      <span className="history-claude-bucket-meta">
        <span className="history-claude-bucket-stat">
          <strong>{sessionCount}</strong>
          {sessionCount === 1 ? " session" : " sessions"}
        </span>
        <span className="history-claude-bucket-sep" aria-hidden="true">·</span>
        <Tooltip content={`${bucket.totalMsg} message${bucket.totalMsg === 1 ? "" : "s"}`}>
          <span className="history-claude-bucket-stat">
            <strong>{fmtHrMin(bucket.totalMs)}</strong>
          </span>
        </Tooltip>
        {completionCount > 0 && (
          <>
            <span className="history-claude-bucket-sep" aria-hidden="true">·</span>
            <span className="history-claude-bucket-completed">
              ✓ <strong>{completionCount}</strong>
              {completionCount === 1 ? " completed" : " completed"}
            </span>
          </>
        )}
      </span>
    </>
  );

  return (
    <Collapsible
      summary={summary}
      defaultOpen={defaultOpen}
      className="history-claude-bucket"
      summaryClassName="history-claude-bucket-summary"
    >
      <div className="history-claude-bucket-body">
        {completionCount > 0 && (
          <div className="history-claude-bucket-section">
            <div className="history-claude-bucket-section-label">
              Tasks completed
            </div>
            <ul className="history-claude-completions-list">
              {bucket.completions.map((t, i) => (
                <li key={i} className="history-claude-completion">
                  <span className="history-claude-completion-check" aria-hidden="true">✓</span>
                  <span className="history-claude-completion-subject">{t.subject}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="history-claude-bucket-section">
          <div className="history-claude-bucket-section-label">
            Sessions
          </div>
          <ul className="history-claude-session-list">
            {bucket.sessions.map((s) => {
              const startedMs = new Date(s.startedAt).getTime();
              const aiSummary = (s.aiSummary || "").trim();
              return (
                <li key={s.id} className="history-claude-session-item">
                  <Tooltip content={`${s.messageCount || 0} message${s.messageCount === 1 ? "" : "s"}`}>
                    <span className="history-claude-session-msgs">
                      {s.messageCount || 0} msg
                    </span>
                  </Tooltip>
                  <span className="history-claude-session-duration">
                    {fmtHrMin(s.activeMs || 0)}
                  </span>
                  <span className="history-claude-session-summary">
                    {aiSummary}
                  </span>
                  <Tooltip content={new Date(s.startedAt).toLocaleString()}>
                    <span className="history-claude-session-when">
                      <RelativeTime since={startedMs} />
                    </span>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Collapsible>
  );
}

/* buildClaudeBuckets(workSessions, projects, { since?, until? })
   Filter+group helper for callers that want claude_code sessions grouped
   by project for some window. Returns an array of bucket objects ready
   to feed straight into <ClaudeProjectBucket>. Sorted by total active
   ms desc. Pass `since`/`until` as ms timestamps to clip the window
   (typically: today's local midnight → tomorrow's local midnight). */
export function buildClaudeBuckets(
  workSessions,
  projects,
  { since = null, until = null } = {}
) {
  const projectsById = new Map((projects || []).map((p) => [p.id, p]));
  const claude = (workSessions || [])
    .filter((s) => s.source === "claude_code")
    .filter((s) => {
      if (since === null && until === null) return true;
      const t = new Date(s.startedAt).getTime();
      if (!Number.isFinite(t)) return false;
      if (since !== null && t < since) return false;
      if (until !== null && t >= until) return false;
      return true;
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const byProject = new Map();
  for (const s of claude) {
    const pid = s.projectId || "";
    if (!byProject.has(pid)) {
      byProject.set(pid, {
        projectId: pid,
        sessions: [],
        totalMs: 0,
        totalMsg: 0,
        completions: [],
      });
    }
    const bucket = byProject.get(pid);
    bucket.sessions.push(s);
    bucket.totalMs += s.activeMs || 0;
    bucket.totalMsg += s.messageCount || 0;
    if (Array.isArray(s.completedTasks)) {
      for (const t of s.completedTasks) bucket.completions.push(t);
    }
  }

  // Sort buckets by total ms desc and attach project name+color from
  // the project list. Completions inside each bucket sorted newest-first.
  return [...byProject.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((bucket) => {
      bucket.completions.sort((a, b) =>
        (b.completedAt || "").localeCompare(a.completedAt || "")
      );
      const p = projectsById.get(bucket.projectId);
      return {
        ...bucket,
        projectName: p?.name || "Unassigned",
        projectColor: p?.color || null,
      };
    });
}
