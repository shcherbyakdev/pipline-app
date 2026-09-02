import { addMonths, firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import type { SlotLayout } from "@/lib/widget-theme";

/* Window arithmetic for the public widget's free times. Days are the
   VIEWER's local YYYY-MM-DD (the widget groups slots by the day the visitor
   would call them); `dayOf` is injected so this stays pure and zone-free.
   Each layout (widget templates spec 2026-09-02 §2) fetches one WINDOW at
   a time — a week, a Monday-first week, a month, four weeks — and pages by
   shifting it; getSlotsInput caps a window at 31 days. */

export type SlotWindow = { from: string; days: number };

/** One page of the week list: seven viewer-local days from `from`. */
export const PAGE_DAYS = 7;

/** The first fetch after a service (or person) is settled spans four
    weeks, so a booked-out fortnight is skipped in one round trip instead
    of a "try the next" click per empty page. Within getSlots' 31-day cap. */
export const FIRST_LOOK_DAYS = 4 * PAGE_DAYS;

/** How far the first fetch after a pick looks: four weeks, or the whole
    home window when that is longer (a month), within getSlots' 31-day cap. */
export function firstLookDays(w: SlotWindow): number {
  return Math.min(31, Math.max(FIRST_LOOK_DAYS, w.days));
}

export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday on or before `date` (Monday-first weeks, like monthGrid). */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftDays(date, -dow);
}

const max = (a: string, b: string) => (a > b ? a : b);
const lastOfMonth = (month: string) => shiftDays(firstOfMonth(addMonths(month, 1)), -1);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** The window that holds `day` in this layout — a month never starts
    before today, so the current month fits the 31-day cap from any day. */
export function windowAround(layout: SlotLayout, day: string, today: string): SlotWindow {
  switch (layout) {
    case "week-list": return { from: day, days: PAGE_DAYS };
    case "week-columns": return { from: mondayOf(day), days: PAGE_DAYS };
    case "calendar": {
      const from = max(today, firstOfMonth(monthOf(day)));
      return { from, days: daysBetween(from, lastOfMonth(monthOf(day))) };
    }
    case "next-available": return { from: day, days: FIRST_LOOK_DAYS };
  }
}

export function homeWindow(layout: SlotLayout, today: string): SlotWindow {
  return windowAround(layout, today, today);
}

/** The last day inside the window (inclusive). */
export function windowEnd(w: SlotWindow): string {
  return shiftDays(w.from, w.days - 1);
}

/** The previous / next window, or null when there is none that way — the
    past is never a page. Going back clamps to the home window. */
export function shiftWindow(layout: SlotLayout, w: SlotWindow, dir: -1 | 1, today: string): SlotWindow | null {
  const home = homeWindow(layout, today);
  if (dir === -1 && w.from <= home.from) return null;
  if (layout === "calendar") {
    const month = addMonths(monthOf(w.from), dir);
    return windowAround(layout, firstOfMonth(month), today);
  }
  const step = layout === "next-available" ? FIRST_LOOK_DAYS : PAGE_DAYS;
  const from = dir === 1 ? shiftDays(w.from, step) : max(home.from, shiftDays(w.from, -step));
  return windowAround(layout, from, today);
}

/** Where a first look should open: null to stay in `w` (it has a free
    time, or nothing later does), else the day of the earliest free time
    beyond it. Slots before the window are stale (the server already
    dropped the past) and never pull backwards. */
export function firstDayBeyond(slots: string[], w: SlotWindow, dayOf: (iso: string) => string): string | null {
  const last = windowEnd(w);
  let earliestLater: string | null = null;
  for (const iso of slots) {
    const day = dayOf(iso);
    if (day < w.from) continue;
    if (day <= last) return null;
    if (earliestLater === null || day < earliestLater) earliestLater = day;
  }
  return earliestLater;
}

/** The `public.slots` key for today / tomorrow in the next-available list
    (the caller renders `t(key)`); null for any other day. */
export function relativeDayLabel(day: string, today: string): "today" | "tomorrow" | null {
  if (day === today) return "today";
  if (day === shiftDays(today, 1)) return "tomorrow";
  return null;
}
