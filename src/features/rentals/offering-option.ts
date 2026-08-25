import type { RangeMode } from "@/features/rentals/range";

/* The row shape the New-booking picker and the space form work from —
   deliberately NOT the full OfferingRow: the timeline hands over
   `{id, name, rangeMode}` and the hourly fields stay optional so that keeps
   compiling; the Bookings page passes real OfferingRows, whose extra fields
   structurally satisfy this. (Moved out of the space form it used to live in.) */
export type OfferingOption = {
  id: string;
  name: string;
  rangeMode?: RangeMode;
  slotIncrementMin?: number | null;
  minDurationMin?: number | null;
  maxDurationMin?: number | null;
};

export type HourGrid = { minDurationMin: number; maxDurationMin: number; slotIncrementMin: number };

/** The hourly trio, or null for nights/days (or an hourly row missing it). */
export function hourlyGrid(o: OfferingOption): HourGrid | null {
  if (o.rangeMode !== "hours" || o.minDurationMin == null || o.maxDurationMin == null || o.slotIncrementMin == null) {
    return null;
  }
  return { minDurationMin: o.minDurationMin, maxDurationMin: o.maxDurationMin, slotIncrementMin: o.slotIncrementMin };
}
