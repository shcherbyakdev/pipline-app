// Pure maths for moving the timeline chart through time. The chart is a
// native scroller (timeline.tsx); these decide what it renders and where
// the visible window sits inside it. A press only becomes a drag once the
// pointer has moved this far, so a click that jitters a pixel or two still
// lands on the cell, bar or link under it.
import { addDaysISO } from "@/features/scheduling/slots";
import { daysBetween } from "./range";

export const PAN_THRESHOLD_PX = 4;

/** What the page fetches and the chart renders: the visible window with a
    whole window before and after it, so scrolling always has real days
    under the hand and a settled scroll within a window's reach needs no
    server before it can show the new window. */
export function bufferWindow(from: string, days: number): { bufferFrom: string; cols: number } {
  return { bufferFrom: addDaysISO(from, -days), cols: days * 3 };
}

/** Where the visible window starts inside the buffer, in columns — `days`
    when the buffer is centred, drifting as client-side scrolls move the
    visible start before the server recentres the buffer. */
export function visibleOffset(bufferFrom: string, from: string): number {
  return daysBetween(bufferFrom, from);
}

/** Which column a scroll position has settled on, to the nearest day. An
    unmeasured column (0px) is column 0. */
export function settledColumn(scrollLeft: number, cellPx: number): number {
  if (cellPx <= 0) return 0;
  return Math.max(0, Math.round(scrollLeft / cellPx));
}
