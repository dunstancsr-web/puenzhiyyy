import React, {
  cloneElement, Children, useCallback, useEffect, useId,
  useLayoutEffect, useRef, useState,
} from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────────────────────────────────────
// HoverHint - a frosted hover/focus tooltip that attaches to its trigger via
// React.cloneElement (no wrapper DOM node, so flex/grid layouts are untouched).
// Portals to <body>, clamps to the viewport, flips above if it would overflow.
//
//   <HoverHint content="Available stock = physical − reserved − hold">
//     <span>{value} MT</span>
//   </HoverHint>
//
//   <HoverHint content={<>…custom node…</>} title="What is this?">
//     {({ open }) => <button aria-pressed={open}>…</button>}
//   </HoverHint>
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPEN_DELAY = 120;
const DEFAULT_CLOSE_DELAY = 160;

const mergeRefs = (...refs) => (node) => {
  for (const ref of refs) {
    if (!ref) continue;
    if (typeof ref === "function") ref(node);
    else ref.current = node;
  }
};

const compose = (...fns) => (...args) => {
  for (const fn of fns) if (typeof fn === "function") fn(...args);
};

export default function HoverHint({
  children,
  content,
  title,
  panelWidth = 320,
  openDelay = DEFAULT_OPEN_DELAY,
  closeDelay = DEFAULT_CLOSE_DELAY,
}) {
  const id = useId();
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const openT = useRef(null);
  const closeT = useRef(null);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null); // { top, left, width, placement }

  const clearTimers = () => {
    clearTimeout(openT.current);
    clearTimeout(closeT.current);
  };

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(panelWidth, window.innerWidth - 24);
    const left = Math.max(
      12,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)
    );
    setCoords({ top: rect.bottom + 8, left, width, placement: "bottom" });
  }, [panelWidth]);

  const show = useCallback(() => {
    clearTimers();
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, []);

  const scheduleShow = () => {
    clearTimeout(closeT.current);
    openT.current = setTimeout(show, openDelay);
  };
  const scheduleHide = () => {
    clearTimeout(openT.current);
    closeT.current = setTimeout(hide, closeDelay);
  };

  // Flip above the trigger if the panel would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !coords || !panelRef.current || !triggerRef.current) return;
    const h = panelRef.current.offsetHeight;
    const rect = triggerRef.current.getBoundingClientRect();
    if (
      coords.placement === "bottom" &&
      rect.bottom + 8 + h > window.innerHeight - 12 &&
      rect.top - 8 - h > 12
    ) {
      setCoords((c) => ({ ...c, top: rect.top - h - 8, placement: "top" }));
    }
  }, [open, coords]);

  // Close on scroll / resize while open.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, hide]);

  useEffect(() => clearTimers, []);

  const raw = typeof children === "function" ? children({ open }) : children;
  const child = Children.only(raw);

  const trigger = cloneElement(child, {
    ref: mergeRefs(triggerRef, child.ref),
    className: [child.props.className, "hint-trigger"].filter(Boolean).join(" "),
    "aria-describedby": open ? id : child.props["aria-describedby"],
    onMouseEnter: compose(child.props.onMouseEnter, scheduleShow),
    onMouseLeave: compose(child.props.onMouseLeave, scheduleHide),
    onFocus: compose(child.props.onFocus, show),
    onBlur: compose(child.props.onBlur, hide),
    onKeyDown: compose(child.props.onKeyDown, (e) => {
      if (e.key === "Escape") { e.stopPropagation(); hide(); }
    }),
  });

  const panel = open && coords && (
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      className="hint-panel"
      onMouseEnter={() => clearTimeout(closeT.current)}
      onMouseLeave={scheduleHide}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
      }}
    >
      {title && <div className="hint-panel__hdr">{title}</div>}
      {typeof content === "string"
        ? <div className="hint-panel__body" style={{ whiteSpace: "pre-line" }}>{content}</div>
        : content}
    </div>
  );

  return (
    <>
      {trigger}
      {panel && createPortal(panel, document.body)}
    </>
  );
}
