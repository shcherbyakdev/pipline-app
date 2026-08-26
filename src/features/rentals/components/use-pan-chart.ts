"use client";

import * as React from "react";
import { PAN_THRESHOLD_PX, panDays, panStep, type PanStart } from "@/features/rentals/pan";

/* Grab the chart and drag it through time, like a map. Sideways, the
   chart follows the hand (a translate driven by the `--pan` CSS variable
   on the scroller — the sticky rail counter-translates so unit names stay
   put) and on release the window shifts by the whole days dragged
   (pan.ts panDays → `onShift`); the translate is cleared once the new
   window has rendered (`reset`, called by the chart when `fromDate`
   changes — plus a timeout in case the shift landed on the same window).
   Vertically it just scrolls the lanes.

   Mouse (and pen) only — touch already scrolls natively, and handling it
   twice would fight the browser. A press is not a drag until the pointer
   has moved a few pixels, so a plain click still books an empty cell or
   opens a stay; once it IS a drag, the pointer is captured so the pan
   survives leaving the chart, and the click the browser fires on release
   is swallowed in the capture phase before any cell, bar or link can act
   on it. */
export function usePanChart<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { cellPx, onShift }: { cellPx: number; onShift: (days: number) => void },
) {
  const startRef = React.useRef<(PanStart & { pointerId: number; lastX: number }) | null>(null);
  // Whether the press in progress (or just released) turned into a drag —
  // read by the click suppressor, reset by the next press.
  const draggedRef = React.useRef(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const reset = React.useCallback(() => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    ref.current?.style.setProperty("--pan", "0px");
  }, [ref]);

  const onPointerDown = (e: React.PointerEvent<T>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    draggedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, left: 0, top: el.scrollTop, pointerId: e.pointerId };
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
    start.lastX = e.clientX;
    el.scrollTop = step.top;
    el.style.setProperty("--pan", `${e.clientX - start.x}px`);
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
    const days = panDays(start.lastX - start.x, cellPx);
    if (days === 0) {
      reset();
      return;
    }
    onShift(days);
    // The chart resets when the new window renders; if the shift landed on
    // the same window (a clamped date), this stops the chart hanging mid-air.
    resetTimer.current = setTimeout(reset, 2000);
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
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  };
}
