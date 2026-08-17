// Pure time helpers for the availability editor. All times are org-local
// wall-clock "HH:MM" strings (the storage format, see 0026's format CHECK);
// minutes-since-midnight exists only inside this module.

export type Interval = { startTime: string; endTime: string };

const DAY_END = "23:59";

function toMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function toHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => toHM(i * 15));

// End-time box options: strictly after `start`, plus 23:59 as the
// end-of-day terminator (Calendly behavior).
export function endOptions(start: string): string[] {
  return [...TIME_OPTIONS.filter((t) => t > start), DAY_END];
}

// Lenient parser for typed input → canonical "HH:MM" | null.
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3];
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) return null;
  return toHM(hour * 60 + minute);
}

// Locale-aware display. Components call it without `locale` (browser
// default); tests pass one explicitly to stay deterministic.
export function formatTime(hm: string, locale?: string): string {
  const d = new Date(Date.UTC(2000, 0, 1, Number(hm.slice(0, 2)), Number(hm.slice(3, 5))));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

// The `+` button's default (spec): empty day → 09:00–17:00; else start =
// last end + 1h (drop the gap if nothing would fit), end = start + 4h,
// clamped to 23:59. null = nothing fits → the button disables.
export function nextInterval(existing: Interval[]): Interval | null {
  if (existing.length === 0) return { startTime: "09:00", endTime: "17:00" };
  const lastEnd = Math.max(...existing.map((i) => toMin(i.endTime)));
  const dayEnd = toMin(DAY_END);
  let start = lastEnd + 60;
  if (start + 15 > dayEnd) start = lastEnd;
  if (start + 15 > dayEnd) return null;
  return { startTime: toHM(start), endTime: toHM(Math.min(start + 240, dayEnd)) };
}

// Overlap checks: half-open intervals, touching allowed.
export function overlapsSiblings(candidate: Interval, siblings: Interval[]): boolean {
  const s = toMin(candidate.startTime);
  const e = toMin(candidate.endTime);
  return siblings.some((o) => s < toMin(o.endTime) && toMin(o.startTime) < e);
}

export function hasOverlap(intervals: Interval[]): boolean {
  const sorted = [...intervals].sort((a, b) => a.startTime.localeCompare(b.startTime));
  let maxEnd = "";
  for (const cur of sorted) {
    if (maxEnd && cur.startTime < maxEnd) return true;
    if (cur.endTime > maxEnd) maxEnd = cur.endTime;
  }
  return false;
}
