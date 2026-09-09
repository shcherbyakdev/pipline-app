// Pure layout and reading rules for the admin timeline (the "tape chart"):
// which bars share a lane row, which stays are in conflict, what a bar can
// say at a given width, and the words on the header. No DB, no clock reads
// (`now` is injected), org-local dates as "YYYY-MM-DD" strings. The pixel
// geometry of a bar stays in timeline-geometry.ts.
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { zonedParts } from "@/features/scheduling/calendar-geometry";
import { formatDurationLabel } from "@/features/rentals/hourly";
import type { UnitsT } from "@/i18n/translator";
import { barSpan, turnoverSpan } from "./timeline-geometry";
import { daysBetween } from "./range";
import type { RangeMode } from "./range";
import type { TimelinePlacement } from "./queries";

type Stay = { id: string; clientName: string; startsAt: Date; endsAt: Date };
type Blackout = { id: string; startDate: string; endDate: string; reason: string | null };

// ---------- lane rows

export type Interval = { id: string; from: number; to: number };

/** A stay as a half-open interval in window columns (may run outside the
    window — the layout only needs relative positions). Nights hand over
    mid-cell: the check-in afternoon to the check-out morning, so
    back-to-back stays touch without overlapping. Days hold whole cells,
    return day included. Hours are the fraction of their day. */
export function stayInterval(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  windowStart: string,
): { from: number; to: number } {
  const s = zonedParts(b.startsAt, timeZone);
  const e = zonedParts(b.endsAt, timeZone);
  const si = daysBetween(windowStart, s.date);
  const ei = daysBetween(windowStart, e.date);
  if (mode === "nights") return { from: si + 0.5, to: ei + 0.5 };
  if (mode === "days") return { from: si, to: ei + 1 };
  return { from: si + s.minutes / 1440, to: ei + e.minutes / 1440 };
}

/** Greedy sub-row assignment: earliest start first, lowest row whose last
    interval has ended. Overlapping bars stack instead of hiding each other
    (the scheduler "stack" layout); rowCount is at least one so an empty
    lane keeps its height. */
export function laneLayout(items: Interval[]): { rows: Map<string, number>; rowCount: number } {
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  const rowEnds: number[] = [];
  const rows = new Map<string, number>();
  for (const it of sorted) {
    let row = rowEnds.findIndex((end) => end <= it.from);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(it.to);
    } else rowEnds[row] = it.to;
    rows.set(it.id, row);
  }
  return { rows, rowCount: Math.max(1, rowEnds.length) };
}

/** S6: which bookings each LANE draws. A stay is on its own unit's lane, and
    on every lane a placement puts it on — the rooms a whole-studio booking
    swallows, the lamps an equipment add-on holds. A placement whose booking
    is not in the feed (scoped away, lapsed) simply has nothing to draw. */
export function staysByLane<T extends { id: string; rentalUnitId: string | null }>(
  bookings: readonly T[],
  placements: readonly TimelinePlacement[],
): Map<string, T[]> {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const out = new Map<string, T[]>();
  const push = (unitId: string, b: T) => {
    const list = out.get(unitId) ?? [];
    if (!list.some((x) => x.id === b.id)) list.push(b);
    out.set(unitId, list);
  };
  for (const b of bookings) if (b.rentalUnitId !== null) push(b.rentalUnitId, b);
  for (const p of placements) {
    const b = byId.get(p.bookingId);
    if (b) push(p.unitId, b);
  }
  return out;
}

// ---------- conflicts

/** The inclusive org-local dates a stay holds its unit for: nights end the
    day before checkout (the guest leaves that morning), days include the
    return day, an hourly booking is its date. */
export function occupiedRange(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
): { start: string; end: string } {
  const start = dateInZone(b.startsAt, timeZone);
  const end = dateInZone(b.endsAt, timeZone);
  if (mode === "nights") return { start, end: end > start ? addDaysISO(end, -1) : start };
  if (mode === "days") return { start, end };
  return { start, end: start };
}

export type Conflict =
  | { kind: "blackout"; blackoutId: string; startDate: string; endDate: string; reason: string | null }
  | { kind: "turnover"; withId: string; withName: string }
  | { kind: "overlap"; withId: string; withName: string };

const datesTouch = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  a.start <= b.end && b.start <= a.end;

/** What the DB's overlap guard cannot refuse after the fact, per stay on
    ONE unit: two stays holding the same day (or the same clock time, for
    hours), a stay checking in while the previous guest's turnover tail is
    still running (flagged on the later stay), and a blackout laid over an
    occupied day. A blackout on the tail alone is not a conflict — cleaning
    can happen on a closed day. */
