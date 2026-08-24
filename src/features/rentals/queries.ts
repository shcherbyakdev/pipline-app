import { createClient } from "@/lib/supabase/server";
import type { RangeMode } from "./range";
import { addDaysISO, wallTimeToUtc } from "@/features/scheduling/slots";
import { TIMELINE_DAYS } from "./timeline-geometry";
import {
  BOOKING_COLUMNS,
  toAdminBooking,
  type AdminBooking,
  type BookingRow,
} from "@/features/scheduling/queries";

export type OfferingRow = {
  id: string;
  name: string;
  description: string | null;
  rangeMode: RangeMode;
  // H2: nights/days always set these (0056 CHECK); hours reads opening
  // hours from availability_rules instead, so both are null there
  // (public.ts's PublicOffering precedent).
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
  active: boolean;
  sortOrder: number;
  unitCount: number;
  priceCents: number | null;
  pricingMode: "per_unit" | "flat";
  depositType: "none" | "fixed" | "percent" | "full";
  depositValue: number | null;
  cancelWindowMin: number;
  termsText: string | null;
};

// Exported for the queries.integration.test.ts probe: the count embed's
// shape (`rental_units(count)` → `[{count: n}]`) is asserted against the
// live PostgREST instance rather than assumed.
export const OFFERING_COLUMNS =
  "id, name, description, range_mode, start_time, end_time, min_stay, max_stay, turnover_days, min_notice_days, booking_window_days, unit_selection, slot_increment_min, min_duration_min, max_duration_min, turnover_min, min_notice_min, active, sort_order, price_cents, pricing_mode, deposit_type, deposit_value, cancel_window_min, terms_text, rental_units(count)";

type OfferingDb = {
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
  active: boolean;
  sort_order: number;
  price_cents: number | null;
  pricing_mode: "per_unit" | "flat";
  deposit_type: "none" | "fixed" | "percent" | "full";
  deposit_value: number | null;
  cancel_window_min: number;
  terms_text: string | null;
  rental_units: Array<{ count: number }> | null;
};

function toOffering(o: OfferingDb): OfferingRow {
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
    active: o.active,
    sortOrder: o.sort_order,
    unitCount: o.rental_units?.[0]?.count ?? 0,
    priceCents: o.price_cents,
    pricingMode: o.pricing_mode,
    depositType: o.deposit_type,
    depositValue: o.deposit_value,
    cancelWindowMin: o.cancel_window_min,
    termsText: o.terms_text,
  };
}

export async function listOfferings(): Promise<OfferingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .select(OFFERING_COLUMNS)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as OfferingDb[]).map(toOffering);
}

export async function getOffering(id: string): Promise<OfferingRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .select(OFFERING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toOffering(data as unknown as OfferingDb) : null;
}

