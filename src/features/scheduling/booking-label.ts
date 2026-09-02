// One place that turns a booking row into its human title. Appointments
// carry a service, rentals carry offering+unit (0037's `bookings_kind`
// CHECK makes it exactly one of the two); the SQL side spells the same
// rule as `coalesce(s.name, ro.name || ' · ' || u.name)` in
// resolve_booking_token / cancel_booking.
export type BookingKindRow = {
  services?: { name: string } | null;
  rental_offerings?: { name: string } | null;
  rental_units?: { name: string } | null;
};

/** `fallback` is the word for a row naming neither (unreachable under the
    CHECK, kept for the type): admin surfaces pass `bookings.fallbackTitle`,
    mails `emails.appointment` — in their own language. */
export function bookingTitle(row: BookingKindRow, fallback = "Appointment"): string {
  return (
    row.services?.name ??
    (row.rental_offerings && row.rental_units
      ? `${row.rental_offerings.name} · ${row.rental_units.name}`
      : fallback)
  );
}

/** bookings.status.* key for a DB status; unknown statuses render as-is. */
export const STATUS_KEY = {
  confirmed: "confirmed",
  pending: "pending",
  declined: "declined",
  cancelled_by_client: "cancelledByClient",
  cancelled_by_provider: "cancelledByProvider",
  rescheduled: "rescheduled",
} as const;

export function statusKey(status: string): (typeof STATUS_KEY)[keyof typeof STATUS_KEY] | null {
  return status in STATUS_KEY ? STATUS_KEY[status as keyof typeof STATUS_KEY] : null;
}