export function detectConflicts(
  stays: readonly Stay[],
  blackouts: readonly Blackout[],
  mode: RangeMode,
  turnoverDays: number,
  timeZone: string,
): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>();
  const add = (id: string, c: Conflict) => {
    const list = out.get(id);
    if (list) list.push(c);
    else out.set(id, [c]);
  };
  const occ = stays.map((s) => occupiedRange(s, mode, timeZone));
  for (let i = 0; i < stays.length; i++) {
    for (let j = i + 1; j < stays.length; j++) {
      const overlap =
        mode === "hours"
          ? stays[i].startsAt < stays[j].endsAt && stays[j].startsAt < stays[i].endsAt
          : datesTouch(occ[i], occ[j]);
      if (overlap) {
        add(stays[i].id, { kind: "overlap", withId: stays[j].id, withName: stays[j].clientName });
        add(stays[j].id, { kind: "overlap", withId: stays[i].id, withName: stays[i].clientName });
      }
    }
  }
  if (mode !== "hours" && turnoverDays > 0) {
    for (let i = 0; i < stays.length; i++) {
      const tailEnd = addDaysISO(occ[i].end, turnoverDays);
      for (let j = 0; j < stays.length; j++) {
        if (i === j) continue;
        // The later stay only — an overlap is already reported above.
        if (occ[j].start > occ[i].end && occ[j].start <= tailEnd) {
          add(stays[j].id, { kind: "turnover", withId: stays[i].id, withName: stays[i].clientName });
        }
      }
    }
  }
  for (let i = 0; i < stays.length; i++) {
    for (const bl of blackouts) {
      if (datesTouch(occ[i], { start: bl.startDate, end: bl.endDate })) {
        add(stays[i].id, {
          kind: "blackout",
          blackoutId: bl.id,
          startDate: bl.startDate,
          endDate: bl.endDate,
          reason: bl.reason,
        });
      }
    }
  }
  return out;
}

/** How many stays carry a conflict, and the earliest one (the banner's
    "Show" target; ties by id so Show is deterministic). */
export function conflictSummary(
  conflicts: ReadonlyMap<string, Conflict[]>,
  stays: readonly { id: string; startsAt: Date }[],
): { count: number; firstId: string | null } {
  const flagged = stays
    .filter((s) => conflicts.has(s.id))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  return { count: conflicts.size, firstId: flagged[0]?.id ?? null };
}

/** Whether the chart draws anything for a stay in this window — a bar or
    a turnover tail (nights/days), the day itself (hours). The bookings
    fetch reaches back by the widest turnover so tails can be drawn, and
    detectConflicts needs those earlier stays too; but only what is on the
    chart may be counted "in this window" or offered to Show. */
export function stayInWindow(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  turnoverDays: number,
  windowStart: string,
  days: number,
): boolean {
  if (mode === "hours") {
    const idx = daysBetween(windowStart, dateInZone(b.startsAt, timeZone));
    return idx >= 0 && idx < days;
  }
  return (
    barSpan(b, mode, timeZone, windowStart, days) !== null ||
    turnoverSpan(b, mode, timeZone, turnoverDays, windowStart, days) !== null
  );
}

// ---------- what a bar can say

export type LabelDensity = "full" | "name" | "initials";

/** Name and length from 160px (one line, so the length needs its room), the
    name alone from 48px, initials below. */
export function labelDensity(widthPx: number): LabelDensity {
  if (widthPx >= 160) return "full";
  if (widthPx >= 48) return "name";
  return "initials";
}

