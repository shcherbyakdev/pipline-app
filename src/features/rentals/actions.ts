"use server";

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
  patchOfferingInput,
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
/** Everything but the name and description — the space page edits those in
    place (patchOffering); the settings form saves the rest. Distributive so
    each mode's branch keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// S6's kind/componentIds/itemCount are create-only and never a settings
// column write, so they are omitted here too: the same helper serves the
// create payload and the (kind-less) settings payload.
type OfferingSettings = DistributiveOmit<
  import("zod").infer<typeof offeringInput>,
  "name" | "description" | "kind" | "componentIds" | "itemCount"
>;
function toOfferingSettingsRow(d: OfferingSettings) {
  const common = {
    range_mode: d.rangeMode,
    booking_window_days: d.bookingWindowDays,
    unit_selection: d.unitSelection,
    active: d.active,
    requires_approval: d.requiresApproval,
    price_cents: d.priceCents,
    pricing_mode: d.pricingMode,
    deposit_type: d.depositType,
    deposit_value: d.depositValue,
    cancel_policy: d.cancelPolicy,
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
      pricing: d.pricing,
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
    pricing: null,
  };
}

function toOfferingRow(d: import("zod").infer<typeof offeringInput>) {
  return {
    name: d.name,
    description: d.description ?? null,
    // S6: set once, here. The settings form has no `kind` (strict schema),
    // so an existing space can never change what it is.
    kind: d.rangeMode === "hours" ? d.kind : "space",
    ...toOfferingSettingsRow(d),
  };
}

/** How many units a new space starts with: one, unless it is an equipment
    space — there the units ARE the physical items. */
function itemCountOf(d: import("zod").infer<typeof offeringInput>): number {
  return d.rangeMode === "hours" && d.kind === "equipment" ? d.itemCount : 1;
}

/** A single-unit space never shows its unit — the space is the unit — so
    the unit's name follows the space's. Best-effort: a stale unit name only
    shows where two names differ (unit-label.ts), never blocks the save. */
async function syncSingleUnitName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  offeringId: string,
  name: string,
) {
  const { data: units, error: unitsError } = await supabase
    .from("rental_units")
    .select("id")
    .eq("offering_id", offeringId)
    .limit(2);
  if (unitsError) {
    console.error("[rentals] unit lookup:", unitsError);
    return;
  }
  if (units?.length !== 1) return;
  const { error } = await supabase
    .from("rental_units")
    .update({ name })
    .eq("id", units[0].id)
    .eq("org_id", orgId);
  if (error) console.error("[rentals] unit rename:", error);
}

export async function createOffering(input: unknown): Promise<ActionState> {
  const parsed = offeringInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const supabase = await createClient();
  // A space is its own bookable unit until split (#109), and it reaches the
  // public page only through an active unit (lib/booking/public.ts
  // listPublicOfferings; the page 404s until something is bookable,
  // landing-claim D9). So the space and its first unit are one thing: the
  // plan gate that would refuse the unit refuses the space — a saved space
  // that could not be booked pointed the owner at "add a unit", which the
  // same gate refused — and a failed unit insert takes the space back out.
  const refused = await assertCanAddUnit(orgId, supabase);
  if (refused) return refused;
  const { data, error } = await supabase
    .from("rental_offerings")
    .insert({ org_id: orgId, ...toOfferingRow(parsed.data) })
    .select("id")
    .single();
  if (error) return fail("createOffering", error);
  const firstUnit = {
    org_id: orgId,
    offering_id: data.id,
    name: parsed.data.name,
    description: null,
    active: true,
    // Spelled out, not left to the column default: PostgREST unions a bulk
    // insert's keys and sends NULL for a key a row omits, so one row without
    // it would break the whole array on sort_order's NOT NULL.
    sort_order: 0,
  };
  // Equipment: every item is a unit, numbered after the first — one
  // statement, so the undo below still covers the whole set. The plan gate
  // above is spent once, on the first item; anything past the budget simply
  // isn't offered publicly (allowedUnitIds, H5b), which is the honest cap.
  const items = itemCountOf(parsed.data);
  const { error: unitError } = await supabase.from("rental_units").insert(
    items > 1
      ? [
          firstUnit,
          ...Array.from({ length: items - 1 }, (_, i) => ({
            ...firstUnit,
            name: `${parsed.data.name} ${i + 2}`,
            sort_order: i + 1,
          })),
        ]
      : firstUnit,
  );
  if (unitError) {
    const { error: undoError } = await supabase
      .from("rental_offerings")
      .delete()
      .eq("id", data.id)
      .eq("org_id", orgId);
    if (undoError) console.error("[rentals] createOffering undo:", undoError);
    return fail("createOffering first unit", unitError);
  }
  // A composite is the rooms it includes — without them it blocks nothing,
  // so a failed link takes the whole space back out (units cascade with it).
  if (parsed.data.rangeMode === "hours" && parsed.data.kind === "composite") {
    const { error: componentsError } = await supabase.from("rental_offering_components").insert(
      parsed.data.componentIds.map((component_id) => ({
        composite_id: data.id,
        component_id,
        org_id: orgId,
      })),
    );
    if (componentsError) {
      const { error: undoError } = await supabase
        .from("rental_offerings")
        .delete()
        .eq("id", data.id)
        .eq("org_id", orgId);
      if (undoError) console.error("[rentals] createOffering undo:", undoError);
      return fail("createOffering components", componentsError);
    }
  }
  // An hourly space has no check-in/check-out times to fall back on, so with
  // no weekly hours it offers nothing — the same dead start a new team
  // member used to get. Nights/days spaces have no weekly hours at all
  // (admin IA ruling 4), so only "hours" gets a week.
  let notice: string | undefined;
  // Equipment is never booked on its own (it rides a room booking), so a
  // week of its own would only be noise.
  if (parsed.data.rangeMode === "hours" && parsed.data.kind !== "equipment") {
    const seedError = await seedDefaultHours(supabase, orgId, { rentalOfferingId: data.id });
    if (seedError) {
      console.error("[rentals] createOffering default hours:", seedError.message);
      notice = (await getTranslations("spaces"))("hoursNotSet");
    }
  }
  revalidatePath("/rentals");
  revalidatePath("/availability");
  return notice ? { ok: true, notice } : { ok: true };
}

