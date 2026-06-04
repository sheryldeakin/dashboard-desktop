/* EditableText — click to edit, save on blur or Enter, cancel on Esc.
   Used for in-place editing of titles, phases, deadlines, etc.
   The AdminPage / DashboardPage pattern of inline-edit gets a primitive.

   Props:
     value      → current value (string)
     onChange   → (next) => void, called when the user commits
     placeholder → shown when value is empty
     editable   → if false, renders as static (read-only)
     inputType  → "text" | "datetime-local" | etc.
     tag        → wrapper element ("span", "h1", etc.) — default "span"
     className  → applied to the rendered tag in both states
   The component keeps internal draft state during edit so Esc reverts. */

import { useEffect, useRef, useState } from "react";

export default function EditableText({
  value,
  onChange,
  placeholder = "",
  editable = true,
  inputType = "text",
  tag: Tag = "span",
  className = "",
  inputClassName = "",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputType === "text" && inputRef.current.select) {
        inputRef.current.select();
      }
    }
  }, [editing, inputType]);

  function commit() {
    setEditing(false);
    const next = (draft || "").trim();
    if (next !== value) onChange(next);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function startEdit() {
    if (!editable) return;
    setDraft(value);
    setEditing(true);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={inputType}
        className={`ui-editable-input ${inputClassName}`.trim()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
      />
    );
  }

  return (
    <Tag
      className={`${className}${editable ? " ui-editable" : ""}`.trim()}
      onClick={startEdit}
      title={editable ? "Click to edit" : undefined}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={editable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          startEdit();
        }
      } : undefined}
    >
      {value || <span className="ui-editable-placeholder">{placeholder}</span>}
    </Tag>
  );
}
