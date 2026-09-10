import "server-only";
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { clientContactSchema, type ClientContact } from "@/features/orgs/schema";
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
import { externalBusy } from "@/features/calendar-sync/busy";
import type { OrgMode } from "@/features/orgs/mode";
import type { Line, PricingRules, OfferingKind } from "@/features/rentals/pricing-rules";
import type { CancelPolicy } from "@/features/rentals/cancel-policy";
import type { EquipmentOffering } from "@/features/rentals/pricing";
import { parseLegal, type Legal } from "@/features/payments/legal";
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
  /** Which contact fields the form shows and the create RPCs require (0086). */
  clientContact: ClientContact;
};

// Per-request memoised: generateMetadata and the page both resolve the handle.
export const getBookingOrg = cache(async (handle: string): Promise<BookingOrg | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone, offers_appointments, offers_rentals, currency, locale, client_contact")
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
    clientContact: clientContactSchema.catch("email").parse(data.client_contact),
  };
});

/** The manage page's org locale: resolve_booking_token hands back the org
    id, and one more admin read beats widening that RPC's return type. */
export const getOrgLocale = cache(async (orgId: string): Promise<string | null> => {
  const admin = createAdminClient();
  const { data } = await admin.from("orgs").select("locale").eq("id", orgId).maybeSingle();
  return data?.locale ?? null;
});

/** S2: the legal identity the public footer prints (orgs.legal, 0079). */
export const getOrgLegal = cache(async (orgId: string): Promise<Legal> => {
  const admin = createAdminClient();
  const { data } = await admin.from("orgs").select("legal").eq("id", orgId).maybeSingle();
  return parseLegal(data?.legal);
});

/** For the slot loader's Google read (all-day events block an ORG-local
    day): one memoised admin read rather than a new parameter on five
    callers, most of which already hold it. */
const getOrgTimeZone = cache(async (orgId: string): Promise<string> => {
  const admin = createAdminClient();
  const { data } = await admin.from("orgs").select("timezone").eq("id", orgId).maybeSingle();
  return data?.timezone ?? "UTC";
});

/** The language the client booked in (bookings.locale, 0072), or null for a
    row written before it existed and for every admin-made booking — the
    callers fall back to the org's. Read by the manage page and by the
    client-facing mails the manage actions send. */
