// Pure day-window math for the admin calendar. Mirrors the slot engine's
// COARSE semantics (slots.ts): closed exception kills the day; open
// exceptions REPLACE the weekday rules; otherwise the rules apply.

export type DayWindow = { startTime: string; endTime: string };

const MIN_FRAGMENT_MIN = 5;

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// The org-local date's weekday is a property of the date itself (slots.ts idiom).
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function effectiveWindows(
  date: string,
  rules: Array<{ weekday: number; startTime: string; endTime: string }>,
  exceptions: Array<{ date: string; closed: boolean; startTime: string | null; endTime: string | null }>,
): DayWindow[] {
  const dayExceptions = exceptions.filter((e) => e.date === date);
  if (dayExceptions.some((e) => e.closed)) return [];
  const overrides = dayExceptions.filter((e) => !e.closed);
  const windows =
    overrides.length > 0
      ? overrides.map((e) => ({ startTime: e.startTime!, endTime: e.endTime! }))
      : rules
          .filter((r) => r.weekday === weekdayOf(date))
          .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
  return windows.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function subtractRange(windows: DayWindow[], start: string, end: string): DayWindow[] {
  const out: DayWindow[] = [];
  for (const w of windows) {
    if (end <= w.startTime || start >= w.endTime) {
      out.push(w);
      continue;
    }
    if (start > w.startTime && toMin(start) - toMin(w.startTime) >= MIN_FRAGMENT_MIN) {
      out.push({ startTime: w.startTime, endTime: start });
    }
    if (end < w.endTime && toMin(w.endTime) - toMin(end) >= MIN_FRAGMENT_MIN) {
      out.push({ startTime: end, endTime: w.endTime });
    }
  }
  return out;
}
