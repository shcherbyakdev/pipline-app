import { createClient } from "@/lib/supabase/server";
import { type StatsBookingRow } from "./stats";
import { bookingTitle } from "./booking-label";

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
  sortOrder: number;
};

export async function listServices(): Promise<ServiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, active, sort_order",
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
    sortOrder: s.sort_order,
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
    `firstActiveStaffId()`. */
export async function getAvailabilityAdmin(staffId: string): Promise<{
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
      .gte("date", new Date().toISOString().slice(0, 10))
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

export type AdminBooking = {
  id: string;
  // Rentals R1 (0037): a booking is EITHER an appointment (serviceId) or a
  // rental stay (rentalOfferingId + rentalUnitId) — never both.
  serviceId: string | null;
  rentalOfferingId: string | null;
  rentalUnitId: string | null;
  serviceName: string;
  clientName: string;
  clientEmail: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
  rescheduledFromId: string | null;
};

export const BOOKING_COLUMNS =
  "id, service_id, rental_offering_id, rental_unit_id, client_name, client_email, starts_at, ends_at, status, note, rescheduled_from_id, services(name), rental_offerings(name), rental_units(name)";

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
  services: { name: string } | null;
  rental_offerings: { name: string } | null;
  rental_units: { name: string } | null;
};

export function toAdminBooking(b: BookingRow): AdminBooking {
  return {
    id: b.id,
    serviceId: b.service_id,
    rentalOfferingId: b.rental_offering_id,
    rentalUnitId: b.rental_unit_id,
    serviceName: bookingTitle(b),
    clientName: b.client_name,
    clientEmail: b.client_email,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    status: b.status,
    note: b.note,
    rescheduledFromId: b.rescheduled_from_id,
  };
}

export async function listBookings(): Promise<{ upcoming: AdminBooking[]; past: AdminBooking[] }> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [upcomingRes, pastRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("status", "confirmed")
      // ends_at, not starts_at (Rentals R1): a multi-night stay in progress is
      // still upcoming — it only leaves the list once it has ended.
      .gte("ends_at", nowIso)
      .order("starts_at", { ascending: true }),
    // History: anything cancelled/rescheduled, plus confirmed-and-ended.
    // Capped — S5's calendar view is the archaeology surface.
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .or(`status.neq.confirmed,ends_at.lt.${nowIso}`)
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

export async function listConfirmedBookingsBetween(
  fromIso: string,
  toIso: string,
): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "confirmed")
    // Overlap, not containment (Rentals R1): a multi-night stay that began
    // before the visible week still belongs on it.
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
}

/** Overrides in a date window. `staffIds` narrows to those people's rows —
    omit it only where every staff member's overrides are wanted at once. */
export async function listExceptionsBetween(
  fromDate: string,
  toDate: string,
  staffIds?: string[],
): Promise<ExceptionRow[]> {
  const supabase = await createClient();
  const base = supabase
    .from("availability_exceptions")
    .select("id, date, closed, start_time, end_time")
    .gte("date", fromDate)
    .lte("date", toDate);
  const { data, error } = await (staffIds ? base.in("staff_id", staffIds) : base).order("date");
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id, date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
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
