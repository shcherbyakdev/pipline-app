"use client";

import * as React from "react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { RangeMode } from "@/features/rentals/range";
import { PAN_THRESHOLD_PX } from "@/features/rentals/pan";
import type { DragEdge } from "@/features/rentals/timeline-layout";

/* Drag a stay's bar to move it, or one of its edges to change a date. The
   bar's pointerdown hands the press to `begin`; the chart's scroller owns
   the move/up handlers so the drag survives leaving the bar and the lane.
   Positions are in CONTENT pixels (client x + scrollLeft), so scrolling
   during the drag — the wheel, or the edge auto-scroll below — keeps the
   days under the hand honest. The lane under the pointer is found by
   hit-testing for `data-tl-unit`; only a lane of the same space is a
   target (an edge drag never changes lane). Nothing happens until the
   pointer has moved a few pixels, so a plain click still opens the stay;
   after a drag, the click the browser fires on release is swallowed. */

export type StayDrag = {
  booking: AdminBooking;
  mode: RangeMode;
  offeringId: string;
  originUnitId: string;
  edge: DragEdge;
  dayDelta: number;
  targetUnitId: string;
};

export type StayDrop = Pick<StayDrag, "booking" | "mode" | "offeringId" | "originUnitId" | "edge" | "dayDelta" | "targetUnitId">;

type Press = StayDrag & { pointerId: number; startX: number; startY: number; startContentX: number; active: boolean };

const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_PX = 6;

export function useStayDrag({
  scrollerRef,
  cellPx,
  onDrop,
}: {
  scrollerRef: React.RefObject<HTMLElement | null>;
  cellPx: number;
  onDrop: (drop: StayDrop) => void;
}) {
  const pressRef = React.useRef<Press | null>(null);
  const lastPointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const autoRef = React.useRef<number | null>(null);
  const draggedRef = React.useRef(false);
  const [state, setState] = React.useState<StayDrag | null>(null);

  const stopAuto = () => {
    if (autoRef.current !== null) cancelAnimationFrame(autoRef.current);
    autoRef.current = null;
  };

  const begin = (
    e: React.PointerEvent,
    press: { booking: AdminBooking; mode: RangeMode; offeringId: string; unitId: string; edge: DragEdge },
  ) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    draggedRef.current = false;
    pressRef.current = {
      booking: press.booking,
      mode: press.mode,
      offeringId: press.offeringId,
      originUnitId: press.unitId,
      targetUnitId: press.unitId,
      edge: press.edge,
      dayDelta: 0,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startContentX: e.clientX - rect.left + el.scrollLeft,
      active: false,
    };
  };

  // Where the pointer is now → the day delta and the lane under it.
  const update = (x: number, y: number) => {
    const press = pressRef.current;
    const el = scrollerRef.current;
    if (!press || !el || !press.active) return;
    const rect = el.getBoundingClientRect();
    const contentX = x - rect.left + el.scrollLeft;
    const dayDelta = cellPx > 0 ? Math.round((contentX - press.startContentX) / cellPx) : 0;
    let targetUnitId = press.targetUnitId;
    if (press.edge === "move") {
      const lane = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tl-unit]");
      if (lane && lane.dataset.tlOffering === press.offeringId) targetUnitId = lane.dataset.tlUnit ?? targetUnitId;
    }
    if (dayDelta !== press.dayDelta || targetUnitId !== press.targetUnitId) {
      press.dayDelta = dayDelta;
      press.targetUnitId = targetUnitId;
      setState(snapshot(press));
    }
  };

  // Dragging near the scroller's edge scrolls it, so a stay can be carried
  // further than the screen shows.
  const autoScroll = () => {
    const el = scrollerRef.current;
    const p = lastPointerRef.current;
    if (!el || !p || !pressRef.current?.active) return stopAuto();
    const rect = el.getBoundingClientRect();
    const dir = p.x < rect.left + EDGE_ZONE_PX ? -1 : p.x > rect.right - EDGE_ZONE_PX ? 1 : 0;
    if (dir === 0) return stopAuto();
    el.scrollLeft += dir * AUTO_SCROLL_PX;
    update(p.x, p.y);
    autoRef.current = requestAnimationFrame(autoScroll);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!press.active) {
      if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < PAN_THRESHOLD_PX) return;
      press.active = true;
      draggedRef.current = true;
      try {
        e.currentTarget.setPointerCapture(press.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; the drag still works while it is over the chart.
      }
      setState(snapshot(press));
    }
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    update(e.clientX, e.clientY);
    if (autoRef.current === null) autoRef.current = requestAnimationFrame(autoScroll);
  };

  const end = (e: React.PointerEvent<HTMLElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    stopAuto();
    if (!press || !press.active) return;
    setState(null);
    try {
      e.currentTarget.releasePointerCapture(press.pointerId);
    } catch {
      // Already released.
    }
    if (e.type !== "pointercancel") onDrop(snapshot(press));
  };

  const onClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    state,
    begin,
    handlers: { onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  };
}

function snapshot(p: Press): StayDrag {
  return {
    booking: p.booking,
    mode: p.mode,
    offeringId: p.offeringId,
    originUnitId: p.originUnitId,
    edge: p.edge,
    dayDelta: p.dayDelta,
    targetUnitId: p.targetUnitId,
  };
}
