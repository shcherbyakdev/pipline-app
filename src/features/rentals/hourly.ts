// Pure helpers for hourly-mode rentals (H2) — no DB, no clock reads. Mirrors
// the doctrine of slots.ts / range.ts: date-math primitives only, `now`
// injected by the caller.
import type { UnitsT } from "@/i18n/translator";
import {
  wallTimeToUtc,
  addDaysISO,
  unionSlots,
  type SlotService,
  type BusyInterval,
} from "@/features/scheduling/slots";
import type { PublicOffering } from "@/lib/booking/public";

export type HourlyOffering = PublicOffering & {
  slotIncrementMin: number;
  minDurationMin: number;
  maxDurationMin: number;
};

export function isHourlyOffering(o: PublicOffering): o is HourlyOffering {
  return (
    o.rangeMode === "hours" &&
    o.slotIncrementMin !== null &&
    o.minDurationMin !== null &&
    o.maxDurationMin !== null
  );
}

// Narrowed to just the grid fields (not the full HourlyOffering) so a
// caller that only has an offering's admin listing row (dashboard select
// options, before any engine context is loaded) can compute the grid
// without first assembling a whole PublicOffering.
export function durationOptions(
  o: Pick<HourlyOffering, "minDurationMin" | "maxDurationMin" | "slotIncrementMin">,
): number[] {
  const out: number[] = [];
  for (let d = o.minDurationMin; d <= o.maxDurationMin; d += o.slotIncrementMin) out.push(d);
  return out;
}

export function hourlySlotService(o: HourlyOffering, durationMin: number): SlotService {
  return {
    id: o.id,
    durationMin,
    bufferBeforeMin: 0,
    bufferAfterMin: o.turnoverMin,
    minNoticeMin: o.minNoticeMin,
    maxPerDay: null,
    bookingWindowDays: o.bookingWindowDays,
    stepMin: o.slotIncrementMin,
    // Turnover is cleanup between bookings, not sellable time — a session
    // may end exactly at closing with its turnover tail past it (Finding 1).
    allowTailOverflow: true,
  };
}

// A date-range blackout occupies its org-local days wholesale.
export function blackoutBusy(
  blackouts: { unitId: string; startDate: string; endDate: string }[],
  timeZone: string,
): Map<string, BusyInterval[]> {
  const map = new Map<string, BusyInterval[]>();
  for (const b of blackouts) {
    const startsAt = wallTimeToUtc(b.startDate, "00:00", timeZone);
    const endsAt = wallTimeToUtc(addDaysISO(b.endDate, 1), "00:00", timeZone);
    (map.get(b.unitId) ?? map.set(b.unitId, []).get(b.unitId)!).push({ startsAt, endsAt });
  }
  return map;
}

export function unionUnitSlots(
  perUnit: { unitId: string; slots: Date[] }[],
): { startsAt: Date; unitIds: string[] }[] {
  // unionSlots (slots.ts) is keyed on `staffId`; the shape is identical.
  return unionSlots(perUnit.map((u) => ({ staffId: u.unitId, slots: u.slots }))).map((s) => ({
    startsAt: s.startsAt,
    unitIds: s.staffIds,
  }));
}

/** How many of these units have no busy interval overlapping [startsAt, endsAt).
    Touching edges are free (half-open ranges, like the EXCLUDE's tstzrange). */
export function freeUnitsAt(
  units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[],
  startsAt: Date,
  endsAt: Date,
): number {
  const s = startsAt.getTime();
  const e = endsAt.getTime();
  return units.filter((u) => !u.busy.some((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s)).length;
}

export function formatDurationLabel(min: number, t: UnitsT): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? t("minutes", { count: m }) : m === 0 ? t("hoursShort", { count: h }) : t("hoursMinutes", { hours: h, minutes: m });
}
