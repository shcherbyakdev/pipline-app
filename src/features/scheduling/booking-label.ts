import { withUnit } from "@/features/rentals/unit-label";

// One place that turns a booking row into its human title. Appointments
// carry a service, rentals carry offering+unit (0037's `bookings_kind`
// CHECK makes it exactly one of the two) — minus a unit named after its
// space, which a single-unit space's is (rentals/actions.ts). The SQL side
// still spells the older `coalesce(s.name, ro.name || ' · ' || u.name)` in
// resolve_booking_token / cancel_booking and the reminder/staff queries;
// aligning those is a migration of its own.
export type BookingKindRow = {
  services?: { name: string } | null;
  rental_offerings?: { name: string } | null;
  rental_units?: { name: string } | null;
};

/** `fallback` is the word for a row naming neither (unreachable under the
    CHECK, kept for the type): admin surfaces pass `bookings.fallbackTitle`,
    mails `emails.appointment` — in their own language. */
export function bookingTitle(row: BookingKindRow, fallback: string): string {
  return (
    row.services?.name ??
    (row.rental_offerings && row.rental_units
      ? withUnit(row.rental_offerings.name, row.rental_units.name)
      : fallback)
  );
}

/** bookings.status.* key for a DB status; unknown statuses render as-is. */
export const STATUS_KEY = {
  confirmed: "confirmed",
  pending: "pending",
  // S2 (0079): a hold and the row the drain released when it lapsed. The
  // detail pages (team, service, space, client) list both.
  pending_payment: "pendingPayment",
  expired: "expired",
  declined: "declined",
  cancelled_by_client: "cancelledByClient",
  cancelled_by_provider: "cancelledByProvider",
  rescheduled: "rescheduled",
} as const;

export function statusKey(status: string): (typeof STATUS_KEY)[keyof typeof STATUS_KEY] | null {
  return status in STATUS_KEY ? STATUS_KEY[status as keyof typeof STATUS_KEY] : null;
}
