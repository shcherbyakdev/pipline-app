import "server-only";
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDaysISO,
  type SlotRule,
  type SlotException,
  type BusyInterval,
} from "@/features/scheduling/slots";
import type {
  RangeMode,
  RangeUnit,
  RangeBlackout,
  RangeBooking,
} from "@/features/rentals/range";
import { blackoutBusy } from "@/features/rentals/hourly";
import type { OrgMode } from "@/features/orgs/mode";
import type { UnitRef } from "./bookable";

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
  requiresApproval: boolean;
};

export type BookingOrg = {
  orgId: string;
  orgName: string;
  timeZone: string;
  offersAppointments: boolean;
  offersRentals: boolean;
  currency: string;
  /** The org locale as stored (0069) — resolved against LOCALES, the
      visitor's region and `?lang=` by src/i18n/public.ts, never used raw. */
  locale: string;
};

// Per-request memoised: generateMetadata and the page both resolve the handle.
export const getBookingOrg = cache(async (handle: string): Promise<BookingOrg | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone, offers_appointments, offers_rentals, currency, locale")
    .eq("handle", handle)
    .maybeSingle();
  if (error || !data) return null;
  return {
    orgId: data.id,
    orgName: data.name,
    timeZone: data.timezone,
    offersAppointments: data.offers_appointments,
    offersRentals: data.offers_rentals,
    currency: data.currency,
    locale: data.locale,
  };
});

/** The manage page's org locale: resolve_booking_token hands back the org
    id, and one more admin read beats widening that RPC's return type. */
export const getOrgLocale = cache(async (orgId: string): Promise<string | null> => {
  const admin = createAdminClient();
  const { data } = await admin.from("orgs").select("locale").eq("id", orgId).maybeSingle();
  return data?.locale ?? null;
});

export async function listPublicServices(orgId: string): Promise<PublicService[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, requires_approval",
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
    requiresApproval: s.requires_approval,
  }));
}

export async function getAvailability(
  staffId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("staff_id", staffId),
    admin
      .from("availability_exceptions")
      .select("date, closed, start_time, end_time")
      .eq("staff_id", staffId),
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

// Each interval carries its own service's buffers and id — the engine
// honours an existing booking's cleanup/prep time and counts max/day per
// service (slots.ts BusyInterval).
export async function getBusyIntervals(
  staffId: string,
  fromIso: string,
  toIso: string,
  excludeBookingId?: string,
): Promise<BusyInterval[]> {
  const admin = createAdminClient();
  let query = admin
    .from("bookings")
    .select("starts_at, ends_at, service_id, services(buffer_before_min, buffer_after_min)")
    .eq("staff_id", staffId)
    // Pending requests hold their slot (0062 EXCLUDE) — busy sets must agree.
    .in("status", ["confirmed", "pending"])
    // Rentals never block the provider's calendar (unit-level guard, R1).
    .is("rental_unit_id", null)
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  // Reschedule pickers drop the booking's own interval: the RPC frees the
  // old row before inserting, so "overlaps itself" is a legal target.
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((b) => {
    const svc = (b as unknown as {
      services: { buffer_before_min: number; buffer_after_min: number } | null;
    }).services;
    return {
      startsAt: new Date(b.starts_at),
      endsAt: new Date(b.ends_at),
      serviceId: b.service_id ?? undefined,
      bufferBeforeMin: svc?.buffer_before_min ?? 0,
      bufferAfterMin: svc?.buffer_after_min ?? 0,
    };
  });
}

export async function getPublicServiceById(
  orgId: string,
  serviceId: string,
): Promise<PublicService | null> {
  const services = await listPublicServices(orgId);
  return services.find((s) => s.id === serviceId) ?? null;
}

// Admin paths only: a booking on a service that has since been deactivated
// must still be movable (audit 2026-08-24 — the active-only read made every
// admin reschedule of such a booking fail as "doesn't offer this service").
// Never used by a public caller, which must not see inactive services.
async function getServiceByIdIncludingInactive(
  orgId: string,
  serviceId: string,
): Promise<PublicService | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, requires_approval",
    )
    .eq("org_id", orgId)
    .eq("id", serviceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    durationMin: data.duration_min,
    priceLabel: data.price_label,
    bufferBeforeMin: data.buffer_before_min,
    bufferAfterMin: data.buffer_after_min,
    minNoticeMin: data.min_notice_min,
    maxPerDay: data.max_per_day,
    bookingWindowDays: data.booking_window_days,
    requiresApproval: data.requires_approval,
  };
}

