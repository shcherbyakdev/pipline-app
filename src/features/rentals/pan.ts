// Pure maths for dragging the timeline chart (use-pan-chart.ts owns the
// pointer events): sideways the chart moves through TIME — on release the
// window shifts by the whole days dragged — and vertically it scrolls its
// lanes. A press only becomes a drag once the pointer has moved this far,
// so a click that jitters a pixel or two still lands on the cell or bar
// under it.
import { addDaysISO } from "@/features/scheduling/slots";
import { daysBetween } from "./range";

export const PAN_THRESHOLD_PX = 4;

/** How many days a horizontal drag of `dx` pixels moves the window, to the
    nearest day column: dragging left reveals later dates, so negative dx
    is forward in time. An unmeasured column (0) moves nothing. */
export function panDays(dx: number, cellPx: number): number {
  if (cellPx <= 0) return 0;
  return Math.round(-dx / cellPx);
}

/** What the page fetches and the chart renders: the visible window with a
    whole window before and after it, so a drag always has real days under
    the hand and a release within a window's reach needs no server before
    it can show the new window. */
export function bufferWindow(from: string, days: number): { bufferFrom: string; cols: number } {
  return { bufferFrom: addDaysISO(from, -days), cols: days * 3 };
}

/** Where the visible window starts inside the buffer, in columns — `days`
    when the buffer is centred, drifting as client-side shifts move the
    visible start before the server recentres the buffer. */
export function visibleOffset(bufferFrom: string, from: string): number {
  return daysBetween(bufferFrom, from);
}

export type PanStart = { x: number; y: number; left: number; top: number };

/** Where the scroller should be for a pointer now at `now`, and whether the
    movement counts as a drag at all. The chart follows the hand: moving
    the pointer left reveals what is to the right. */
export function panStep(
  start: PanStart,
  now: { x: number; y: number },
  threshold: number,
): { dragging: boolean; left: number; top: number } {
  const dx = now.x - start.x;
  const dy = now.y - start.y;
  if (Math.hypot(dx, dy) < threshold) return { dragging: false, left: start.left, top: start.top };
  return { dragging: true, left: Math.max(0, start.left - dx), top: Math.max(0, start.top - dy) };
}
