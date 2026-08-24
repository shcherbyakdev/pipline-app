"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import {
  offeringInput,
  updateOfferingInput,
  offeringIdInput,
  unitInput,
  updateUnitInput,
  unitIdInput,
  blackoutInput,
  blackoutIdInput,
  BLACKOUT_ORDER_MSG,
  BLACKOUT_SPAN_MSG,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

const HAS_BOOKINGS = "It has bookings — deactivate it instead.";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[rentals] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// The session's single org — null while its `rentals` flag is off
// (lib/flags): rentals are on by default since H1, and the flag is a kill
// switch, so every caller's null branch (the generic error) is the
// server-side defence while it's off (public-actions.ts idiom).
async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  if (!data) return null;
  if (!(await getDashboardFlags(data.id)).rentals) return null;
  return data.id;
}

// No org_id here (updates must never rewrite it — scheduling/actions.ts idiom).
// The input is a rangeMode-discriminated union (0055): write null/the column
// default for whichever branch's fields the mode doesn't carry, so switching
// an offering's mode never leaves a stale value from the other branch behind.
function toOfferingRow(d: import("zod").infer<typeof offeringInput>) {
  const common = {
    name: d.name,
    description: d.description ?? null,
    price_label: d.priceLabel ?? null,
    range_mode: d.rangeMode,
    booking_window_days: d.bookingWindowDays,
    unit_selection: d.unitSelection,
    active: d.active,
  };
  if (d.rangeMode === "hours") {
    return {
      ...common,
      start_time: null,
      end_time: null,
      min_stay: 1,
      max_stay: null,
      turnover_days: 0,
      min_notice_days: 0,
      slot_increment_min: d.slotIncrementMin,
      min_duration_min: d.minDurationMin,
      max_duration_min: d.maxDurationMin,
      turnover_min: d.turnoverMin,
      min_notice_min: d.minNoticeMin,
    };
  }
  return {
    ...common,
    start_time: d.startTime,
    end_time: d.endTime,
    min_stay: d.minStay,
    max_stay: d.maxStay,
    turnover_days: d.turnoverDays,
    min_notice_days: d.minNoticeDays,
    slot_increment_min: null,
    min_duration_min: null,
    max_duration_min: null,
    turnover_min: 0,
    min_notice_min: 0,
  };
}

export async function createOffering(input: unknown): Promise<ActionState> {
  const parsed = offeringInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_offerings")
    .insert({ org_id: orgId, ...toOfferingRow(parsed.data) });
  if (error) return fail("createOffering", error);
  revalidatePath("/rentals");
  return { ok: true };
}

export async function updateOffering(input: unknown): Promise<ActionState> {
  const parsed = updateOfferingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .update(toOfferingRow(rest))
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateOffering", error);
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${id}`);
  return { ok: true };
}

export async function deleteOffering(input: unknown): Promise<ActionState> {
  const parsed = offeringIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_offerings")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") return { ok: false, error: HAS_BOOKINGS };
    return fail("deleteOffering", error);
  }
  revalidatePath("/rentals");
  return { ok: true };
}

export async function createUnit(input: unknown): Promise<ActionState> {
  const parsed = unitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("rental_units").insert({
    org_id: orgId,
    offering_id: parsed.data.offeringId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    active: parsed.data.active,
  });
  // The org-guard trigger rejects a foreign offering (offering's org != orgId).
  if (error) return fail("createUnit", error);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function updateUnit(input: unknown): Promise<ActionState> {
  const parsed = updateUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_units")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
    })
    .eq("id", parsed.data.id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateUnit", error);
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function deleteUnit(input: unknown): Promise<ActionState> {
  const parsed = unitIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_units")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") return { ok: false, error: HAS_BOOKINGS };
    return fail("deleteUnit", error);
  }
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function addBlackout(input: unknown): Promise<ActionState> {
  const parsed = blackoutInput.safeParse(input);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => i.message);
    if (messages.includes(BLACKOUT_SPAN_MSG)) return { ok: false, error: BLACKOUT_SPAN_MSG };
    if (messages.includes(BLACKOUT_ORDER_MSG)) return { ok: false, error: BLACKOUT_ORDER_MSG };
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("rental_unit_blackouts").insert({
    org_id: orgId,
    rental_unit_id: parsed.data.rentalUnitId,
    start_date: parsed.data.startDate,
    end_date: parsed.data.endDate,
    reason: parsed.data.reason || null,
  });
  if (error) return fail("addBlackout", error);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function deleteBlackout(input: unknown): Promise<ActionState> {
  const parsed = blackoutIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_unit_blackouts")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) return fail("deleteBlackout", error);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}
