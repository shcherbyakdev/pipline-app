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
export function weekdayOf(date: string): number {
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

function toTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Canonical form: sorted, with overlapping/adjacent windows merged.
export function mergeWindows(windows: DayWindow[]): DayWindow[] {
  const intervals = windows
    .map((w) => [toMin(w.startTime), toMin(w.endTime)])
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.map(([s, e]) => ({ startTime: toTime(s), endTime: toTime(e) }));
}

// Inverse of subtractRange: open [start,end) on top of the given windows,
// merging overlapping/adjacent windows into a canonical sorted list.
export function addRange(windows: DayWindow[], start: string, end: string): DayWindow[] {
  return mergeWindows([...windows, { startTime: start, endTime: end }]);
}

export type StaffAvailability = {
  rules: Array<{ weekday: number; startTime: string; endTime: string }>;
  exceptions: Array<{ date: string; closed: boolean; startTime: string | null; endTime: string | null }>;
};

// Team (multi-staff): "someone is open" for a date. Each person's day is
// resolved on its own (their rules, their overrides) and the results are
// unioned — pooling everyone's rows into ONE effectiveWindows call would let
// one person's closed day empty the whole column, and one person's open
// override replace everybody else's hours.
export function unionWindows(date: string, perStaff: StaffAvailability[]): DayWindow[] {
  return mergeWindows(perStaff.flatMap((p) => effectiveWindows(date, p.rules, p.exceptions)));
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
