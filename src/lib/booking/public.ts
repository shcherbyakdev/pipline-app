import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysISO, type SlotRule, type SlotException } from "@/features/scheduling/slots";
import type {
  RangeMode,
  RangeUnit,
  RangeBlackout,
  RangeBooking,
} from "@/features/rentals/range";

// Admin-client reads for the anonymous booking page (getOrgBranding
// precedent: the public surface stays off the anon SQL grant surface;
// every query here is scoped by an explicitly resolved handle/orgId).

export type PublicService = {
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
};

export async function getBookingOrg(
  handle: string,
): Promise<{ orgId: string; orgName: string; timeZone: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone")
    .eq("handle", handle)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.id, orgName: data.name, timeZone: data.timezone };
}

export async function listPublicServices(orgId: string): Promise<PublicService[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days",
    )
    .eq("org_id", orgId)
    .eq("active", true)
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
  }));
}

export async function getAvailability(
  orgId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("org_id", orgId),
    admin
      .from("availability_exceptions")
      .select("date, closed, start_time, end_time")
      .eq("org_id", orgId),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}

export async function getBusyIntervals(
  orgId: string,
  fromIso: string,
  toIso: string,
  excludeBookingId?: string,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const admin = createAdminClient();
  let query = admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    // Rentals never block the provider's calendar (unit-level guard, R1).
    .is("rental_unit_id", null)
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  // Reschedule pickers drop the booking's own interval: the RPC frees the
  // old row before inserting, so "overlaps itself" is a legal target.
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
}

export async function getPublicServiceById(
  orgId: string,
  serviceId: string,
): Promise<PublicService | null> {
  const services = await listPublicServices(orgId);
  return services.find((s) => s.id === serviceId) ?? null;
}

// Everything the slot engine needs for one org+service. Shared by the
// public booking page, the tokenized manage page, and the admin
// reschedule dialog (public-actions' former loadSlotContext, org-keyed).
export async function loadOrgSlotContext(
  orgId: string,
  serviceId: string,
  fromDate: string,
  days: number,
  opts?: { excludeBookingId?: string },
): Promise<{
  service: PublicService;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: Array<{ startsAt: Date; endsAt: Date }>;
} | null> {
  const service = await getPublicServiceById(orgId, serviceId);
  if (!service) return null;
  const { rules, exceptions } = await getAvailability(orgId);
  // Fetch busy one day beyond both edges — buffers can reach across
  // org-local midnight in UTC terms.
  const busy = await getBusyIntervals(
    orgId,
    `${addDaysISO(fromDate, -1)}T00:00:00Z`,
    `${addDaysISO(fromDate, days + 1)}T23:59:59Z`,
    opts?.excludeBookingId,
  );
  return { service, rules, exceptions, busy };
}

// ---------- Rentals (R1). Same doctrine as the service loaders above:
// admin client, every query scoped by an already-resolved orgId.

export type PublicOffering = {
  id: string;
  name: string;
  description: string | null;
  priceLabel: string | null;
  rangeMode: RangeMode;
  startTime: string;
  endTime: string;
  minStay: number;
  maxStay: number | null;
  turnoverDays: number;
  minNoticeDays: number;
  bookingWindowDays: number;
  unitSelection: "auto" | "client_picks";
};
export type PublicUnit = { id: string; name: string; description: string | null; active: boolean };

const PUBLIC_OFFERING_COLUMNS =
  "id, name, description, price_label, range_mode, start_time, end_time, min_stay, max_stay, turnover_days, min_notice_days, booking_window_days, unit_selection";

type PublicOfferingDb = {
  id: string;
  name: string;
  description: string | null;
  price_label: string | null;
  range_mode: RangeMode;
  start_time: string;
  end_time: string;
  min_stay: number;
  max_stay: number | null;
  turnover_days: number;
  min_notice_days: number;
  booking_window_days: number;
  unit_selection: "auto" | "client_picks";
};

function toPublicOffering(o: PublicOfferingDb): PublicOffering {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    priceLabel: o.price_label,
    rangeMode: o.range_mode,
    startTime: o.start_time,
    endTime: o.end_time,
    minStay: o.min_stay,
    maxStay: o.max_stay,
    turnoverDays: o.turnover_days,
    minNoticeDays: o.min_notice_days,
    bookingWindowDays: o.booking_window_days,
    unitSelection: o.unit_selection,
  };
}

