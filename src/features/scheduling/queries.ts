import { createClient } from "@/lib/supabase/server";
import { type StatsBookingRow } from "./stats";
import { bookingTitle } from "./booking-label";
import type { RangeMode } from "@/features/rentals/range";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceLabel: string | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
  active: boolean;
  requiresApproval: boolean;
  sortOrder: number;
  /** Team (multi-staff): who can be booked for this service (0040
      `service_staff`). Includes deactivated people — their link survives a
      deactivation so it is still there when they come back. */
  staffIds: string[];
};

export async function listServices(): Promise<ServiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, active, requires_approval, sort_order, service_staff(staff_id)",
    )
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.duration_min,
    priceLabel: s.price_label,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    minNoticeMin: s.min_notice_min,
    maxPerDay: s.max_per_day,
    bookingWindowDays: s.booking_window_days,
    active: s.active,
    requiresApproval: s.requires_approval,
    sortOrder: s.sort_order,
    staffIds: ((s.service_staff ?? []) as { staff_id: string }[]).map((l) => l.staff_id),
  }));
}

export type RuleRow = { id: string; weekday: number; startTime: string; endTime: string };
export type ExceptionRow = {
  id: string;
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
};

/** One person's hours and upcoming overrides. Team (multi-staff): availability
    is per staff (0040/0041), so the caller must say whose — the availability
    editor from its `?staff=` tab, other admin surfaces from
    `firstActiveStaffId()`.

    `fromDate` is the first override date to keep (YYYY-MM-DD) — pass the
    org-local today (`dateInZone(new Date(), timezone)`): exception dates are
    org-local, and a UTC "today" drops this evening's override for anyone
    east of Greenwich once UTC has rolled over. Defaults to UTC only so a
    caller without a timezone in hand still gets a sane list. */
export async function getAvailabilityAdmin(
  staffId: string,
  fromDate: string = new Date().toISOString().slice(0, 10),
): Promise<{
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}> {
  const supabase = await createClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time")
      .eq("staff_id", staffId)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("availability_exceptions")
      .select("id, date, closed, start_time, end_time")
      .eq("staff_id", staffId)
      .gte("date", fromDate)
      .order("date"),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      id: e.id,
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}

/** Offering twin of `getAvailabilityAdmin` (H2, hourly mode) — same two
    selects, `rental_offering_id`-scoped instead of `staff_id`-scoped, same
    row mapping. Authenticated client, RLS-scoped: the offering must belong
    to an org the caller is a member of, same as every other admin query
    here. */
export async function getOfferingAvailabilityAdmin(
  offeringId: string,
  fromDate: string = new Date().toISOString().slice(0, 10),
): Promise<{
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}> {
  const supabase = await createClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time")
      .eq("rental_offering_id", offeringId)
      .order("weekday")
      .order("start_time"),
    supabase
      .from("availability_exceptions")
      .select("id, date, closed, start_time, end_time")
      .eq("rental_offering_id", offeringId)
      .gte("date", fromDate)
      .order("date"),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      id: e.id,
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}

/** How many owners — team members or hourly spaces — have at least one weekly
    rule. Drives the welcome checklist's "Set hours" tick. RLS scopes the
    read to the caller's org; rows carry exactly one of staff_id /
    rental_offering_id (0056 XOR check), so the owner key is whichever is set. */
export async function countHoursOwners(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("staff_id, rental_offering_id");
  if (error) throw error;
  const owners = new Set<string>();
  for (const r of data ?? []) {
    const key = r.staff_id ?? r.rental_offering_id;
    if (key) owners.add(key);
  }
  return owners.size;
}

export type AdminBooking = {
  id: string;
  // Rentals R1 (0037): a booking is EITHER an appointment (serviceId) or a
  // rental stay (rentalOfferingId + rentalUnitId) — never both.
  serviceId: string | null;
  rentalOfferingId: string | null;
  rentalUnitId: string | null;
  // H2 (Task 10): the offering's range mode, so a caller (the move dialog)
  // can pick a range-engine or hourly-engine picker without a second fetch.
  // Null for an appointment; also null if the offering row is somehow gone
  // (never happens in practice — a booking's offering is never hard-deleted).
  rangeMode: RangeMode | null;
  serviceName: string;
  clientName: string;
  clientEmail: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
  rescheduledFromId: string | null;
  // Team (multi-staff): who the appointment belongs to. Null for rental
  // stays, which carry no staff (0041) — and the name/colour ride along so
  // the calendar can paint a card without a second query.
  staffId: string | null;
  staffName: string | null;
  staffColor: string | null;
  // H3 money, snapshotted onto the row at write time (0057). Null whenever
  // the offering carried no price — appointments always. The requests inbox
  // shows it so "accept" is a decision made with the amount in view.
  priceCents: number | null;
  currency: string | null;
};

export const BOOKING_COLUMNS =
  "id, service_id, rental_offering_id, rental_unit_id, client_name, client_email, starts_at, ends_at, status, note, rescheduled_from_id, staff_id, price_cents, currency, services(name), rental_offerings(name, range_mode), rental_units(name), staff(name, color)";