export async function updateOffering(input: unknown): Promise<ActionState> {
  const parsed = updateOfferingInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  // The settings only: the schema has no name or description here (the
  // space page edits those in place through patchOffering).
  const { data, error } = await supabase
    .from("rental_offerings")
    .update(toOfferingSettingsRow(rest))
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateOffering", error);
  if (!data) return generic();
  // S6: a composite's save replaces the rooms it includes (the form always
  // posts the whole list). Only a composite carries the key. Add first, drop
  // second, and never in one delete-then-insert: there is no transaction
  // here, and a failure between the two would leave a studio that includes
  // NOTHING — it would block no room and take double bookings. This way the
  // worst a half-done save leaves is a room still included.
  const componentIds = "componentIds" in rest ? rest.componentIds : undefined;
  if (componentIds) {
    const { error: linkError } = await supabase
      .from("rental_offering_components")
      .upsert(
        componentIds.map((component_id) => ({ composite_id: id, component_id, org_id: orgId })),
        { onConflict: "composite_id,component_id", ignoreDuplicates: true },
      );
    if (linkError) return fail("updateOffering components", linkError);
    const { error: dropError } = await supabase
      .from("rental_offering_components")
      .delete()
      .eq("composite_id", id)
      .eq("org_id", orgId)
      .not("component_id", "in", `(${componentIds.join(",")})`);
    if (dropError) return fail("updateOffering components", dropError);
  }
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${id}`);
  revalidatePath("/availability");
  return { ok: true };
}

/** The in-place header on /rentals/[id]: one field per blur. */
export async function patchOffering(input: unknown): Promise<ActionState> {
  const parsed = patchOfferingInput.safeParse(input);
  if (!parsed.success) return generic();
  const orgId = await currentOrgId();
  if (!orgId) return generic();
  const { id, name, description } = parsed.data;
  const patch: { name?: string; description?: string | null } = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (Object.keys(patch).length === 0) return { ok: true };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_offerings")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("patchOffering", error);
  if (!data) return generic();
  if (name !== undefined) await syncSingleUnitName(supabase, orgId, id, name);
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
  // S6: a composite IS one unit — it holds every room it includes, so a
  // second unit of its own would reserve nothing. Split the rooms instead.
  const { data: parent, error: parentError } = await supabase
    .from("rental_offerings")
    .select("kind")
    .eq("id", parsed.data.offeringId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (parentError) return fail("createUnit", parentError);
  if (!parent) return generic();
  if (parent.kind === "composite") {
    return { ok: false, error: (await errorsT())("spaces.compositeHasOneUnit") };
  }
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
  // A space is its own unit until split: its last unit goes only with the
  // space. Without one the space cannot be booked, and on a capped plan it
  // could not get one back (createOffering's gate). UX guard, not security:
  // offeringId is the caller's, and RLS already scopes both to the org.
  const { data: siblings, error: siblingsError } = await supabase
    .from("rental_units")
    .select("id")
    .eq("org_id", orgId)
    .eq("offering_id", parsed.data.offeringId)
    .limit(2);
  if (siblingsError) return fail("deleteUnit", siblingsError);
  if ((siblings?.length ?? 0) < 2) return { ok: false, error: (await errorsT())("spaces.lastUnit") };
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
