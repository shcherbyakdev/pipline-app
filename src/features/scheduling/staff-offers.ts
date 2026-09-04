/* Who takes what (2026-09-04). The page's Team section is a picker: choosing
   a person narrows the widget's service list to theirs, and that choice
   survives picking one. Both questions are this one rule. */

/** Absent map = every person takes every service (the widget's own contract
    for `serviceStaffIds`). */
export function staffOffers(
  serviceStaffIds: Record<string, string[]> | undefined,
  serviceId: string,
  staffId: string,
): boolean {
  return serviceStaffIds ? (serviceStaffIds[serviceId] ?? []).includes(staffId) : true;
}
