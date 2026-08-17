import { createClient } from "@/lib/supabase/server";
import type { RangeMode } from "./range";

export type OfferingRow = {
  id: string;
  name: string;
  description: string | null;
  priceLabel: string | null;
  rangeMode: RangeMode;
  // `text`, not `time` — 0037's `rental_offerings_start_time_fmt` CHECK pins
  // both to "HH:MM", so they need no normalising for <input type="time">.
  startTime: string;
  endTime: string;
  minStay: number;
  maxStay: number | null;
  turnoverDays: number;
  minNoticeDays: number;
  bookingWindowDays: number;
  unitSelection: "auto" | "client_picks";
  active: boolean;
  sortOrder: number;
  unitCount: number;
};

// Exported for the queries.integration.test.ts probe: the count embed's
// shape (`rental_units(count)` → `[{count: n}]`) is asserted against the
// live PostgREST instance rather than assumed.
export const OFFERING_COLUMNS =
  "id, name, description, price_label, range_mode, start_time, end_time, min_stay, max_stay, turnover_days, min_notice_days, booking_window_days, unit_selection, active, sort_order, rental_units(count)";

type OfferingDb = {
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
  active: boolean;
  sort_order: number;
  rental_units: Array<{ count: number }> | null;
};

function toOffering(o: OfferingDb): OfferingRow {
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
    active: o.active,
    sortOrder: o.sort_order,
    unitCount: o.rental_units?.[0]?.count ?? 0,
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
