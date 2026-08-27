/* Page arithmetic for the public widget's time grid. Days are the VIEWER's
   local YYYY-MM-DD (the widget groups slots by the day the visitor would
   call them); `dayOf` is injected so this stays pure and zone-free. */

/** One page of the grid: seven viewer-local days from `fromDate`. */
export const PAGE_DAYS = 7;

/** The first fetch after a service (or person) is settled spans four pages,
    so a booked-out fortnight is skipped in one round trip instead of a
    "try the next week" click per empty page. getSlotsInput caps `days` at
    31. */
export const FIRST_LOOK_DAYS = 4 * PAGE_DAYS;

export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Where the grid should open after a first look: null to stay on the page
    at `fromDate` (it has a free time, or nothing later does), else the day
    of the earliest free time beyond that page. Slots before the page are
    stale (the server already dropped the past) and never pull backwards. */
export function firstPageWithSlots(slots: string[], fromDate: string, dayOf: (iso: string) => string): string | null {
  const lastDay = shiftDays(fromDate, PAGE_DAYS - 1);
  let earliestLater: string | null = null;
  for (const iso of slots) {
    const day = dayOf(iso);
    if (day < fromDate) continue;
    if (day <= lastDay) return null;
    if (earliestLater === null || day < earliestLater) earliestLater = day;
  }
  return earliestLater;
}
