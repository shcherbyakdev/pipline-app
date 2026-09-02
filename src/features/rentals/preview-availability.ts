import type { RangeAvailability } from "./range";

/* Canned range availability for the admin's live previews (the stays
   templates in the studio starter and the Website embed preview): three
   far-future months, every day free but a few booked ones, so a month grid,
   two months, the fields and the next-free list all have something to show
   and nothing ever needs refreshing (preview-services.ts's precedent). */
function build(from: string, days: number, booked: string[]): RangeAvailability {
  const dates: RangeAvailability["dates"] = {};
  const start = Date.parse(`${from}T00:00:00Z`);
  let last = from;
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    dates[d] = booked.includes(d) ? { free: 0, unitIds: [] } : { free: 1, unitIds: ["preview-unit"] };
    last = d;
  }
  return { dates, notBefore: from, notAfter: last };
}

export const PREVIEW_AVAILABILITY: RangeAvailability = build("2030-01-01", 90, [
  "2030-01-03", "2030-01-04", "2030-01-10", "2030-01-11", "2030-01-18", "2030-01-24", "2030-01-25",
  "2030-02-07", "2030-02-08", "2030-02-14", "2030-02-21", "2030-02-22",
]);
