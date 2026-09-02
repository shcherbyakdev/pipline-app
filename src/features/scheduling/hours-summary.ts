/* One line that says when a space is open (admin IA spec §3): the space
   detail page shows this instead of a second hours editor. Pure. Times are
   org-local wall-clock strings as stored ("HH:MM", or "HH:MM:SS" straight
   off PostgREST) — rendered 24-hour without the leading zero, which is
   what the spec's example shows and what every locale reads. */
import type { Translator } from "@/i18n/translator";

export type RuleLike = { weekday: number; startTime: string; endTime: string };

// Monday-first, like the editor. The words come from `availability`
// (weekdaysShort, Sunday first like `weekday`; noHours), so the caller hands
// in that translator.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function short(t: string): string {
  return `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`;
}

/** "Mon–Fri 9:00–17:00 · Sat 10:00–14:00": consecutive weekdays with
    identical windows collapse into a range, several windows in a day are
    joined with ", ", days without hours are skipped (and break a run). */
export function summarizeWeekly(rules: readonly RuleLike[], t: Translator<"availability">): string {
  const weekdayShort = t("weekdaysShort").split(" ");
  const byDay = new Map<number, string>();
  for (const day of WEEKDAY_ORDER) {
    const windows = rules
      .filter((r) => r.weekday === day)
      .map((r) => ({ start: r.startTime, end: r.endTime }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    if (windows.length > 0) byDay.set(day, windows.map((x) => `${short(x.start)}–${short(x.end)}`).join(", "));
  }
  if (byDay.size === 0) return t("noHours");

  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAY_ORDER.length) {
    const text = byDay.get(WEEKDAY_ORDER[i]);
    if (text === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < WEEKDAY_ORDER.length && byDay.get(WEEKDAY_ORDER[j + 1]) === text) j++;
    const from = weekdayShort[WEEKDAY_ORDER[i]];
    const to = weekdayShort[WEEKDAY_ORDER[j]];
    parts.push(`${j === i ? from : `${from}–${to}`} ${text}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
