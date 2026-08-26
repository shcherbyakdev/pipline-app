// Pure maths for dragging the timeline chart to scroll it (use-pan-scroll.ts
// owns the pointer events). A press only becomes a drag once the pointer
// has moved this far — a click that jitters a pixel or two still lands on
// the cell or bar under it.
export const PAN_THRESHOLD_PX = 4;

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
