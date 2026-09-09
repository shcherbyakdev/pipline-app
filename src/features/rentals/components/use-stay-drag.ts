"use client";

import * as React from "react";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { RangeMode } from "@/features/rentals/range";
import { PAN_THRESHOLD_PX } from "@/features/rentals/pan";
import { addDaysISO } from "@/features/scheduling/slots";
import { daysBetween } from "@/features/rentals/range";
import type { DragEdge } from "@/features/rentals/timeline-layout";

/* Drag a stay's bar to move it, or one of its edges to change a date. The
   bar's pointerdown hands the press to `begin`; the chart's scroller owns
   the move/up handlers so the drag survives leaving the bar and the lane.
   The day under the pointer is a DATE (the column under the hand, read
   off the buffer the board currently shows), so scrolling during the
   drag — the wheel, the edge auto-scroll below, or a settle recentring
   the buffer under the hand — keeps the days honest: the delta is the
   distance between the date pressed on and the date the pointer is over
   now. The lane under the pointer is found by hit-testing for
   `data-tl-unit`; only a lane of the same space is a target (an edge
   drag never changes lane). Nothing happens until the
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

export type StayDrop = Pick<
  StayDrag,
  | "booking"
  | "mode"
  | "offeringId"
  | "originUnitId"
  | "edge"
  | "dayDelta"
  | "targetUnitId"
>;

type Press = StayDrag & {
  pointerId: number;
  startX: number;
  startY: number;
  startDate: string;
  active: boolean;
};

const EDGE_ZONE_PX = 32;
const AUTO_SCROLL_PX = 6;

export function useStayDrag({
  scrollerRef,
  cellPx,
  railPx,
  bufferFrom,
  onDrop,
}: {
  scrollerRef: React.RefObject<HTMLElement | null>;
  cellPx: number;
  railPx: number;
  /** The first column's date — what a content x maps to a date through. */
  bufferFrom: string;
  onDrop: (drop: StayDrop) => void;
}) {
  const pressRef = React.useRef<Press | null>(null);
  const lastPointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const autoRef = React.useRef<number | null>(null);
  const draggedRef = React.useRef(false);
  const [state, setState] = React.useState<StayDrag | null>(null);
  // The geometry and the drop handler, read through a ref so `begin` is one
  // stable function for the memoised lanes (a bar press hands it the
  // booking; the lanes never re-render for it).
  const optsRef = React.useRef({ cellPx, railPx, bufferFrom, onDrop });
  React.useEffect(() => {
    optsRef.current = { cellPx, railPx, bufferFrom, onDrop };
  }, [cellPx, railPx, bufferFrom, onDrop]);

  const stopAuto = () => {
    if (autoRef.current !== null) cancelAnimationFrame(autoRef.current);
    autoRef.current = null;
  };

  // The date under a client x, on the buffer the board shows right now.
  const dateAt = (clientX: number): string | null => {
    const el = scrollerRef.current;
    const { cellPx, railPx, bufferFrom } = optsRef.current;
    if (!el || cellPx <= 0) return null;
    const contentX =
      clientX - el.getBoundingClientRect().left + el.scrollLeft - railPx;
    return addDaysISO(bufferFrom, Math.floor(contentX / cellPx));
  };

  const begin = React.useCallback(
    (
      e: React.PointerEvent,
      press: {
        booking: AdminBooking;
        mode: RangeMode;
        offeringId: string;
        unitId: string;
        edge: DragEdge;
      },
    ) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      const startDate = dateAt(e.clientX);
      if (startDate === null) return;
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
        startDate,
        active: false,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dateAt reads refs only
    [],
  );

  // Where the pointer is now → the day delta and the lane under it.
  const update = (x: number, y: number) => {
    const press = pressRef.current;
    if (!press || !press.active) return;
    const date = dateAt(x);
    if (date === null) return;
    const dayDelta = daysBetween(press.startDate, date);
    let targetUnitId = press.targetUnitId;
    if (press.edge === "move") {
      const lane = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-tl-unit]");
      if (lane && lane.dataset.tlOffering === press.offeringId)
        targetUnitId = lane.dataset.tlUnit ?? targetUnitId;
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
    const dir =
      p.x < rect.left + EDGE_ZONE_PX
        ? -1
        : p.x > rect.right - EDGE_ZONE_PX
          ? 1
          : 0;
    if (dir === 0) return stopAuto();
    el.scrollLeft += dir * AUTO_SCROLL_PX;
    update(p.x, p.y);
    autoRef.current = requestAnimationFrame(autoScroll);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!press.active) {
      if (
        Math.hypot(e.clientX - press.startX, e.clientY - press.startY) <
        PAN_THRESHOLD_PX
      )
        return;
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
    if (autoRef.current === null)
      autoRef.current = requestAnimationFrame(autoScroll);
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
    if (e.type !== "pointercancel") optsRef.current.onDrop(snapshot(press));
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
    handlers: {
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture,
    },
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
