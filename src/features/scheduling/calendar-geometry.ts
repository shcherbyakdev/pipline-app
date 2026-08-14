// Pure geometry/formatting for the admin week calendar. No DOM, no clock
// reads — everything injected, like slots.ts.
import type { DayWindow } from "./day-windows";

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// What org-local date + minutes-since-midnight does `instant` land on?
// (Intl formatToParts idiom from slots.ts.)
export function zonedParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function mondayOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun
  const back = (wd + 6) % 7; // Mon→0 … Sun→6
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) - back * 86_400_000).toISOString().slice(0, 10);
}

export function hourRange(windowsByDay: DayWindow[][]): { startHour: number; endHour: number } {
  const all = windowsByDay.flat();
  if (all.length === 0) return { startHour: 8, endHour: 18 };
  const min = Math.min(...all.map((w) => timeToMin(w.startTime)));
  const max = Math.max(...all.map((w) => timeToMin(w.endTime)));
  return {
    startHour: Math.max(0, Math.floor(min / 60) - 1),
    endHour: Math.min(24, Math.ceil(max / 60) + 1),
  };
}

export function snap15(min: number): number {
  return Math.floor(min / 15) * 15;
}

export function closedIntervals(
  windows: DayWindow[],
  startHour: number,
  endHour: number,
): Array<{ startMin: number; endMin: number }> {
  const out: Array<{ startMin: number; endMin: number }> = [];
  let cursor = startHour * 60;
  const end = endHour * 60;
  for (const w of windows) {
    const ws = timeToMin(w.startTime);
    const we = timeToMin(w.endTime);
    if (ws > cursor) out.push({ startMin: cursor, endMin: Math.min(ws, end) });
    cursor = Math.max(cursor, we);
  }
  if (cursor < end) out.push({ startMin: cursor, endMin: end });
  return out.filter((i) => i.startMin < i.endMin);
}

// Stable accent per service — golden-angle hue walk over a hash, avoiding
// a color-settings surface (spec).
export function serviceAccent(serviceId: string): string {
  let h = 0;
  for (let i = 0; i < serviceId.length; i++) h = (h * 31 + serviceId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}