// The .ics needs one identity per APPOINTMENT across reschedules: walk
// rescheduled_from_id back to the first row. Bounded — a chain is a handful
// of rows at most, and a cycle is impossible (each new row points at an
// older one) but the cap makes that a fact rather than a hope.
export async function getBookingChain(bookingId: string): Promise<{ rootId: string; depth: number }> {
  const admin = createAdminClient();
  let id = bookingId;
  let depth = 0;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await admin
      .from("bookings")
      .select("rescheduled_from_id")
      .eq("id", id)
      .maybeSingle();
    if (error || !data?.rescheduled_from_id) break;
    id = data.rescheduled_from_id;
    depth++;
  }
  return { rootId: id, depth };
}

// A handle the org used before renaming (0052 org_handle_history) → its
// current handle, or null when the old handle is unknown or the org has
// since dropped its handle. /<old> redirects; /embed/<old> keeps serving.
export const resolveHandleAlias = cache(async (handle: string): Promise<string | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_handle_history")
    .select("orgs(handle)")
    .eq("handle", handle)
    .maybeSingle();
  if (error || !data) return null;
  const org = (data as unknown as { orgs: { handle: string | null } | null }).orgs;
  return org?.handle ?? null;
});

// Staff directory for the public booking widget. Never selects email —
// that column stays off the anon-reachable surface.
export type PublicStaff = { id: string; name: string; slug: string; color: string };
const STAFF_COLS = "id, name, slug, color, sort_order";

// Per-request memoised (H5b): loadPublicOffering and loadPublicResources
// both want the roster inside one request.
export const listPublicStaff = cache(async (orgId: string, serviceId?: string): Promise<PublicStaff[]> => {
  const admin = createAdminClient();
  let ids: string[] | null = null;
  if (serviceId) {
    const { data, error } = await admin
      .from("service_staff")
      .select("staff_id")
      .eq("org_id", orgId)
      .eq("service_id", serviceId);
    if (error) throw error;
    ids = (data ?? []).map((r) => r.staff_id);
    if (ids.length === 0) return [];
  }
  let q = admin
    .from("staff")
    .select(STAFF_COLS)
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color }));
});

// serviceId → eligible staff ids, in one query. The booking pages need the
// whole map up front (the widget filters the staff step per service without a
// round trip); listPublicStaff(orgId, serviceId) stays the one-service path.
// Ids are returned unfiltered by staff.active — the widget intersects them
// with the active `staff` list it also receives.
export async function listServiceStaffMap(orgId: string): Promise<Record<string, string[]>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("service_staff")
    .select("service_id, staff_id")
    .eq("org_id", orgId);
  if (error) throw error;
  const map: Record<string, string[]> = {};
  for (const row of data ?? []) {
    (map[row.service_id] ??= []).push(row.staff_id);
  }
  return map;
}

// The one place the "solo orgs never name a staff member" rule lives.
// Client-facing copy (emails, the manage page, the .ics) must read exactly as
// it did before the team slice existed unless the org actually has a team, so
// this collapses to null for a solo org — and, because every caller sits
// after a committed booking, for a count that blows up too.
export async function resolveClientStaffName(
  orgId: string,
  staffName: string | null | undefined,
): Promise<string | null> {
  if (!staffName) return null;
  try {
    return (await countActiveStaff(orgId)) > 1 ? staffName : null;
  } catch (error) {
    console.error("[scheduling] countActiveStaff:", error);
    return null;
  }
}

