import { isTaskOverdue } from "../../utils/taskUtils.js";

export default function SummaryBar({ tasks }) {
  const active = tasks.filter((t) => !t.done).length;
  const done = tasks.filter((t) => t.done).length;
  const overdue = tasks.filter((t) => isTaskOverdue(t)).length;

  const estPomos = tasks.reduce((s, t) => s + (t.done ? 0 : t.estimatedPomodoros || 0), 0);
  const donePomos = tasks.reduce((s, t) => s + (t.completedPomodoros || 0), 0);

  return (
    <div className="tp-summary">
      <div className="tp-summary-item">
        <span className="tp-summary-value">{active}</span>
        <span className="tp-summary-label">Active</span>
      </div>
      <div className="tp-summary-item">
        <span className="tp-summary-value">{done}</span>
        <span className="tp-summary-label">Done</span>
      </div>
      <div className={`tp-summary-item${overdue > 0 ? " is-alert" : ""}`}>
        <span className="tp-summary-value">{overdue}</span>
        <span className="tp-summary-label">Overdue</span>
      </div>
      <div className="tp-summary-item">
        <span className="tp-summary-value">{donePomos}/{estPomos || "—"}</span>
        <span className="tp-summary-label">Pomodoros</span>
      </div>
    </div>
  );
}
