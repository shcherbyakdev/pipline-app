"use server";

import type { UpgradeDoor } from "@/lib/billing/refusal";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { assertCanAddUnit } from "@/lib/billing/gates";
import { seedDefaultHours } from "@/features/scheduling/default-hours";
import {
  offeringInput,
  updateOfferingInput,
  offeringIdInput,
  offeringActiveInput,
  unitInput,
  updateUnitInput,
  unitIdInput,
  blackoutInput,
  blackoutIdInput,
  BLACKOUT_ORDER_MSG,
  BLACKOUT_SPAN_MSG,
  type ActionState,
} from "./schema";

// Error copy in the admin's language (i18n Wave 3): every refusal a client
// shows comes out of `errors.*`, resolved per request.
const errorsT = () => getTranslations("errors");

async function generic(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: (await errorsT())("generic") };
}

async function fail(context: string, error: unknown): Promise<{ ok: false; error: string }> {
  console.error(`[rentals] ${context}:`, error);
  return generic();
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
    range_mode: d.rangeMode,
    booking_window_days: d.bookingWindowDays,
    unit_selection: d.unitSelection,
    active: d.active,
    requires_approval: d.requiresApproval,
    price_cents: d.priceCents,
    pricing_mode: d.pricingMode,
    deposit_type: d.depositType,
    deposit_value: d.depositValue,
    cancel_window_min: d.cancelWindowMin,
    terms_text: d.termsText ?? null,
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
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .insert({ org_id: orgId, ...toOfferingRow(parsed.data) })
    .select("id")
    .single();
  if (error) return fail("createOffering", error);
  // A space reaches the public page only once it has an active unit
  // (lib/booking/public.ts listPublicOfferings) — and the page 404s until
  // something is bookable (landing-claim D9). Most spaces are one bookable
  // thing, so the space starts with one unit named after itself; the units
  // editor still serves multi-unit spaces. Same plan gate as createUnit: if
  // the plan refuses, the space is still saved and the owner told why.
  let notice: string | undefined;
  let upgrade: UpgradeDoor | null = null;
  const refused = await assertCanAddUnit(orgId, supabase);
  if (refused) {
    notice = refused.error;
    upgrade = refused.upgrade;
  } else {
    const { error: unitError } = await supabase.from("rental_units").insert({
      org_id: orgId,
      offering_id: data.id,
      name: parsed.data.name,
      description: null,
      active: true,
    });
    if (unitError) {
      console.error("[rentals] createOffering first unit:", unitError);
      notice = (await getTranslations("spaces"))("unitNotCreated");
    }
  }
  // An hourly space has no check-in/check-out times to fall back on, so with
  // no weekly hours it offers nothing — the same dead start a new team
  // member used to get. Nights/days spaces have no weekly hours at all
  // (admin IA ruling 4), so only "hours" gets a week. The unit notice wins
  // if both fail: a space with no unit is the more blocking of the two.
  if (parsed.data.rangeMode === "hours") {
    const seedError = await seedDefaultHours(supabase, orgId, { rentalOfferingId: data.id });
    if (seedError) {
      console.error("[rentals] createOffering default hours:", seedError.message);
      notice ??= (await getTranslations("spaces"))("hoursNotSet");
    }
  }
  revalidatePath("/rentals");
  revalidatePath("/availability");
  return notice ? { ok: true, notice, ...(upgrade ? { upgrade } : {}) } : { ok: true };
}

export async function updateOffering(input: unknown): Promise<ActionState> {
  const parsed = updateOfferingInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
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
  if (!data) return generic();
  // A single-unit space never shows its unit — the space is the unit — so
  // the unit's name follows the space's. Best-effort: a stale unit name only
  // shows where two names differ (unit-label.ts), never blocks the save.
  const { data: units, error: unitsError } = await supabase
    .from("rental_units")
    .select("id")
    .eq("offering_id", id)
    .limit(2);
  if (unitsError) console.error("[rentals] updateOffering units:", unitsError);
  else if (units?.length === 1) {
    const { error: renameError } = await supabase
      .from("rental_units")
      .update({ name: rest.name })
      .eq("id", units[0].id)
      .eq("org_id", orgId);
    if (renameError) console.error("[rentals] updateOffering unit rename:", renameError);
  }
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/availability");
  return { ok: true };
}

/* The row switch on /rentals — same shape as setStaffActive, and the same
   gate posture as updateOffering (which already flips `active` ungated). */
export async function setOfferingActive(input: unknown): Promise<ActionState> {
  const parsed = offeringActiveInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("setOfferingActive", error);
  if (!data) return generic();
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.id}`);
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteOffering(input: unknown): Promise<ActionState> {
  const parsed = offeringIdInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_offerings")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") return { ok: false, error: (await errorsT())("spaces.hasBookings") };
    return fail("deleteOffering", error);
  }
  revalidatePath("/rentals");
  revalidatePath("/availability");
  return { ok: true };
}

export async function createUnit(input: unknown): Promise<ActionState> {
  const parsed = unitInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  // H5b: a unit spends the plan's resource budget like a person does.
  if (parsed.data.active) {
    const refused = await assertCanAddUnit(orgId, supabase);
    if (refused) return refused;
  }
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
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  // H5b: only a false → true flip spends a resource; editing an already
  // active unit's name at the cap must keep working. Mirrors setStaffActive.
  if (parsed.data.active) {
    const { data: current, error: readError } = await supabase
      .from("rental_units")
      .select("active")
      .eq("id", parsed.data.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (readError) return fail("updateUnit", readError);
    if (!current) return generic();
    if (!current.active) {
      const refused = await assertCanAddUnit(orgId, supabase);
      if (refused) return refused;
    }
  }
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
  if (!data) return generic();
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function deleteUnit(input: unknown): Promise<ActionState> {
  const parsed = unitIdInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  const { error } = await supabase
    .from("rental_units")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") return { ok: false, error: (await errorsT())("spaces.hasBookings") };
    return fail("deleteUnit", error);
  }
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function addBlackout(input: unknown): Promise<ActionState> {
  const parsed = blackoutInput.safeParse(input);
  if (!parsed.success) {
    // The schema's refine sentinels (schema.ts) name which rule failed; the
    // person reads the rule in their language.
    const messages = parsed.error.issues.map((i) => i.message);
    const key = messages.includes(BLACKOUT_SPAN_MSG)
      ? "spaces.blackoutSpan"
      : messages.includes(BLACKOUT_ORDER_MSG)
        ? "spaces.blackoutOrder"
        : "generic";
    return { ok: false, error: (await errorsT())(key) };
  }
  const orgId = await currentOrgId();
  if (!orgId) return generic();
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
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
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
