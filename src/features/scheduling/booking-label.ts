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

export function bookingTitle(row: BookingKindRow): string {
  return (
    row.services?.name ??
    (row.rental_offerings && row.rental_units
      ? `${row.rental_offerings.name} · ${row.rental_units.name}`
      : "Appointment")
  );
}
