import type { SlotWindow } from "@/features/scheduling/slot-paging";
import { windowEnd } from "@/features/scheduling/slot-paging";

/* Shared by the calendar, week-columns and next-available layouts: the
   window's slots grouped by the VIEWER's local day (a late-evening slot in
   the viewer's zone must appear under the day they'd call it), plus the
   label rules TimeSlotGrid (the week list) keeps for itself. */

export const viewerDayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
export const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
export const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const tzShortFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

/** Only the window's viewer-local days: the server pads its window a day
    each side so no day is missed across the org/viewer offset. */
export function groupByViewerDay(slots: string[], w: SlotWindow): Map<string, string[]> {
  const last = windowEnd(w);
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = viewerDayKey.format(new Date(s));
    if (day < w.from || day > last) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  return byDay;
}

/** A DST fall-back day shows the same HH:MM twice (02:00 CEST, 02:00 CET);
    disambiguate those labels with the zone name, and only those. */
export function timeLabel(iso: string, daySlots: string[]): string {
  const base = timeFmt.format(new Date(iso));
  const dup = daySlots.some((o) => o !== iso && timeFmt.format(new Date(o)) === base);
  return dup ? `${base} ${tzShortFmt.format(new Date(iso)).split(" ").pop()}` : base;
}
