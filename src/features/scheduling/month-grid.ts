// Pure geometry for the Bookings month view: which dates the grid draws, and
// which of them a booking belongs on. No DB, no clock reads, org-local dates
// as "YYYY-MM-DD" strings — the same rules as calendar-geometry.ts.
import { addDaysISO } from "./slots";
import { mondayOf, zonedParts } from "./calendar-geometry";
import type { RangeMode } from "@/features/rentals/range";

const DAY_MS = 24 * 60 * 60 * 1000;

function noon(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

/** Whole days from `a` to `b` (noon-anchored, so DST can't shift the count). */
export function daysApart(a: string, b: string): number {
  return Math.round((noon(b) - noon(a)) / DAY_MS);
}

/** The last calendar date of the month `date` falls in. */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

/** The first of the month `date` falls in. */
export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** Add `n` months, keeping the first of the month (the arrows' step). */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/* The Monday-first weeks that cover a month — 5 rows usually, 4 for a
   February that starts on a Monday, 6 when a 31-day month starts late.
   Returned flat: the view slices it into rows of seven. */
export function monthGrid(date: string): string[] {
  const first = monthStart(date);
  const start = mondayOf(first);
  const weeks = Math.ceil((daysApart(start, monthEnd(first)) + 1) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDaysISO(start, i));
}

type Spanning = {
  startsAt: string;
  endsAt: string;
  rentalUnitId: string | null;
  rangeMode: RangeMode | null;
};

/* Which cells a booking shows in. An appointment — and an hourly rental,
   which is one too (H2) — belongs to the day it starts on. A stay holds its
   unit across days, so it shows on each of them: nights end the morning of
   checkout, so the guest's last night is the last cell; days include the
   return day (timeline-layout.ts occupiedRange, the same rule the tape
   chart reads). */
export function datesCovered(b: Spanning, timeZone: string): string[] {
  const start = zonedParts(new Date(b.startsAt), timeZone).date;
  if (b.rentalUnitId === null || b.rangeMode === "hours") return [start];
  const rawEnd = zonedParts(new Date(b.endsAt), timeZone).date;
  const end =
    b.rangeMode === "nights" ? (rawEnd > start ? addDaysISO(rawEnd, -1) : start) : rawEnd;
  const span = Math.max(0, daysApart(start, end));
  return Array.from({ length: span + 1 }, (_, i) => addDaysISO(start, i));
}

/** Bookings grouped by the cells they cover, in start order within a cell. */
export function byDate<T extends Spanning>(bookings: readonly T[], timeZone: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const b of [...bookings].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    for (const d of datesCovered(b, timeZone)) {
      const cell = out.get(d);
      if (cell) cell.push(b);
      else out.set(d, [b]);
    }
  }
  return out;
}
