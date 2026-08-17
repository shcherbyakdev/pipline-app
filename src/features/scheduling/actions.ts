"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  serviceInput,
  updateServiceInput,
  serviceIdInput,
  availabilityRuleInput,
  ruleIdInput,
  blockTimeInput,
  reopenDayInput,
  schedulingSettingsInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
  OVERLAP_ERROR,
  updateRuleInput,
  copyDayHoursInput,
  dateOverrideInput,
  deleteOverrideInput,
} from "./schema";
import { effectiveWindows, subtractRange, addRange } from "./day-windows";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

// No org_id here: inserts add it explicitly, updates must never rewrite it
// (a multi-org user's currentOrgId() pick could otherwise migrate the row
// between their orgs — security-review hardening).
function toServiceRow(d: import("zod").infer<typeof serviceInput>) {
  return {
    name: d.name,
    description: d.description ?? null,
    duration_min: d.durationMin,
    price_label: d.priceLabel ?? null,
    buffer_before_min: d.bufferBeforeMin,
    buffer_after_min: d.bufferAfterMin,
    min_notice_min: d.minNoticeMin,
    max_per_day: d.maxPerDay,
    booking_window_days: d.bookingWindowDays,
    active: d.active,
  };
}

export async function createService(input: unknown): Promise<ActionState> {
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .insert({ org_id: orgId, ...toServiceRow(parsed.data) });
  if (error) return fail("createService", error);
  revalidatePath("/services");
  return { ok: true };
}

export async function updateService(input: unknown): Promise<ActionState> {
  const parsed = updateServiceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update(toServiceRow(rest))
    .eq("id", id)
    // RLS already hides foreign rows; the explicit org scope is
    // defense-in-depth and keeps multi-org sessions unambiguous.
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateService", error);
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidatePath("/services");
  return { ok: true };
}

export async function deleteService(input: unknown): Promise<ActionState> {
  const parsed = serviceIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Service has bookings — deactivate it instead." };
    }
    return fail("deleteService", error);
  }
  revalidatePath("/services");
  return { ok: true };
}

// EXCLUDE-guard violations (0035) — the DB is the authority on overlaps;
// map to the same message the client shows.
const OVERLAP_DB_CODE = "23P01";

export async function addAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = availabilityRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("availability_rules").insert({
    org_id: orgId,
    weekday: parsed.data.weekday,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
  });
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("addAvailabilityRule", error);
  }
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

export async function deleteAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = ruleIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_rules")
    .delete()
    .eq("id", parsed.data.id)
    // Explicit org scope (defense-in-depth, mirrors deleteService) —
    // Task 11 hardening precedent applied to the delete actions here.
    .eq("org_id", orgId);
  if (error) return fail("deleteAvailabilityRule", error);
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

// Block [startTime,endTime) on one date: rewrite that date's exceptions to
// (effective windows − range). Empty result ⇒ a single closed row. The day's
// prior exceptions are consumed (they fed effectiveWindows). Sequential
// calls, like the sibling availability actions — solo-admin orgs make the
// non-atomic window negligible (spec).
export async function blockTimeRange(input: unknown): Promise<ActionState> {
  const parsed = blockTimeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { date, startTime, endTime } = parsed.data;

  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_time, end_time").eq("org_id", orgId),
    supabase.from("availability_exceptions").select("date, closed, start_time, end_time")
      .eq("org_id", orgId).eq("date", date),
  ]);
  if (rulesRes.error) return fail("blockTimeRange", rulesRes.error);
  if (exceptionsRes.error) return fail("blockTimeRange", exceptionsRes.error);

  const windows = effectiveWindows(
    date,
    (rulesRes.data ?? []).map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })),
    (exceptionsRes.data ?? []).map((e) => ({
      date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
    })),
  );
  if (windows.length === 0) return { ok: true }; // already fully closed — no-op

  const remaining = subtractRange(windows, startTime, endTime);

  const { error: delError } = await supabase
    .from("availability_exceptions").delete().eq("org_id", orgId).eq("date", date);
  if (delError) return fail("blockTimeRange", delError);

  const rows: Array<{ org_id: string; date: string; closed: boolean; start_time: string | null; end_time: string | null }> =
    remaining.length === 0
      ? [{ org_id: orgId, date, closed: true, start_time: null, end_time: null }]
      : remaining.map((w) => ({
          org_id: orgId, date, closed: false, start_time: w.startTime, end_time: w.endTime,
        }));
  const { error: insError } = await supabase.from("availability_exceptions").insert(rows);
  if (insError) return fail("blockTimeRange", insError);

  revalidatePath("/bookings");
  revalidatePath("/availability");
  return { ok: true };
}