export type UnitRow = {
  id: string;
  offeringId: string;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
};
export type BlackoutRow = {
  id: string;
  rentalUnitId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

type UnitDb = {
  id: string;
  offering_id: string;
  name: string;
  description: string | null;
  active: boolean;
  sort_order: number;
  rental_unit_blackouts: Array<{
    id: string;
    rental_unit_id: string;
    start_date: string;
    end_date: string;
    reason: string | null;
  }> | null;
};

export async function listUnitsWithBlackouts(
  offeringId: string,
): Promise<Array<UnitRow & { blackouts: BlackoutRow[] }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_units")
    .select(
      "id, offering_id, name, description, active, sort_order, rental_unit_blackouts(id, rental_unit_id, start_date, end_date, reason)",
    )
    .eq("offering_id", offeringId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as unknown as UnitDb[]).map((u) => ({
    id: u.id,
    offeringId: u.offering_id,
    name: u.name,
    description: u.description,
    active: u.active,
    sortOrder: u.sort_order,
    blackouts: (u.rental_unit_blackouts ?? [])
      .map((b) => ({
        id: b.id,
        rentalUnitId: b.rental_unit_id,
        startDate: b.start_date,
        endDate: b.end_date,
        reason: b.reason,
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
  }));
}

export type TimelineOffering = {
  id: string;
  name: string;
  rangeMode: RangeMode;
  turnoverDays: number;
  units: Array<{ id: string; name: string; active: boolean }>;
};
export type TimelineBlackout = {
  id: string;
  unitId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

type TimelineOfferingDb = {
  id: string;
  name: string;
  range_mode: RangeMode;
  turnover_days: number;
  active: boolean;
  rental_units: Array<{ id: string; name: string; active: boolean; sort_order: number }> | null;
};
type TimelineBlackoutDb = {
  id: string;
  rental_unit_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
};

// Admin week-span timeline (a Gantt-style grid): offerings/units, their
// blackouts, and confirmed bookings for a `days`-wide org-local window
// starting at `fromDate`. `timeZone` is only needed to turn the window's
// wall-clock bounds into the UTC instants `bookings.starts_at/ends_at` are
// compared against — everything else stays in date-string arithmetic.
export async function listTimelineData(
  fromDate: string,
  timeZone: string,
  days: number = TIMELINE_DAYS,
): Promise<{ offerings: TimelineOffering[]; blackouts: TimelineBlackout[]; bookings: AdminBooking[] }> {
  const supabase = await createClient();
  const lastDate = addDaysISO(fromDate, days - 1);
  const exclusiveToDate = addDaysISO(fromDate, days);
  const toIso = wallTimeToUtc(exclusiveToDate, "00:00", timeZone).toISOString();

  const { data: offeringRows, error: offeringsError } = await supabase
    .from("rental_offerings")
    .select("id, name, range_mode, turnover_days, active, rental_units(id, name, active, sort_order)")
    .order("sort_order")
    .order("name");
  if (offeringsError) throw offeringsError;
  // Timeline: hourly offerings do not appear (spec) — it's a date-range grid
  // (Gantt-style, one column per day), and an hourly offering has no bar to
  // draw there. Filtered out here, before maxTurnover/allUnitIds are
  // derived, so its units drop out of the blackout fetch too.
  const offeringDb = ((offeringRows ?? []) as unknown as TimelineOfferingDb[]).filter(
    (o) => o.range_mode !== "hours",
  );

  // A stay's turnover tail (post-checkout cleaning/prep) can hang into the
  // window even when the stay itself checked out before `fromDate` — the
  // bookings fetch's lower bound widens by the widest turnover_days among
  // the org's offerings so that booking still comes back. Blackouts carry
  // no turnover, so their own fetch (below) keeps the unwidened `fromDate`.
  const maxTurnover = Math.max(0, ...offeringDb.map((o) => o.turnover_days ?? 0));
  const fromIso = wallTimeToUtc(addDaysISO(fromDate, -maxTurnover), "00:00", timeZone).toISOString();

  const allUnitIds = offeringDb.flatMap((o) => (o.rental_units ?? []).map((u) => u.id));

  const [blackoutsRes, bookingsRes] = await Promise.all([
    allUnitIds.length > 0
      ? supabase
          .from("rental_unit_blackouts")
          .select("id, rental_unit_id, start_date, end_date, reason")
          .in("rental_unit_id", allUnitIds)
          .gte("end_date", fromDate)
          .lte("start_date", lastDate)
      : Promise.resolve({ data: [] as TimelineBlackoutDb[], error: null }),
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("status", "confirmed")
      .not("rental_unit_id", "is", null)
      .lt("starts_at", toIso)
      .gt("ends_at", fromIso)
      .order("starts_at", { ascending: true }),
  ]);
  if (blackoutsRes.error) throw blackoutsRes.error;
  if (bookingsRes.error) throw bookingsRes.error;

  const bookings = ((bookingsRes.data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
  const bookedUnitIds = new Set(bookings.map((b) => b.rentalUnitId).filter((id): id is string => id !== null));
  const bookedOfferingIds = new Set(
    bookings.map((b) => b.rentalOfferingId).filter((id): id is string => id !== null),
  );

  const offerings: TimelineOffering[] = offeringDb
    .filter((o) => o.active || bookedOfferingIds.has(o.id))
    .map((o) => ({
      id: o.id,
      name: o.name,
      rangeMode: o.range_mode,
      turnoverDays: o.turnover_days,
      units: (o.rental_units ?? [])
        .filter((u) => u.active || bookedUnitIds.has(u.id))
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        .map((u) => ({ id: u.id, name: u.name, active: u.active })),
    }))
    .filter((o) => o.units.length > 0);

  const keptUnitIds = new Set(offerings.flatMap((o) => o.units.map((u) => u.id)));
  const blackouts: TimelineBlackout[] = ((blackoutsRes.data ?? []) as unknown as TimelineBlackoutDb[])
    .filter((b) => keptUnitIds.has(b.rental_unit_id))
    .map((b) => ({
      id: b.id,
      unitId: b.rental_unit_id,
      startDate: b.start_date,
      endDate: b.end_date,
      reason: b.reason,
    }));

  return { offerings, blackouts, bookings };
}

// The org's settlement currency for money display (single-org session).
export async function getOrgCurrency(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("currency").limit(1).maybeSingle();
  return (data as { currency: string } | null)?.currency ?? "PLN";
}
