// Which rental offerings the Bookings page's "New rental booking" button
// lets the provider pick. Every active offering, whatever its range mode:
// the dialog it opens (NewRentalBookingDialog) already branches on
// nights/days vs hours per offering, so a mixed org — whose front door is
// the week view, not the timeline — must not be shown an hourly-only list
// with no hint that its nightly rentals exist (the H2 Task-10 wart).
export function walkInOfferings<T extends { active: boolean }>(offerings: T[]): T[] {
  return offerings.filter((o) => o.active);
}