// Open [startTime,endTime) on one date: rewrite that date's exceptions to
// (effective windows ∪ range). If the result lands exactly back on the
// weekday rules, the exceptions are simply deleted — the day returns to
// clean rules instead of carrying an equivalent override.
export async function unblockTimeRange(input: unknown): Promise<ActionState> {
  const parsed = blockTimeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { date, startTime, endTime } = parsed.data;

  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_time, end_time").eq("org_id", orgId),
    supabase.from("availability_exceptions").select("date, closed, start_time, end_time")
      .eq("org_id", orgId).eq("date", date),
  ]);
  if (rulesRes.error) return fail("unblockTimeRange", rulesRes.error);
  if (exceptionsRes.error) return fail("unblockTimeRange", exceptionsRes.error);

  const rules = (rulesRes.data ?? []).map((r) => ({
    weekday: r.weekday, startTime: r.start_time, endTime: r.end_time,
  }));
  const dayExceptions = (exceptionsRes.data ?? []).map((e) => ({
    date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
  }));
  const merged = addRange(effectiveWindows(date, rules, dayExceptions), startTime, endTime);

  const { error: delError } = await supabase
    .from("availability_exceptions").delete().eq("org_id", orgId).eq("date", date);
  if (delError) return fail("unblockTimeRange", delError);

  // Rules-only effective windows for this date — if the merged result
  // equals them, deleting the exceptions above already restored the day.
  const ruleWindows = effectiveWindows(date, rules, []);
  if (JSON.stringify(merged) !== JSON.stringify(ruleWindows)) {
    const { error: insError } = await supabase.from("availability_exceptions").insert(
      merged.map((w) => ({
        org_id: orgId, date, closed: false, start_time: w.startTime, end_time: w.endTime,
      })),
    );
    if (insError) return fail("unblockTimeRange", insError);
  }

  revalidatePath("/bookings");
  revalidatePath("/availability");
  return { ok: true };
}

// Delete a date's exceptions, restoring the weekly rules (spec: "Reopen day").
export async function reopenDay(input: unknown): Promise<ActionState> {
  const parsed = reopenDayInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions").delete().eq("org_id", orgId).eq("date", parsed.data.date);
  if (error) return fail("reopenDay", error);
  revalidatePath("/bookings");
  revalidatePath("/availability");
  return { ok: true };
}

export async function updateSchedulingSettings(input: unknown): Promise<ActionState> {
  const parsed = schedulingSettingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: parsed.data.handle,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That handle is already taken." };
    return fail("updateSchedulingSettings", error);
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = updateRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .update({ start_time: parsed.data.startTime, end_time: parsed.data.endTime })
    .eq("id", parsed.data.id)
    // Explicit org scope (defense-in-depth, mirrors the delete actions).
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("updateAvailabilityRule", error);
  }
  if (!data) return fail("updateAvailabilityRule", "rule not visible");
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

// Overwrite semantics (spec): each target day's rows are replaced by the
// source day's rows — including "no rows" when the source day is empty.
// The source is read server-side, never client-supplied. Delete-then-insert
// is not atomic; a failure between the two leaves targets empty — visible
// and retryable, accepted for a single-editor solo product (spec).
export async function copyDayHours(input: unknown): Promise<ActionState> {
  const parsed = copyDayHoursInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data: source, error: readError } = await supabase
    .from("availability_rules")
    .select("start_time, end_time")
    .eq("org_id", orgId)
    .eq("weekday", parsed.data.sourceWeekday);
  if (readError) return fail("copyDayHours", readError);
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("org_id", orgId)
    .in("weekday", parsed.data.targetWeekdays);
  if (deleteError) return fail("copyDayHours", deleteError);
  if ((source ?? []).length > 0) {
    const rows = parsed.data.targetWeekdays.flatMap((weekday) =>
      (source ?? []).map((w) => ({
        org_id: orgId,
        weekday,
        start_time: w.start_time,
        end_time: w.end_time,
      })),
    );
    const { error: insertError } = await supabase.from("availability_rules").insert(rows);
    if (insertError) return fail("copyDayHours", insertError);
  }
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

// Replace-all-rows-for-the-date semantics (spec): one closed row, or N
// window rows. Same non-atomicity note as copyDayHours.
export async function setDateOverride(input: unknown): Promise<ActionState> {
  const parsed = dateOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("org_id", orgId)
    .eq("date", parsed.data.date);
  if (deleteError) return fail("setDateOverride", deleteError);
  const rows: Array<{ org_id: string; date: string; closed: boolean; start_time: string | null; end_time: string | null }> =
    parsed.data.closed
      ? [{ org_id: orgId, date: parsed.data.date, closed: true, start_time: null, end_time: null }]
      : parsed.data.windows.map((w) => ({
          org_id: orgId,
          date: parsed.data.date,
          closed: false,
          start_time: w.startTime,
          end_time: w.endTime,
        }));
  const { error: insertError } = await supabase.from("availability_exceptions").insert(rows);
  if (insertError) {
    if (insertError.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("setDateOverride", insertError);
  }
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

export async function deleteDateOverride(input: unknown): Promise<ActionState> {
  const parsed = deleteOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("org_id", orgId)
    .eq("date", parsed.data.date);
  if (error) return fail("deleteDateOverride", error);
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}
