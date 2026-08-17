// Pure geometry for the admin rentals timeline (a Gantt-style grid: rows are
// units, columns are days). No DB, no clock reads — instants come in as
// Dates, the window is always org-local "YYYY-MM-DD" strings.
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { daysBetween } from "./range";
import type { RangeMode } from "./range";

export const TIMELINE_DAYS = 21;

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

// Turnover cells after the last OCCUPIED day: nights — the checkout day is
// the cleaning day, so the tail starts ON the checkout (half) cell; days —
// the tail starts the day after the return day. Null when there is no
// turnover, when the bar's tail is already cut off by the window's right
// edge (we don't know where the real checkout/return day is, so we can't
// place the tail), or when the tail falls entirely outside the window.
export function turnoverSpan(
  bar: BarSpan,
  mode: RangeMode,
  turnoverDays: number,
  days: number,
): { colStart: number; colSpan: number } | null {
  if (turnoverDays === 0 || bar.clippedRight) return null;
  const occLast = mode === "nights" ? bar.colStart + bar.colSpan - 2 : bar.colStart + bar.colSpan - 1;
  const tailStart = occLast + 1;
  const maxIndex = days - 1;
  if (tailStart > maxIndex) return null;
  const tailEnd = Math.min(maxIndex, tailStart + turnoverDays - 1);
  return { colStart: tailStart, colSpan: tailEnd - tailStart + 1 };
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

export function timelineDefaultStart(todayISO: string): string {
  return addDaysISO(todayISO, -2);
}
