import { addDaysISO } from "@/features/scheduling/slots";
import { validateStay, type RangeAvailability, type RangeOffering } from "./range";

/* The "Next free stays" template (widget templates spec §8): the soonest
   windows that fit the minimum stay, one per free start day, so a visitor
   who just wants "the next weekend" taps once. Pure: derived from the
   range availability the picker already has, with the same validateStay
   the calendar uses — anything listed here is bookable as is. */
export type FreeStay = { start: string; end: string; length: number };

/** The lengths a visitor may ask for: the minimum up to the maximum (or a
    week beyond the minimum when there is none), at most eight — the
    hourly flow's pill budget. */
export function stayLengthOptions(o: { minStay: number; maxStay: number | null }, max = 8): number[] {
  const min = Math.max(1, o.minStay);
  const top = Math.min(o.maxStay ?? min + max - 1, min + max - 1);
  return Array.from({ length: Math.max(0, top - min + 1) }, (_, i) => min + i);
}

/** Free windows of `length` nights/days (the minimum stay by default),
    one per free start day. */
export function nextFreeStays(offering: RangeOffering, availability: RangeAvailability, limit: number, length = Math.max(1, offering.minStay)): FreeStay[] {
  const out: FreeStay[] = [];
  // Nights: N nights end N days after check-in. Days: N days end on the Nth day.
  const endFor = (start: string) => addDaysISO(start, offering.rangeMode === "nights" ? length : length - 1);
  const days = Object.keys(availability.dates).sort();
  for (const start of days) {
    if (out.length >= limit) break;
    if (start < availability.notBefore || start > availability.notAfter) continue;
    if ((availability.dates[start]?.free ?? 0) === 0) continue;
    const end = endFor(start);
    if (validateStay(offering, availability, start, end).ok) out.push({ start, end, length });
  }
  return out;
}
