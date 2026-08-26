// Pure geometry for the admin rentals timeline (a Gantt-style grid: rows are
// units, columns are days). No DB, no clock reads — instants come in as
// Dates, the window is always org-local "YYYY-MM-DD" strings.
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { daysBetween } from "./range";
import type { RangeMode } from "./range";

// The query's default window when a caller passes none — the page always
// passes its zoom (timeline-layout.ts ZOOMS), of which this is the default.
export const TIMELINE_DAYS = 28;

export type BarSpan = {
  colStart: number; // 0-based day index
  colSpan: number; // >= 1
  halfEnd: boolean;
  clippedLeft: boolean;
  clippedRight: boolean;
};

// A stay's bar in window-relative columns. Nights: cells run
// [check-in date, checkout date] inclusive — the checkout day is a half
// cell (the guest leaves that morning). Days: cells run
// [pickup date, return date] inclusive, full cells throughout.
export function barSpan(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  windowStart: string,
  days: number,
): BarSpan | null {
  const startDate = dateInZone(b.startsAt, timeZone);
  const endDate = dateInZone(b.endsAt, timeZone);
  const maxIndex = days - 1;
  const rawStart = daysBetween(windowStart, startDate);
  const rawLast = daysBetween(windowStart, endDate);
  if (rawLast < 0 || rawStart > maxIndex) return null;
  const clippedLeft = rawStart < 0;
  const clippedRight = rawLast > maxIndex;
  const colStart = Math.max(0, rawStart);
  const colEnd = Math.min(maxIndex, rawLast);
  return {
    colStart,
    colSpan: colEnd - colStart + 1,
    halfEnd: mode === "nights" ? !clippedRight : false,
    clippedLeft,
    clippedRight,
  };
}

// Turnover cells after the last OCCUPIED day, computed straight from the
// stay's own dates rather than from `barSpan`'s output — a stay whose
// checkout/return fell before the window (barSpan returns null: no bar to
// paint) can still have turnover days that reach into the window, and that
// must not depend on a bar existing. Nights — the checkout day is the
// cleaning day, so the tail starts ON the checkout date; days — the tail
// starts the day after the return date. Null when there is no turnover, or
// the tail falls entirely outside the window (this also covers what used to
// be the "bar clipped by the window's right edge" case: if the checkout is
// beyond the window, tailStart lands beyond it too and fails the same
// `tailStart > maxIndex` check below).
export function turnoverSpan(
  b: { endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  turnoverDays: number,
  windowStart: string,
  days: number,
): { colStart: number; colSpan: number } | null {
  if (turnoverDays === 0) return null;
  const endDate = dateInZone(b.endsAt, timeZone);
  const rawEnd = daysBetween(windowStart, endDate);
  const tailStart = mode === "nights" ? rawEnd : rawEnd + 1;
  const tailLast = tailStart + turnoverDays - 1;
  const maxIndex = days - 1;
  if (tailLast < 0 || tailStart > maxIndex) return null;
  const colStart = Math.max(0, tailStart);
  const colEnd = Math.min(maxIndex, tailLast);
  return { colStart, colSpan: colEnd - colStart + 1 };
}

export function blackoutSpan(
  startDate: string,
  endDate: string,
  windowStart: string,
  days: number,
): { colStart: number; colSpan: number } | null {
  const maxIndex = days - 1;
  const rawStart = daysBetween(windowStart, startDate);
  const rawEnd = daysBetween(windowStart, endDate);
  if (rawEnd < 0 || rawStart > maxIndex) return null;
  const colStart = Math.max(0, rawStart);
  const colEnd = Math.min(maxIndex, rawEnd);
  return { colStart, colSpan: colEnd - colStart + 1 };
}

export function windowDays(windowStart: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysISO(windowStart, i));
}
