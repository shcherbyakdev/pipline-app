import type { AdminBooking } from "@/features/scheduling/queries";

/* A narrowing staff filter is a lens on a person's work (H2 ruling): only
   their appointments stay. A space booking is nobody's work, so it drops
   out — but the count comes back so the toolbar can say so instead of
   silently deleting rows (admin IA spec §2, ruling 6). No lens (undefined)
   means the "everyone" week: everything stays. */
export function applyStaffLens(
  bookings: AdminBooking[],
  staffIds: string[] | undefined,
): { visible: AdminBooking[]; hiddenSpaces: number } {
  if (staffIds === undefined) return { visible: bookings, hiddenSpaces: 0 };
  const ids = new Set(staffIds);
  const visible: AdminBooking[] = [];
  let hiddenSpaces = 0;
  for (const b of bookings) {
    if (b.rentalUnitId !== null) {
      hiddenSpaces += 1;
      continue;
    }
    if (b.staffId !== null && ids.has(b.staffId)) visible.push(b);
  }
  return { visible, hiddenSpaces };
}
