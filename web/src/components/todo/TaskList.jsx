import TaskRow from "./TaskRow.jsx";

export default function TaskList({
  visibleTasks,
  totalCount,
  selectedTaskId,
  sortBy,
  dragTaskId,
  dragOverTaskId,
  pomodoroTaskId,
  activeSection,
  projects,
  onSelectTask,
  onTaskCheckbox,
  onTaskAction,
  onTaskDragStart,
  onTaskDragOver,
  onTaskDrop,
  onTaskDragEnd,
  quickAddValue,
  onQuickAddChange,
  onQuickAdd,
}) {
  return (
    <section className="tp-main-content">
      <div className="tp-quick-add">
        <span className="tp-quick-add-icon">+</span>
        <input
          type="text"
          className="tp-quick-add-input"
          placeholder="Add a task…"
          value={quickAddValue}
          onChange={(e) => onQuickAddChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onQuickAdd();
            }
          }}
        />
      </div>

      <div className="tp-list-header">
        <span className="tp-list-section">{activeSection.label}</span>
        <span className="tp-list-count">{visibleTasks.length}/{totalCount}</span>
      </div>

      <ul className="tp-task-list">
        {visibleTasks.length === 0 ? (
          <li className="tp-empty">No tasks match the current filters.</li>
        ) : (
          visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projects={projects}
              isSelected={selectedTaskId === task.id}
              isDragOver={dragOverTaskId === task.id && dragTaskId && dragTaskId !== task.id}
              isDragging={dragTaskId === task.id}
              sortBy={sortBy}
              pomodoroTaskId={pomodoroTaskId}
              onSelect={onSelectTask}
              onCheckbox={onTaskCheckbox}
              onAction={onTaskAction}
              onDragStart={onTaskDragStart}
              onDragOver={onTaskDragOver}
              onDrop={onTaskDrop}
              onDragEnd={onTaskDragEnd}
            />
          ))
        )}
      </ul>
    </section>
  );
}
