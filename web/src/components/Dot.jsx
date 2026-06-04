/* Colored dot — used for project indicators, status pulses, priority
   markers. Default size 8px. */
export default function Dot({ color = "currentColor", size = 8, style, className = "" }) {
  return (
    <span
      className={`ui-dot ${className}`.trim()}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
