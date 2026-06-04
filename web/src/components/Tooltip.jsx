/* Tooltip — themed replacement for the native `title=` attribute.
   Native tooltips have ~700ms delay, are unstyleable, and can't carry
   rich content. This one:
     - Shows after `delay` ms (default 180)
     - Hides immediately on mouseleave / scroll / resize
     - Renders to document.body via portal so it isn't clipped by any
       ancestor's overflow: hidden
     - Positions above the wrapped element by default; flips below if
       there isn't room above
     - Centers horizontally, clamps to keep itself inside the viewport
     - Arrow points at the wrapper
     - Respects prefers-reduced-motion via the global rule in styles.css

   Usage: <Tooltip content="Some text"><button>X</button></Tooltip>
   For complex content: <Tooltip content={<div>…</div>}>…</Tooltip>

   The wrapper is a <span style={{display: 'contents'}}> so it doesn't
   add a layout box. We attach the listeners to the FIRST child via
   React.cloneElement so the tooltip target is the element itself, not
   a wrapping span. */

import { cloneElement, isValidElement, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";

export default function Tooltip({
  children,
  content,
  delay = 180,
  placement: preferredPlacement = "top",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, placement: preferredPlacement });
  const childRef = useRef(null);
  const tooltipRef = useRef(null);
  const timerRef = useRef(null);

  // Compute position based on the wrapped element's bounding rect.
  function updatePosition() {
    const el = childRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tooltipEl = tooltipRef.current;
    const tooltipRect = tooltipEl?.getBoundingClientRect();
    const tooltipW = tooltipRect?.width || 120;
    const tooltipH = tooltipRect?.height || 28;

    // Decide top vs bottom based on available space
    let placement = preferredPlacement;
    if (placement === "top" && rect.top - tooltipH - 10 < 0) placement = "bottom";
    if (placement === "bottom" && rect.bottom + tooltipH + 10 > window.innerHeight)
      placement = "top";

    const top =
      placement === "top" ? rect.top - tooltipH - 8 : rect.bottom + 8;

    // Center horizontally over the wrapper, clamped to viewport edges
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    const PAD = 8;
    if (left < PAD) left = PAD;
    if (left + tooltipW > window.innerWidth - PAD)
      left = window.innerWidth - tooltipW - PAD;

    setPos({ left, top, placement });
  }

  function handleEnter() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setOpen(true);
      // Recompute position after the next paint when the tooltip exists
      // in the DOM so we have its real width/height for clamping.
      requestAnimationFrame(updatePosition);
    }, delay);
  }

  function handleLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  // Close on scroll/resize — repositioning a tooltip while the page
  // moves under it feels worse than just dismissing.
  useEffect(() => {
    if (!open) return;
    function onScroll() { setOpen(false); }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  // If content is falsy (empty string, null), just render the child as-is.
  // No tooltip baggage when there's nothing to show.
  if (!content) return children;

  // Clone the child so the listeners + ref attach directly to it.
  if (!isValidElement(children)) return children;
  const wrapped = cloneElement(children, {
    ref: (node) => {
      childRef.current = node;
      // Preserve any ref the caller may have set
      const childRef2 = children.ref;
      if (typeof childRef2 === "function") childRef2(node);
      else if (childRef2 && typeof childRef2 === "object") childRef2.current = node;
    },
    onMouseEnter: (e) => {
      handleEnter();
      if (children.props.onMouseEnter) children.props.onMouseEnter(e);
    },
    onMouseLeave: (e) => {
      handleLeave();
      if (children.props.onMouseLeave) children.props.onMouseLeave(e);
    },
    onFocus: (e) => {
      handleEnter();
      if (children.props.onFocus) children.props.onFocus(e);
    },
    onBlur: (e) => {
      handleLeave();
      if (children.props.onBlur) children.props.onBlur(e);
    },
  });

  return (
    <>
      {wrapped}
      {open && createPortal(
        <div
          ref={tooltipRef}
          className={`tooltip tooltip--${pos.placement}`}
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
          role="tooltip"
        >
          {content}
          <span className="tooltip-arrow" aria-hidden="true" />
        </div>,
        document.body
      )}
    </>
  );
}
