/* Collapsible — themed wrapper around native <details>/<summary> with
   a rotating caret + consistent styling. Use anywhere we want a
   "click-to-drill-in" pattern: history bucket expansion, history
   per-session details, future settings panels, etc.

   Props:
     summary       — the always-visible row (node)
     children      — the revealed content
     defaultOpen   — whether the body is initially open
     variant       — "default" | "compact" (smaller caret + spacing)
     className     — applied to the outer <details>
     summaryClassName — applied to the <summary>
     onToggle      — (open: bool) => void, fires on each toggle */

import { useRef } from "react";

export default function Collapsible({
  summary,
  children,
  defaultOpen = false,
  variant = "default",
  className = "",
  summaryClassName = "",
  onToggle,
}) {
  const detailsRef = useRef(null);
  function handleToggle() {
    if (onToggle && detailsRef.current) {
      onToggle(detailsRef.current.open);
    }
  }
  return (
    <details
      ref={detailsRef}
      open={defaultOpen}
      onToggle={handleToggle}
      className={`ui-collapsible ui-collapsible--${variant} ${className}`.trim()}
    >
      <summary className={`ui-collapsible-summary ${summaryClassName}`.trim()}>
        <span className="ui-collapsible-caret" aria-hidden="true">▸</span>
        <span className="ui-collapsible-summary-content">{summary}</span>
      </summary>
      <div className="ui-collapsible-body">{children}</div>
    </details>
  );
}