export type BookingRow = {
  id: string;
  service_id: string | null;
  rental_offering_id: string | null;
  rental_unit_id: string | null;
  client_name: string;
  client_email: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
  rescheduled_from_id: string | null;
  staff_id: string | null;
  price_cents: number | null;
  currency: string | null;
  staff: { name: string; color: string } | null;
  services: { name: string } | null;
  rental_offerings: { name: string; range_mode: RangeMode } | null;
  rental_units: { name: string } | null;
};

export function toAdminBooking(b: BookingRow): AdminBooking {
  return {
    id: b.id,
    serviceId: b.service_id,
    rentalOfferingId: b.rental_offering_id,
    rentalUnitId: b.rental_unit_id,
    rangeMode: b.rental_offerings?.range_mode ?? null,
    serviceName: bookingTitle(b),
    clientName: b.client_name,
    clientEmail: b.client_email,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    status: b.status,
    note: b.note,
    rescheduledFromId: b.rescheduled_from_id,
    staffId: b.staff_id,
    staffName: b.staff?.name ?? null,
    staffColor: b.staff?.color ?? null,
    priceCents: b.price_cents,
    currency: b.currency,
  };
}

export async function listBookings(): Promise<{ upcoming: AdminBooking[]; past: AdminBooking[] }> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [upcomingRes, pastRes] = await Promise.all([
    // Upcoming: confirmed, plus live pending requests.
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .or(`status.eq.confirmed,and(status.eq.pending,starts_at.gt.${nowIso})`)
      // ends_at, not starts_at (Rentals R1): a multi-night stay in progress is
      // still upcoming — it only leaves the list once it has ended.
      .gte("ends_at", nowIso)
      .order("starts_at", { ascending: true }),
    // History: terminal statuses, confirmed-and-ended, and lapsed requests.
    // Capped — S5's calendar view is the archaeology surface.
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .or(
        `status.in.(cancelled_by_client,cancelled_by_provider,rescheduled,declined),` +
          `and(status.eq.confirmed,ends_at.lt.${nowIso}),` +
          `and(status.eq.pending,starts_at.lte.${nowIso})`,
      )
      .order("starts_at", { ascending: false })
      .limit(50),
  ]);
  if (upcomingRes.error) throw upcomingRes.error;
  if (pastRes.error) throw pastRes.error;
  return {
    upcoming: ((upcomingRes.data ?? []) as unknown as BookingRow[]).map(toAdminBooking),
    past: ((pastRes.data ?? []) as unknown as BookingRow[]).map(toAdminBooking),
  };
}

/** `staffIds` narrows the week to those people's appointments. Rental stays
    have no staff (staff_id is null), so they drop out whenever the filter is
    on — the calendar's staff filter is an appointment lens, and callers that
    want the whole week (the default "All" view) simply omit the argument. */
export async function listCalendarBookingsBetween(
  fromIso: string,
  toIso: string,
  staffIds?: string[],
): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const base = supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    // Confirmed, plus live pending requests — they hold slots (0062), so the
    // grid must show why a time is blocked. A lapsed pending is history.
    .or(`status.eq.confirmed,and(status.eq.pending,starts_at.gt.${new Date().toISOString()})`)
    // Overlap, not containment (Rentals R1): a multi-night stay that began
    // before the visible week still belongs on it.
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso);
  const { data, error } = await (staffIds ? base.in("staff_id", staffIds) : base).order(
    "starts_at",
    { ascending: true },
  );
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
}

/** Overrides in a date window — every owner's at once (one org-week of
    rows), each saying whose it is: a person's or an hourly space's (H2).
    The week resolves availability per owner (day-windows.ts unionWindows)
    and picks its owners in memory (bookings-scope.ts scopeHoursOwners), so
    the rows must stay attributable. */
export async function listExceptionsBetween(
  fromDate: string,
  toDate: string,
): Promise<Array<ExceptionRow & { staffId: string | null; rentalOfferingId: string | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_exceptions")
    .select("id, staff_id, rental_offering_id, date, closed, start_time, end_time")
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date");
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id,
    staffId: e.staff_id,
    rentalOfferingId: e.rental_offering_id,
    date: e.date,
    closed: e.closed,
    startTime: e.start_time,
    endTime: e.end_time,
  }));
}

// Overview tiles (S5): minimal columns, single 90-day starts_at window —
// see stats.ts for why that also covers the created_at-based tile.
export async function listStatsBookings(fromIso: string): Promise<StatsBookingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("starts_at, status, created_at")
    .gte("starts_at", fromIso);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: b.starts_at,
    status: b.status,
    createdAt: b.created_at,
  }));
}

/** Live pending requests, oldest start first — the Overview inbox feed. */
export async function listPendingRequests(): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "pending")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
}

/** Cheap head-count of live pending requests — the sidebar badge. */
export async function countPendingRequests(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .gt("starts_at", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}