export const getBookingLocale = cache(async (bookingId: string): Promise<string | null> => {
  const admin = createAdminClient();
  const { data } = await admin.from("bookings").select("locale").eq("id", bookingId).maybeSingle();
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
    // Pending requests and unpaid holds hold their slot (0062/0079
    // EXCLUDE) — busy sets must agree.
    .in("status", ["confirmed", "pending", "pending_payment"])
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
    // The public create pre-check: read Google now, not from the memo, so
    // the slot being taken is checked at this moment (spec 2026-09-05 §2.6).
    freshExternal?: boolean;
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
  // Busy time from a connected Google calendar joins the person's own
  // bookings (features/calendar-sync/busy.ts: never throws, [] on outage).
  const timeZone = await getOrgTimeZone(orgId);
  const perStaff = await Promise.all(
    targets.map(async (st) => {
      const [{ rules, exceptions }, busy, external] = await Promise.all([
        getAvailability(st.id),
        getBusyIntervals(st.id, fromIso, toIso, opts.excludeBookingId),
        externalBusy(orgId, st.id, fromIso, toIso, { timeZone, fresh: opts.freshExternal }),
      ]);
      return { staffId: st.id, rules, exceptions, busy: [...busy, ...external] };
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
  // S6: space | composite | equipment (rental_offerings.kind, 0084).
  kind: OfferingKind;
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
  cancelPolicy: CancelPolicy;
  termsText: string | null;
  requiresApproval: boolean;
  // S1: an hours offering's rate bands/surcharges/extras; null everywhere
  // else (the flat priceCents/pricingMode pair still applies then).
  pricing: PricingRules | null;
};
export type PublicUnit = { id: string; name: string; description: string | null; active: boolean };

const PUBLIC_OFFERING_COLUMNS =
  "id, name, description, kind, range_mode, start_time, end_time, min_stay, max_stay, turnover_days, min_notice_days, booking_window_days, unit_selection, slot_increment_min, min_duration_min, max_duration_min, turnover_min, min_notice_min, price_cents, pricing_mode, deposit_type, deposit_value, cancel_policy, terms_text, requires_approval, pricing";

type PublicOfferingDb = {
  id: string;
  name: string;
  description: string | null;
  kind: OfferingKind;
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
  cancel_policy: CancelPolicy;
  terms_text: string | null;
  requires_approval: boolean;
  pricing: PricingRules | null;
};

function toPublicOffering(o: PublicOfferingDb): PublicOffering {
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    kind: o.kind,
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
    cancelPolicy: o.cancel_policy,
    termsText: o.terms_text,
    requiresApproval: o.requires_approval,
    pricing: o.pricing,
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
    // S6: equipment is an add-on, never a bookable catalogue entry on its own.
    .neq("kind", "equipment")
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

// S6: every caller resolves "the offering being booked" (public-actions'
// createRentalBooking, manage-actions' rescheduleRentalBooking, and this
// module's own range/hourly loaders) — equipment is never one of those, it
// only attaches as an add-on via listEquipmentAvailability.
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
    .neq("kind", "equipment")
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
// S6: equipment ranks after every room, whatever it is called. Equipment is
// never bookable on its own and a space with several items is several units,
// so alphabetical order alone let one "ARRI lamp" eat a Free org's whole
// budget and drop its only room off the public page.
export async function listPublicUnitsForOrg(orgId: string): Promise<UnitRef[]> {
  const admin = createAdminClient();
  const { data: offerings, error } = await admin
    .from("rental_offerings")
    .select("id, kind")
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
  const rank = new Map(
    offerings.map((o, i) => [o.id as string, o.kind === "equipment" ? offerings.length + i : i]),
  );
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

// S6: a composite's own unit stands for every unit of its included rooms —
// their occupancy is folded onto it (rental_unit_scope's TS twin).
export async function scopeUnitIds(orgId: string, offeringId: string, kind: OfferingKind): Promise<string[]> {
  if (kind !== "composite") return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offering_components")
    .select("component_id")
    .eq("composite_id", offeringId)
    .eq("org_id", orgId);
  if (error) throw error;
  const componentIds = (data ?? []).map((c) => c.component_id as string);
  if (componentIds.length === 0) return [];
  const { data: units, error: unitsError } = await admin
    .from("rental_units")
    .select("id")
    .in("offering_id", componentIds)
    .eq("org_id", orgId);
  if (unitsError) throw unitsError;
  return (units ?? []).map((u) => u.id as string);
}

type OccupancyRow = { booking_id: string; rental_unit_id: string; starts_at: string; ends_at: string };

// S6: the one occupancy read. Reserving rows of these units in the window;
// `excludeBookingId` drops the booking being moved.
async function listOccupancy(unitIds: string[], fromIso: string, toIso: string, excludeBookingId?: string): Promise<OccupancyRow[]> {
  if (unitIds.length === 0) return [];
  const admin = createAdminClient();
  let q = admin
    .from("booking_units")
    .select("booking_id, rental_unit_id, starts_at, ends_at")
    .in("rental_unit_id", unitIds)
    .eq("reserving", true)
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  if (excludeBookingId) q = q.neq("booking_id", excludeBookingId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OccupancyRow[];
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
  const [blackoutRes, occupancy] = await Promise.all([
    admin
      .from("rental_unit_blackouts")
      .select("rental_unit_id, start_date, end_date")
      .in("rental_unit_id", unitIds)
      .gte("end_date", windowStart)
      .lte("start_date", windowEnd),
    listOccupancy(unitIds, `${windowStart}T00:00:00Z`, `${windowEnd}T23:59:59Z`),
  ]);
  if (blackoutRes.error) throw blackoutRes.error;

  const blackouts: RangeBlackout[] = (blackoutRes.data ?? []).map((b) => ({
    unitId: b.rental_unit_id,
    startDate: b.start_date,
    endDate: b.end_date,
  }));
  const bookings: RangeBooking[] = occupancy.map((b) => ({
    id: b.booking_id,
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
    // See loadOrgSlotContext.freshExternal.
    freshExternal?: boolean;
    // S6: extra units whose busy time folds onto every unit here (an
    // equipment add-on the caller already knows is riding along) — never
    // itself queried for blackouts, only occupancy.
    alsoBusyUnitIds?: string[];
  },
): Promise<{
  offering: PublicOffering;
  units: PublicUnit[];
  rules: SlotRule[];
  exceptions: SlotException[];
  perUnit: { unitId: string; busy: BusyInterval[] }[];
} | null> {
  // getPublicOfferingById already excludes kind = 'equipment' — an equipment
  // space is never the primary offering an hourly context resolves for.
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
  // S6: a composite's own unit also carries every included room's occupancy
  // and blackouts (ruling 7); alsoBusyUnitIds folds in occupancy only.
  const scope = await scopeUnitIds(orgId, offeringId, offering.kind);
  // A shared Google calendar's Busy time blocks every unit (spec
  // 2026-09-05 §2.5); a person's calendar never applies to a unit.
  const externalPromise = unitIds.length
    ? externalBusy(orgId, null, fromIso, toIso, { timeZone, fresh: opts?.freshExternal })
    : Promise.resolve([] as BusyInterval[]);
  const [occupancy, blackoutRes, external] = await Promise.all([
    listOccupancy([...unitIds, ...scope, ...(opts?.alsoBusyUnitIds ?? [])], fromIso, toIso, opts?.excludeBookingId),
    unitIds.length
      ? admin
          .from("rental_unit_blackouts")
          .select("rental_unit_id, start_date, end_date")
          .in("rental_unit_id", [...unitIds, ...scope])
          .gte("end_date", addDaysISO(fromDate, -1))
          .lte("start_date", addDaysISO(fromDate, days + 1))
      : Promise.resolve({ data: [], error: null }),
    externalPromise,
  ]);
  if (blackoutRes.error) throw blackoutRes.error;
  const blackoutMap = blackoutBusy(
    (blackoutRes.data ?? []).map((b) => ({
      unitId: b.rental_unit_id,
      startDate: b.start_date,
      endDate: b.end_date,
    })),
    timeZone,
  );
  const extraUnitIds = new Set([...scope, ...(opts?.alsoBusyUnitIds ?? [])]);
  const toBusy = (b: OccupancyRow): BusyInterval => ({
    startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), bufferAfterMin: offering.turnoverMin,
  });
  const perUnit = units.map((u) => ({
    unitId: u.id,
    busy: [
      ...occupancy.filter((b) => b.rental_unit_id === u.id || extraUnitIds.has(b.rental_unit_id)).map(toBusy),
      ...(blackoutMap.get(u.id) ?? []),
      // A blackout on an included room blocks the whole studio (ruling 7).
      ...scope.flatMap((id) => blackoutMap.get(id) ?? []),
      ...external,
    ],
  }));
  return { offering, units, rules, exceptions, perUnit };
}

export type PublicEquipment = EquipmentOffering & { units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[] };

// S6: the org's active equipment spaces with what is busy in the window —
// the add-on step's "N available" and the reschedule panels' fold-in.
export async function listEquipmentAvailability(
  orgId: string,
  fromIso: string,
  toIso: string,
  opts?: { excludeBookingId?: string; allowedUnitIds?: ReadonlySet<string> | null },
): Promise<PublicEquipment[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offerings")
    .select("id, name, price_cents, pricing_mode, rental_units(id, active)")
    .eq("org_id", orgId)
    .eq("kind", "equipment")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  const rows = (data ?? []) as unknown as { id: string; name: string; price_cents: number | null; pricing_mode: "per_unit" | "flat"; rental_units: { id: string; active: boolean }[] | null }[];
  const equipment = rows
    .map((r) => ({
      id: r.id, name: r.name, priceCents: r.price_cents, pricingMode: r.pricing_mode,
      unitIds: (r.rental_units ?? []).filter((u) => u.active && (!opts?.allowedUnitIds || opts.allowedUnitIds.has(u.id))).map((u) => u.id),
    }))
    .filter((r) => r.unitIds.length > 0 && r.priceCents !== null);
  const occupancy = await listOccupancy(equipment.flatMap((e) => e.unitIds), fromIso, toIso, opts?.excludeBookingId);
  return equipment.map((e) => ({
    id: e.id, name: e.name, priceCents: e.priceCents, pricingMode: e.pricingMode, unitCount: e.unitIds.length,
    units: e.unitIds.map((id) => ({
      id,
      busy: occupancy.filter((b) => b.rental_unit_id === id).map((b) => ({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) })),
    })),
  }));
}

// S6: the equipment units a booking holds (for the reschedule fold-in).
export async function listBookingEquipmentUnitIds(bookingId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("booking_units").select("rental_unit_id").eq("booking_id", bookingId).eq("kind", "equipment");
  if (error) throw error;
  return (data ?? []).map((r) => r.rental_unit_id as string);
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

/** S1/S3: the money a committed booking actually carries — the RPC's own
    snapshot on the row, never a recomputation (a rules-priced offering has
    no single totalCents formula to re-derive, and the studio may have edited
    its rules or its policy since). Shaped for moneyInfoLines; the currency
    is the one the RPC stamped alongside the total. `paidCents` / `feeCents`
    / `startsAt` are here for the reschedule settlement (manage-actions). */
export async function getBookingMoney(bookingId: string): Promise<{
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  cancelPolicy: CancelPolicy | null;
  feeCents: number;
  paidCents: number;
  refundedCents: number;
  startsAt: Date | null;
  lines: Line[] | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("lines, price_cents, deposit_cents, currency, cancel_policy, fee_cents, paid_cents, refunded_cents, starts_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) console.error("[booking] getBookingMoney:", error);
  const row = data as {
    lines: unknown;
    price_cents: number | null;
    deposit_cents: number | null;
    currency: string | null;
    cancel_policy: CancelPolicy | null;
    fee_cents: number;
    paid_cents: number;
    refunded_cents: number;
    starts_at: string;
  } | null;
  return {
    totalCents: row?.price_cents ?? null,
    depositCents: row?.deposit_cents ?? null,
    currency: row?.currency ?? null,
    cancelPolicy: row?.cancel_policy ?? null,
    feeCents: row?.fee_cents ?? 0,
    paidCents: row?.paid_cents ?? 0,
    refundedCents: row?.refunded_cents ?? 0,
    startsAt: row ? new Date(row.starts_at) : null,
    lines: (row?.lines as Line[] | null) ?? null,
  };
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

/** S6: the OTHER units a booking holds (booking_units, 0084) — the rooms a
    whole-studio stay swallows, the lamps an add-on reserves. Named for the
    client on the manage page; only rows that still RESERVE, so a cancelled
    booking prints nothing. Sorted: PostgREST's order is arbitrary and the
    line must not reshuffle between two loads. */
export async function listBookingAlsoReserved(bookingId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("booking_units")
    .select("rental_units(name)")
    .eq("booking_id", bookingId)
    .eq("reserving", true)
    .neq("kind", "primary");
  if (error) {
    console.error("[booking] listBookingAlsoReserved:", error);
    return [];
  }
  if (!data) return [];
  return (data as unknown as Array<{ rental_units: { name: string } | null }>)
    .map((r) => r.rental_units?.name)
    .filter((n): n is string => !!n)
    .sort();
}
