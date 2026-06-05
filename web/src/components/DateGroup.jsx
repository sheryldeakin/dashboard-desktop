/* DateGroup — recurring "date header + count chip + nested rows"
   pattern. Used by /history for completed-task groups and Claude
   session groups, and will apply anywhere a list is bucketed by
   date.

   Props:
     label    — date label ("Today" / "Yesterday" / "Mon, Jun 1")
     count    — optional right-side count/meta node (string or node)
     children — the rows for this date group

   The label is a small uppercase muted line with an underline; the
   count sits right-aligned. Children render below. */

export default function DateGroup({ label, count, children, className = "" }) {
  return (
    <div className={`ui-date-group ${className}`.trim()}>
      <div className="ui-date-group-header">
        <span className="ui-date-group-label">{label}</span>
        {count !== undefined && count !== null && (
          <span className="ui-date-group-count">{count}</span>
        )}
      </div>
      <div className="ui-date-group-body">{children}</div>
    </div>
  );
}