// Active offerings that have at least one active unit — an offering with no
// bookable unit would render a calendar that is free nowhere. Two plain
// queries rather than an `!inner` embed: the join semantics of a filtered
// embed are easy to get subtly wrong, and this list is tiny.
export async function listPublicOfferings(orgId: string): Promise<PublicOffering[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offerings")
    .select(PUBLIC_OFFERING_COLUMNS)
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  const offerings = ((data ?? []) as unknown as PublicOfferingDb[]).map(toPublicOffering);
  if (offerings.length === 0) return [];
  const { data: units, error: unitsError } = await admin
    .from("rental_units")
    .select("offering_id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in(
      "offering_id",
      offerings.map((o) => o.id),
    );
  if (unitsError) throw unitsError;
  const bookable = new Set((units ?? []).map((u) => u.offering_id as string));
  return offerings.filter((o) => bookable.has(o.id));
}

export async function getPublicOfferingById(
  orgId: string,
  offeringId: string,
): Promise<PublicOffering | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offerings")
    .select(PUBLIC_OFFERING_COLUMNS)
    .eq("id", offeringId)
    .eq("org_id", orgId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicOffering(data as unknown as PublicOfferingDb) : null;
}

export async function listPublicUnits(offeringId: string): Promise<PublicUnit[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_units")
    .select("id, name, description")
    .eq("offering_id", offeringId)
    .eq("active", true)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, name: u.name, description: u.description, active: true }));
}

// Everything the range engine needs for one org+offering. The window is
// padded by turnover (+1 day) on both edges: a stay just outside the
// requested span still occupies days inside it once turnover is added.
export async function loadOrgRangeContext(
  orgId: string,
  offeringId: string,
  fromDate: string,
  days: number,
  opts?: {
    // Not applied here — the engine (computeRangeAvailability) skips this
    // booking's own occupancy; the loader still returns the row (with id).
    excludeBookingId?: string;
    // Admin timeline/move: a booking may sit on a unit that's since gone
    // inactive and still needs to resolve. The engine only auto-assigns
    // from `rangeUnits`, which stays active-only even here.
    includeInactiveUnits?: boolean;
  },
): Promise<{
  offering: PublicOffering;
  units: PublicUnit[];
  rangeUnits: RangeUnit[];
  blackouts: RangeBlackout[];
  bookings: RangeBooking[];
} | null> {
  const offering = await getPublicOfferingById(orgId, offeringId);
  if (!offering) return null;
  const admin = createAdminClient();
  let unitsQuery = admin
    .from("rental_units")
    .select("id, name, description, sort_order, active")
    .eq("offering_id", offeringId)
    .eq("org_id", orgId);
  if (!opts?.includeInactiveUnits) unitsQuery = unitsQuery.eq("active", true);
  const { data: unitRows, error: unitsError } = await unitsQuery
    .order("sort_order")
    .order("created_at");
  if (unitsError) throw unitsError;
  const units: PublicUnit[] = (unitRows ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    description: u.description,
    active: u.active,
  }));
  const rangeUnits: RangeUnit[] = (unitRows ?? [])
    .filter((u) => u.active)
    .map((u, i) => ({
      id: u.id,
      // sort_order ties are broken by created_at above; the engine sorts on a
      // single number, so hand it the resolved position.
      sortOrder: i,
    }));
  if (units.length === 0) {
    return { offering, units, rangeUnits, blackouts: [], bookings: [] };
  }

  const pad = offering.turnoverDays + 1;
  const windowStart = addDaysISO(fromDate, -pad);
  const windowEnd = addDaysISO(fromDate, days + pad);
  const unitIds = units.map((u) => u.id);
  const [blackoutRes, bookingRes] = await Promise.all([
    admin
      .from("rental_unit_blackouts")
      .select("rental_unit_id, start_date, end_date")
      .in("rental_unit_id", unitIds)
      .gte("end_date", windowStart)
      .lte("start_date", windowEnd),
    admin
      .from("bookings")
      .select("id, rental_unit_id, starts_at, ends_at")
      .in("rental_unit_id", unitIds)
      .eq("status", "confirmed")
      .gte("ends_at", `${windowStart}T00:00:00Z`)
      .lte("starts_at", `${windowEnd}T23:59:59Z`),
  ]);
  if (blackoutRes.error) throw blackoutRes.error;
  if (bookingRes.error) throw bookingRes.error;

  const blackouts: RangeBlackout[] = (blackoutRes.data ?? []).map((b) => ({
    unitId: b.rental_unit_id,
    startDate: b.start_date,
    endDate: b.end_date,
  }));
  const bookings: RangeBooking[] = (bookingRes.data ?? []).map((b) => ({
    id: b.id,
    unitId: b.rental_unit_id,
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
  return { offering, units, rangeUnits, blackouts, bookings };
}

// The confirmation email names the unit the RPC picked; only the booking id
// comes back from it.
export async function getBookingUnitName(bookingId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("rental_units(name)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) return null;
  const unit = (data as unknown as { rental_units: { name: string } | null }).rental_units;
  return unit?.name ?? null;
}