// `intlLocale` is the Intl tag (INTL_LOCALES[locale]) — every ruler word
// follows the admin's language.
const dayMonthFmt = (intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" });
const monthYearFmt = (intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric", timeZone: "UTC" });
const dayMonthYearFmt = (intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);
/** "20 Apr" for an org-local date string. */
export const dayMonth = (date: string, intlLocale: string) => dayMonthFmt(intlLocale).format(atNoon(date));

/** A bar the window cuts says where it really starts and ends — the dates
    beyond the edge; the lane wraps them in "from …" / "to …". */
export function continuationLabels(
  b: { startsAt: Date; endsAt: Date },
  timeZone: string,
  bar: { clippedLeft: boolean; clippedRight: boolean },
  intlLocale: string,
): { left: string | null; right: string | null } {
  return {
    left: bar.clippedLeft ? dayMonth(dateInZone(b.startsAt, timeZone), intlLocale) : null,
    right: bar.clippedRight ? dayMonth(dateInZone(b.endsAt, timeZone), intlLocale) : null,
  };
}

export type StayPhase = "past" | "current" | "upcoming";

export function stayPhase(b: { startsAt: Date; endsAt: Date }, now: Date): StayPhase {
  if (now >= b.endsAt) return "past";
  if (now >= b.startsAt) return "current";
  return "upcoming";
}

/** "3 nights" · "2 days" · "1 h 30 min". */
export function stayLengthLabel(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  t: UnitsT,
): string {
  if (mode === "hours") {
    return formatDurationLabel(Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000), t);
  }
  const start = dateInZone(b.startsAt, timeZone);
  const end = dateInZone(b.endsAt, timeZone);
  const n = mode === "nights" ? daysBetween(start, end) : daysBetween(start, end) + 1;
  return t(mode === "nights" ? "nights" : "days", { count: n });
}

/** Hourly bookings per window column, in start order; outside the window
    they drop. */
export function hourlyByDay<T extends { startsAt: Date }>(
  bookings: readonly T[],
  timeZone: string,
  windowStart: string,
  days: number,
): Map<number, T[]> {
  const byDay = new Map<number, T[]>();
  const sorted = [...bookings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const b of sorted) {
    const idx = daysBetween(windowStart, dateInZone(b.startsAt, timeZone));
    if (idx < 0 || idx >= days) continue;
    const list = byDay.get(idx);
    if (list) list.push(b);
    else byDay.set(idx, [b]);
  }
  return new Map([...byDay.entries()].sort((a, b) => a[0] - b[0]));
}

// ---------- header words

/** The reference's month strip over the day columns: one band per month. */
export function monthBands(
  days: readonly string[],
  intlLocale: string,
): { label: string; colStart: number; colSpan: number }[] {
  const fmt = monthYearFmt(intlLocale);
  const bands: { label: string; colStart: number; colSpan: number }[] = [];
  days.forEach((d, i) => {
    const key = d.slice(0, 7);
    const last = bands[bands.length - 1];
    if (last && days[i - 1]?.slice(0, 7) === key) last.colSpan += 1;
    else bands.push({ label: fmt.format(atNoon(d)), colStart: i, colSpan: 1 });
  });
  return bands;
}

/** "1 May – 28 May 2027", or both years across a year boundary. */
export function windowLabel(from: string, days: number, intlLocale: string): string {
  const last = addDaysISO(from, days - 1);
  const full = dayMonthYearFmt(intlLocale);
  if (from.slice(0, 4) === last.slice(0, 4)) return `${dayMonth(from, intlLocale)} – ${full.format(atNoon(last))}`;
  return `${full.format(atNoon(from))} – ${full.format(atNoon(last))}`;
}

// ---------- zoom

export const ZOOMS = [14, 28, 56] as const;
export type Zoom = (typeof ZOOMS)[number];

export function parseDays(param: string | undefined): Zoom {
  const n = Number(param);
  return (ZOOMS as readonly number[]).includes(n) ? (n as Zoom) : 28;
}

/** The arrows move half a window, so consecutive views overlap. */
export function shiftDays(days: Zoom): number {
  return days / 2;
}

/** The window opens a little before today — two days at the tight zoom, a
    week otherwise, so guests who checked in last week are still on it. */
export function timelineStart(todayISO: string, days: Zoom): string {
  return addDaysISO(todayISO, days === 14 ? -2 : -7);
}

// ---------- v3: header density

export type HeaderDensity = "weekday" | "number" | "sparse";

/** Weekday and number from 44px, the number alone from 24px; below that a
    day cell is blank unless it is a Monday or today (the rule at each Monday
    still marks the weeks). */
export function headerDensity(cellPx: number): HeaderDensity {
  if (cellPx >= 44) return "weekday";
  if (cellPx >= 24) return "number";
  return "sparse";
}

export function showsDayNumber(date: string, density: HeaderDensity, today: string | null): boolean {
  if (density !== "sparse") return true;
  return date === today || atNoon(date).getUTCDay() === 1;
}

// ---------- v3: the free-units row

/** The window columns one unit is NOT free on: its occupied days, the
    turnover tail after each stay, and its blackouts. Nights/days only — an
    hourly unit is "free" for the rest of the day whatever is booked. */
export function takenColumns(
  stays: readonly { startsAt: Date; endsAt: Date }[],
  blackouts: readonly { startDate: string; endDate: string }[],
  mode: RangeMode,
  turnoverDays: number,
  timeZone: string,
  windowStart: string,
  days: number,
): Set<number> {
  const taken = new Set<number>();
  const mark = (start: string, end: string) => {
    const from = Math.max(0, daysBetween(windowStart, start));
    const to = Math.min(days - 1, daysBetween(windowStart, end));
    for (let i = from; i <= to; i++) taken.add(i);
  };
  for (const s of stays) {
    const occ = occupiedRange(s, mode, timeZone);
    mark(occ.start, addDaysISO(occ.end, turnoverDays));
  }
  for (const b of blackouts) mark(b.startDate, b.endDate);
  return taken;
}

/** Per column, how many of the group's units nobody holds. */
export function freeUnitsPerDay(takenPerUnit: readonly Set<number>[], days: number): number[] {
  return Array.from({ length: days }, (_, i) => takenPerUnit.filter((t) => !t.has(i)).length);
}

// ---------- v3: drag maths

/** Pointer travel to whole columns and lanes, nearest wins. An unmeasured
    column (0px) moves nothing. */
export function dragDelta(dx: number, dy: number, cellPx: number, rowPx: number): { days: number; rows: number } {
  return {
    days: cellPx > 0 ? Math.round(dx / cellPx) : 0,
    rows: rowPx > 0 ? Math.round(dy / rowPx) : 0,
  };
}

export type DragEdge = "move" | "start" | "end";

/** The dates a nights/days stay lands on after dragging its body or one of
    its edges by `dayDelta` columns. Null when an edge drag would leave less
    than a night (nights) or a day (days) — the bar just refuses to shrink
    further. */
export function movedRange(
  b: { startsAt: Date; endsAt: Date },
  mode: RangeMode,
  timeZone: string,
  dayDelta: number,
  edge: DragEdge,
): { startDate: string; endDate: string } | null {
  const start = dateInZone(b.startsAt, timeZone);
  const end = dateInZone(b.endsAt, timeZone);
  const startDate = edge === "end" ? start : addDaysISO(start, dayDelta);
  const endDate = edge === "start" ? end : addDaysISO(end, dayDelta);
  const min = mode === "nights" ? 1 : 0;
  if (daysBetween(startDate, endDate) < min) return null;
  return { startDate, endDate };
}

/** An hourly booking dragged `dayDelta` columns keeps its wall time. */
export function movedInstant(b: { startsAt: Date }, timeZone: string, dayDelta: number): Date {
  const p = zonedParts(b.startsAt, timeZone);
  const date = addDaysISO(p.date, dayDelta);
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, "0");
  const mm = String(p.minutes % 60).padStart(2, "0");
  return wallTimeToUtc(date, `${hh}:${mm}`, timeZone);
}

