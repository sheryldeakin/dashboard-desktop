/* IconButton — single-icon button with optional Tooltip wrapper.
   Variants:
     default → muted ink, hover ink + faint bg
     primary → accent-tan, used for affirmative actions
     danger  → accent-warn on hover, used for destructive
     ghost   → no border, transparent bg
   Sizes:
     sm → 22×22 (compact contexts: rail card actions, chip-row adds)
     md → 28×28 (default: section actions, list rows)
     lg → 36×36 (prominent: page-level actions, mobile hamburger)
   Always render with an aria-label (defaults to tooltip content if
   provided). The Tooltip wrap is optional; without one, the button is
   plain (use this when context already makes the action clear). */

import Tooltip from "./Tooltip.jsx";

export default function IconButton({
  icon,
  tooltip,
  onClick,
  variant = "default",
  size = "md",
  type = "button",
  disabled = false,
  active = false,
  ariaLabel,
  className = "",
  style,
}) {
  const button = (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel || (typeof tooltip === "string" ? tooltip : undefined)}
      aria-pressed={active || undefined}
      className={`ui-icon-btn ui-icon-btn--${variant} ui-icon-btn--${size}${active ? " is-active" : ""} ${className}`.trim()}
      style={style}
    >
      {icon}
    </button>
  );

  if (tooltip) return <Tooltip content={tooltip}>{button}</Tooltip>;
  return button;
}
