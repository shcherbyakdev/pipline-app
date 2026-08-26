"use client";

import * as React from "react";
import { PAN_THRESHOLD_PX, panStep, type PanStart } from "@/features/rentals/pan";

/* Grab the chart and drag it to scroll, like a map. Mouse (and pen) only —
   touch already pans natively, and handling it twice would fight the
   browser. A press is not a drag until the pointer has moved a few pixels
   (pan.ts), so a plain click still books an empty cell or opens a stay;
   once it IS a drag, the pointer is captured so the pan survives leaving
   the chart, and the click the browser fires on release is swallowed in
   the capture phase before any cell, bar or link can act on it. */
export function usePanScroll<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const startRef = React.useRef<(PanStart & { pointerId: number }) | null>(null);
  // Whether the press in progress (or just released) turned into a drag —
  // read by the click suppressor, reset by the next press.
  const draggedRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);

  const onPointerDown = (e: React.PointerEvent<T>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    draggedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent<T>) => {
    const start = startRef.current;
    const el = ref.current;
    if (!start || !el) return;
    const step = panStep(start, { x: e.clientX, y: e.clientY }, PAN_THRESHOLD_PX);
    if (!step.dragging) return;
    if (!draggedRef.current) {
      draggedRef.current = true;
      setDragging(true);
      // Captured only once it is a drag: capturing on the press itself
      // would retarget the release and break ordinary clicks.
      try {
        el.setPointerCapture(start.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; the pan still works while it is over the chart.
      }
    }
    el.scrollLeft = step.left;
    el.scrollTop = step.top;
  };

  const end = () => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || !draggedRef.current) return;
    setDragging(false);
    try {
      ref.current?.releasePointerCapture(start.pointerId);
    } catch {
      // Already released.
    }
  };

  // The click that follows a drag's release must not book a cell, open a
  // stay or follow a link.
  const onClickCapture = (e: React.MouseEvent<T>) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  };
}
