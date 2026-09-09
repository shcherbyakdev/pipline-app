"use client";

import * as React from "react";
import { PAN_THRESHOLD_PX } from "@/features/rentals/pan";

/* Grab the date header and drag the chart through time. The chart is a
   plain scroller now, so a pan is just `scrollLeft` following the hand
   (and `scrollTop`, so a diagonal drag scrolls the lanes too); the chart's
   own scroll-settle commits the window to the URL afterwards. The pan is
   INCREMENTAL (each move applies its own delta) rather than anchored to
   the press: a settle can land mid-drag and recentre the buffer under
   the hand, and an anchored pan would then jump by a window. Mouse and
   pen only — touch scrolls natively. A press is not a drag until the
   pointer has moved a few pixels, so the day links in the header still
   click; once it IS a drag the pointer is captured, and the click the
   browser fires on release is swallowed in the capture phase. */
export function useDragScroll<T extends HTMLElement>(scrollerRef: React.RefObject<HTMLElement | null>) {
  const startRef = React.useRef<{ x: number; y: number; lastX: number; lastY: number; pointerId: number } | null>(null);
  const draggedRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);

  const onPointerDown = (e: React.PointerEvent<T>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    draggedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent<T>) => {
    const start = startRef.current;
    const el = scrollerRef.current;
    if (!start || !el) return;
    if (!draggedRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < PAN_THRESHOLD_PX) return;
      draggedRef.current = true;
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(start.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; the pan still works while it is over the header.
      }
    }
    el.scrollLeft -= e.clientX - start.lastX;
    el.scrollTop -= e.clientY - start.lastY;
    start.lastX = e.clientX;
    start.lastY = e.clientY;
  };
  const end = (e: React.PointerEvent<T>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || !draggedRef.current) return;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(start.pointerId);
    } catch {
      // Already released.
    }
  };
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
