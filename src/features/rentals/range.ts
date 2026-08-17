// Pure date-range availability engine for rentals — no DB, no clock reads
// (`now` injected; slots.ts convention). Dates are org-local "YYYY-MM-DD".
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";

export type RangeMode = "nights" | "days";
export type RangeOffering = { rangeMode: RangeMode; minStay: number; maxStay: number | null; turnoverDays: number; minNoticeDays: number; bookingWindowDays: number };
export type RangeUnit = { id: string; sortOrder: number };
export type RangeBlackout = { unitId: string; startDate: string; endDate: string };
export type RangeBooking = { unitId: string; startsAt: Date; endsAt: Date };
export type RangeInput = { offering: RangeOffering; units: RangeUnit[]; blackouts: RangeBlackout[]; bookings: RangeBooking[]; timeZone: string; now: Date; fromDate: string; days: number };
export type DayAvailability = { free: number; unitIds: string[] };
export type RangeAvailability = { dates: Record<string, DayAvailability>; notBefore: string; notAfter: string };
export type StayValidation = { ok: true; unitIds: string[] } | { ok: false; reason: "order" | "min_stay" | "max_stay" | "window" | "unavailable" };

const DAY = 86_400_000;
const utc = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };

export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY);
}
export function stayLength(mode: RangeMode, start: string, end: string): number {
  return mode === "nights" ? daysBetween(start, end) : daysBetween(start, end) + 1;
}
export function occupiedDates(mode: RangeMode, start: string, end: string) {
  return { start, end: mode === "nights" ? addDaysISO(end, -1) : end };
}
function* eachDate(start: string, end: string): Generator<string> {
  for (let d = start; d <= end; d = addDaysISO(d, 1)) yield d;
}

export function computeRangeAvailability(input: RangeInput): RangeAvailability {
  const { offering, units, blackouts, bookings, timeZone, now, fromDate, days } = input;
  const today = dateInZone(now, timeZone);
  const notBefore = addDaysISO(today, offering.minNoticeDays);
  const notAfter = addDaysISO(today, offering.bookingWindowDays);
  const occupied = new Map<string, Set<string>>(units.map((u) => [u.id, new Set()]));
  const mark = (unitId: string, start: string, end: string) => {
    const set = occupied.get(unitId);
    if (!set) return;
    for (const d of eachDate(start, end)) set.add(d);
  };
  for (const b of blackouts) mark(b.unitId, b.startDate, b.endDate);
  for (const b of bookings) {
    const occ = occupiedDates(offering.rangeMode, dateInZone(b.startsAt, timeZone), dateInZone(b.endsAt, timeZone));
    mark(b.unitId, occ.start, addDaysISO(occ.end, offering.turnoverDays));
  }
  const ordered = [...units].sort((a, b) => a.sortOrder - b.sortOrder);
  const dates: Record<string, DayAvailability> = {};
  for (let i = 0; i < days; i++) {
    const d = addDaysISO(fromDate, i);
    if (d < notBefore || d > notAfter) { dates[d] = { free: 0, unitIds: [] }; continue; }
    const unitIds = ordered.filter((u) => !occupied.get(u.id)!.has(d)).map((u) => u.id);
    dates[d] = { free: unitIds.length, unitIds };
  }
  return { dates, notBefore, notAfter };
}

export function validateStay(offering: RangeOffering, availability: RangeAvailability, start: string, end: string): StayValidation {
  const orderOk = offering.rangeMode === "nights" ? end > start : end >= start;
  if (!orderOk) return { ok: false, reason: "order" };
  const len = stayLength(offering.rangeMode, start, end);
  if (len < offering.minStay) return { ok: false, reason: "min_stay" };
  if (offering.maxStay !== null && len > offering.maxStay) return { ok: false, reason: "max_stay" };
  if (start < availability.notBefore || end > availability.notAfter) return { ok: false, reason: "window" };
  const occ = occupiedDates(offering.rangeMode, start, end);
  // Note: turnover days past notAfter are marked free:0 by computeRangeAvailability,
  // so a stay ending exactly at the window edge with turnover > 0 fails as
  // "unavailable" rather than "window". This is the spec's conservative rule — keep it.
  const last = addDaysISO(occ.end, offering.turnoverDays);
  let candidates: string[] | null = null;
  for (const d of eachDate(occ.start, last)) {
    const day = availability.dates[d];
    if (!day) return { ok: false, reason: "unavailable" };
    candidates = candidates === null ? [...day.unitIds] : candidates.filter((id) => day.unitIds.includes(id));
    if (candidates.length === 0) return { ok: false, reason: "unavailable" };
  }
  return { ok: true, unitIds: candidates ?? [] };
}