const CANDIDATE = "__candidate";

/** Whether a stay dropped at `candidate` would clash with the lane's other
    stays or blackouts — the same rules the board rings after the fact
    (detectConflicts), asked before the drop: "hard" for an overlap or a
    blackout, "turnover" when either party's tail runs into the other's
    check-in, null when the run is clean. */
export function moveConflict(
  candidate: { startsAt: Date; endsAt: Date },
  others: readonly Stay[],
  blackouts: readonly Blackout[],
  mode: RangeMode,
  turnoverDays: number,
  timeZone: string,
): "hard" | "turnover" | null {
  const found = detectConflicts(
    [{ id: CANDIDATE, clientName: "", ...candidate }, ...others],
    blackouts,
    mode,
    turnoverDays,
    timeZone,
  );
  let worst: "hard" | "turnover" | null = null;
  for (const [id, list] of found) {
    for (const c of list) {
      if (id !== CANDIDATE && !("withId" in c && c.withId === CANDIDATE)) continue;
      if (c.kind !== "turnover") return "hard";
      worst = "turnover";
    }
  }
  return worst;
}

// ---------- v3: hourly chips

export type ChipDensity = "full" | "time" | "hour" | "none";

/** Time and name from 96px, the time from 56px, the hour from 28px. */
export function chipDensity(widthPx: number): ChipDensity {
  if (widthPx >= 96) return "full";
  if (widthPx >= 56) return "time";
  if (widthPx >= 28) return "hour";
  return "none";
}

// ---------- v3: links

/** The timeline at a zoom and a start, scope kept. The default zoom writes
    no param, so the plain Timeline link stays clean. */
export function timelineHref(days: Zoom, from: string, scopeSuffix: string): string {
  return `/bookings?view=timeline${days === 28 ? "" : `&days=${days}`}${scopeSuffix}&from=${from}`;
}

/** The next zoom step in (negative) or out (positive), clamped. */
export function zoomStep(days: Zoom, direction: -1 | 1): Zoom {
  const i = ZOOMS.indexOf(days);
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + direction))];
}