export async function countActiveStaff(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

// Everything the slot engine needs for one org+service, per eligible staff
// member. Shared by the public booking page, the tokenized manage page, and
// the admin reschedule dialog (public-actions' former loadSlotContext).
export type StaffSlotContext = {
  staffId: string;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: BusyInterval[];
};

export async function loadOrgSlotContext(
  orgId: string,
  serviceId: string,
  fromDate: string,
  days: number,
  opts: {
    staffId: string | "any";
    excludeBookingId?: string;
    allowedStaffIds?: string[];
    // Admin reschedule of a booking whose service was deactivated.
    includeInactive?: boolean;
  },
): Promise<{
  service: PublicService;
  perStaff: StaffSlotContext[];
  // Every ACTIVE member linked to the service, BEFORE any allowedStaffIds
  // narrowing — exactly the set the DB's pick_staff_for_slot ranks over, so a
  // caller can tell whether "let the DB choose" is still safe.
  eligibleStaffIds: string[];
} | null> {
  const service = opts.includeInactive
    ? await getServiceByIdIncludingInactive(orgId, serviceId)
    : await getPublicServiceById(orgId, serviceId);
  if (!service) return null;
  const eligible = await listPublicStaff(orgId, serviceId);
  // Public callers pass the plan-limited roster; the admin reschedule dialog
  // and the tokenized manage page pass nothing (spec §7.4: admins may move a
  // booking to anyone active; a client keeps the person they booked).
  const allowed = opts.allowedStaffIds ? eligible.filter((s) => opts.allowedStaffIds!.includes(s.id)) : eligible;
  const targets = opts.staffId === "any" ? allowed : allowed.filter((s) => s.id === opts.staffId);
  if (targets.length === 0) return null;
  // Fetch busy one day beyond both edges — buffers can reach across
  // org-local midnight in UTC terms.
  const fromIso = `${addDaysISO(fromDate, -1)}T00:00:00Z`;
  const toIso = `${addDaysISO(fromDate, days + 1)}T23:59:59Z`;
  const perStaff = await Promise.all(
    targets.map(async (st) => {
      const [{ rules, exceptions }, busy] = await Promise.all([
        getAvailability(st.id),
        getBusyIntervals(st.id, fromIso, toIso, opts.excludeBookingId),
      ]);
      return { staffId: st.id, rules, exceptions, busy };
    }),
  );
  return { service, perStaff, eligibleStaffIds: eligible.map((s) => s.id) };
}

// ---------- Rentals (R1). Same doctrine as the service loaders above:
// admin client, every query scoped by an already-resolved orgId.

export type PublicOffering = {
  id: string;
  name: string;
  description: string | null;
  rangeMode: RangeMode;
  // H2: nights/days always set these (0056 CHECK); hours reads opening
  // hours from availability_rules instead, so both are null there.
  startTime: string | null;
  endTime: string | null;
  minStay: number;
  maxStay: number | null;
  turnoverDays: number;
  minNoticeDays: number;
  bookingWindowDays: number;
  unitSelection: "auto" | "client_picks";
  // H2: present (non-null) iff rangeMode === "hours" (0056 CHECK) — the
  // trio is either all-set or all-null. See hourly.ts's isHourlyOffering.
  slotIncrementMin: number | null;
  minDurationMin: number | null;
  maxDurationMin: number | null;
  turnoverMin: number;
  minNoticeMin: number;
  priceCents: number | null;
  pricingMode: "per_unit" | "flat";
  depositType: "none" | "fixed" | "percent" | "full";
  depositValue: number | null;
  cancelWindowMin: number;
  termsText: string | null;
  requiresApproval: boolean;
};
export type PublicUnit = { id: string; name: string; description: string | null; active: boolean };

const PUBLIC_OFFERING_COLUMNS =
  "id, name, description, range_mode, start_time, end_time, min_stay, max_stay, turnover_days, min_notice_days, booking_window_days, unit_selection, slot_increment_min, min_duration_min, max_duration_min, turnover_min, min_notice_min, price_cents, pricing_mode, deposit_type, deposit_value, cancel_window_min, terms_text, requires_approval";

type PublicOfferingDb = {
  id: string;
  name: string;
  description: string | null;
  range_mode: RangeMode;
  start_time: string | null;
  end_time: string | null;
  min_stay: number;
  max_stay: number | null;
  turnover_days: number;
  min_notice_days: number;
  booking_window_days: number;
  unit_selection: "auto" | "client_picks";
  slot_increment_min: number | null;
  min_duration_min: number | null;
  max_duration_min: number | null;
  turnover_min: number;
  min_notice_min: number;
  price_cents: number | null;
  pricing_mode: "per_unit" | "flat";
  deposit_type: "none" | "fixed" | "percent" | "full";
  deposit_value: number | null;
  cancel_window_min: number;
  terms_text: string | null;
  requires_approval: boolean;
};

function toPublicOffering(o: PublicOfferingDb): PublicOffering {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    rangeMode: o.range_mode,
    startTime: o.start_time,
    endTime: o.end_time,
    minStay: o.min_stay,
    maxStay: o.max_stay,
    turnoverDays: o.turnover_days,
    minNoticeDays: o.min_notice_days,
    bookingWindowDays: o.booking_window_days,
    unitSelection: o.unit_selection,
    slotIncrementMin: o.slot_increment_min,
    minDurationMin: o.min_duration_min,
    maxDurationMin: o.max_duration_min,
    turnoverMin: o.turnover_min,
    minNoticeMin: o.min_notice_min,
    priceCents: o.price_cents,
    pricingMode: o.pricing_mode,
    depositType: o.deposit_type,
    depositValue: o.deposit_value,
    cancelWindowMin: o.cancel_window_min,
    termsText: o.terms_text,
    requiresApproval: o.requires_approval,
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

// H5b: every active unit of an active offering, in the order the plan cap
// counts them (offering sort_order → name, then unit sort_order → created_at)
// — the same order listPublicOfferings lists spaces and the RPCs auto-pick
// units in, so "the first N resources" means one thing everywhere.
export async function listPublicUnitsForOrg(orgId: string): Promise<UnitRef[]> {
  const admin = createAdminClient();
  const { data: offerings, error } = await admin
    .from("rental_offerings")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  if (!offerings || offerings.length === 0) return [];
  const { data: units, error: unitsError } = await admin
    .from("rental_units")
    .select("id, offering_id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in(
      "offering_id",
      offerings.map((o) => o.id),
    )
    .order("sort_order")
    .order("created_at");
  if (unitsError) throw unitsError;
  const rank = new Map(offerings.map((o, i) => [o.id as string, i]));
  // Stable sort: units keep their own order inside each space.
  return (units ?? [])
    .map((u) => ({ id: u.id as string, offeringId: u.offering_id as string }))
    .sort((a, b) => rank.get(a.offeringId)! - rank.get(b.offeringId)!);
}

// H5b: the org's declared channels by id, for callers that hold only an
// orgId (loadPublicOffering). Per-request memoised like getBookingOrg.
export const getOrgModeAdmin = cache(async (orgId: string): Promise<OrgMode | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("offers_appointments, offers_rentals")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? { offersAppointments: data.offers_appointments, offersRentals: data.offers_rentals } : null;
});

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
  // Inverse of loadOrgHourlyContext's guard: this loader feeds the
  // date-range engine, which never resolves an hours offering.
  if (offering.rangeMode === "hours") return null;
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
      .in("status", ["confirmed", "pending"])
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

// H2: opening hours for an hourly offering. Twin of getAvailability(staffId)
// with the owner column swapped to rental_offering_id (0056).
export async function getOfferingAvailability(
  offeringId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("rental_offering_id", offeringId),
    admin
      .from("availability_exceptions")
      .select("date, closed, start_time, end_time")
      .eq("rental_offering_id", offeringId),
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

// Everything the hourly slot engine needs for one org+offering, per unit.
// `timeZone` is passed in rather than re-queried — every caller already
// holds the org record (getBookingOrg / currentOrg).
export async function loadOrgHourlyContext(
  orgId: string,
  offeringId: string,
  timeZone: string,
  fromDate: string,
  days: number,
  opts?: {
    excludeBookingId?: string;
    unitId?: string;
    includeInactiveUnits?: boolean;
  },
): Promise<{
  offering: PublicOffering;
  units: PublicUnit[];
  rules: SlotRule[];
  exceptions: SlotException[];
  perUnit: { unitId: string; busy: BusyInterval[] }[];
} | null> {
  const offering = await getPublicOfferingById(orgId, offeringId);
  if (!offering || offering.rangeMode !== "hours") return null;
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
  const units: PublicUnit[] = (unitRows ?? [])
    .filter((u) => (opts?.unitId ? u.id === opts.unitId : true))
    .map((u) => ({ id: u.id, name: u.name, description: u.description, active: u.active }));
  const { rules, exceptions } = await getOfferingAvailability(offeringId);
  // Window padded a day each side (viewer/org offset) — getBusyIntervals idiom.
  const fromIso = `${addDaysISO(fromDate, -1)}T00:00:00Z`;
  const toIso = `${addDaysISO(fromDate, days + 1)}T23:59:59Z`;
  const unitIds = units.map((u) => u.id);
  const [bookingRes, blackoutRes] = await Promise.all([
    unitIds.length
      ? admin
          .from("bookings")
          .select("id, rental_unit_id, starts_at, ends_at")
          .in("rental_unit_id", unitIds)
          .in("status", ["confirmed", "pending"])
          .gte("ends_at", fromIso)
          .lte("starts_at", toIso)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length
      ? admin
          .from("rental_unit_blackouts")
          .select("rental_unit_id, start_date, end_date")
          .in("rental_unit_id", unitIds)
          .gte("end_date", addDaysISO(fromDate, -1))
          .lte("start_date", addDaysISO(fromDate, days + 1))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (bookingRes.error) throw bookingRes.error;
  if (blackoutRes.error) throw blackoutRes.error;
  const blackoutMap = blackoutBusy(
    (blackoutRes.data ?? []).map((b) => ({
      unitId: b.rental_unit_id,
      startDate: b.start_date,
      endDate: b.end_date,
    })),
    timeZone,
  );
  const perUnit = units.map((u) => ({
    unitId: u.id,
    busy: [
      ...(bookingRes.data ?? [])
        .filter((b) => b.rental_unit_id === u.id && b.id !== opts?.excludeBookingId)
        .map((b) => ({
          startsAt: new Date(b.starts_at),
          endsAt: new Date(b.ends_at),
          bufferAfterMin: offering.turnoverMin,
        })),
      ...(blackoutMap.get(u.id) ?? []),
    ],
  }));
  return { offering, units, rules, exceptions, perUnit };
}

// The tokenized manage page knows a stay by its token; the resolver hands
// back the unit but not the offering, which is what the range engine needs.
export async function getBookingOfferingId(bookingId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("rental_offering_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !data) return null;
  return data.rental_offering_id;
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
