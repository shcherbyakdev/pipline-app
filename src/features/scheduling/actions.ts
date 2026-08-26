"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertCanAddService } from "@/lib/billing/gates";
import { seedDefaultHours } from "./default-hours";
import {
  availabilityOwnerInput,
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
import { HANDLE_RE, isReservedHandle } from "./handle";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

// H2 (hourly mode): an availability row's owner is a staff member XOR an
// hours rental offering (0056's XOR CHECK) — every write and filter below
// goes through these two helpers instead of a bare `staff_id` reference.
type Owner = { staffId?: string; rentalOfferingId?: string };
type OwnerCols = { staff_id: string | null; rental_offering_id: string | null };
function ownerCols(o: Owner): OwnerCols {
  return { staff_id: o.staffId ?? null, rental_offering_id: o.rentalOfferingId ?? null };
}
// `T` is inferred from the caller's query builder and returned as-is — the
// `.eq` call is checked once against a minimal cast, not re-unified against
// Supabase's full (select-string-derived) builder type at every call site,
// which is what TS2589 ("type instantiation is excessively deep") comes
// from if `T` is constrained directly by an `eq` method shape instead.
function ownerEq<T>(q: T, o: Owner): T {
  const filterable = q as unknown as { eq: (column: string, value: string) => T };
  return o.staffId
    ? filterable.eq("staff_id", o.staffId)
    : filterable.eq("rental_offering_id", o.rentalOfferingId!);
}
// Hours for both owners are edited on /availability (admin IA U3); a
// space's detail page only summarises them, but that summary must not go
// stale either.
function revalidateOwner(o: Owner) {
  revalidatePath("/availability");
  if (o.rentalOfferingId) revalidatePath(`/rentals/${o.rentalOfferingId}`);
}

// Defence-in-depth for the offering path, mirroring the staff org scope
// beside it: RLS plus the 0056 `check_offering_owner_org` trigger already
// reject another org's offering id, but this turns that into the same
// friendly refusal a bad staff id gets instead of a raw DB error. No-op
// (returns true) for the staff path.
async function ownerBelongsToOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  o: Owner,
): Promise<boolean> {
  if (!o.rentalOfferingId) return true;
  const { data } = await supabase
    .from("rental_offerings")
    .select("id")
    .eq("id", o.rentalOfferingId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data !== null;
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

// Team (multi-staff): who a service is offered by shows up wherever staff and
// services meet — the Team page's per-person service count, the eligibility
// checklists, and the booking surfaces that only offer a person for what they
// do. Mirrors `revalidateStaff()` in staff-actions.ts, from the other side.
function revalidateServices() {
  revalidatePath("/services");
  revalidatePath("/team");
  revalidatePath("/bookings");
}

export async function createService(input: unknown): Promise<ActionState> {
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const refused = await assertCanAddService(orgId, supabase);
  if (refused) return { ok: false, error: refused };

  // Solo path: the dialog only asks who can be booked once a second person is
  // active, so an omitted `staffIds` means "everyone" — read the roster here
  // rather than trusting a client-sent list, and read it *before* inserting so
  // a failure leaves no service that nobody can be booked for.
  let staffIds = parsed.data.staffIds;
  if (!staffIds) {
    const rosterRes = await supabase
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .eq("active", true);
    if (rosterRes.error) return fail("createService.readStaff", rosterRes.error);
    staffIds = (rosterRes.data ?? []).map((s) => s.id);
  }

  const { data, error } = await supabase
    .from("services")
    .insert({ org_id: orgId, ...toServiceRow(parsed.data) })
    .select("id")
    .single();
  if (error) return fail("createService", error);

  if (staffIds.length > 0) {
    const { error: linkError } = await supabase
      .from("service_staff")
      .insert(
        staffIds.map((staffId) => ({ org_id: orgId, service_id: data.id, staff_id: staffId })),
      );
    // The service exists either way; the assignment is what failed, and the
    // Edit dialog is the retry — so say so rather than claiming success.
    if (linkError) return fail("createService.assignStaff", linkError);
  }
  revalidateServices();
  return { ok: true };
}

export async function updateService(input: unknown): Promise<ActionState> {
  const parsed = updateServiceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, staffIds, ...rest } = parsed.data;
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

  // Reconcile the team checklist only when the dialog rendered it: a solo
  // org's edit sends no `staffIds` and must leave the existing links alone.
  // Diffed rather than replaced, like `updateStaff` from the staff side —
  // service_staff has insert + delete policies and no update path.
  if (staffIds) {
    const currentRes = await supabase
      .from("service_staff")
      .select("staff_id")
      .eq("org_id", orgId)
      .eq("service_id", id);
    if (currentRes.error) return fail("updateService.readStaff", currentRes.error);
    const current = new Set((currentRes.data ?? []).map((r) => r.staff_id));
    const wanted = new Set(staffIds);
    const toRemove = [...current].filter((sid) => !wanted.has(sid));
    const toAdd = [...wanted].filter((sid) => !current.has(sid));

    if (toRemove.length > 0) {
      const { error: delError } = await supabase
        .from("service_staff")
        .delete()
        .eq("org_id", orgId)
        .eq("service_id", id)
        .in("staff_id", toRemove);
      if (delError) return fail("updateService.removeStaff", delError);
    }
    if (toAdd.length > 0) {
      const { error: insError } = await supabase
        .from("service_staff")
        .insert(toAdd.map((staffId) => ({ org_id: orgId, service_id: id, staff_id: staffId })));
      if (insError) return fail("updateService.addStaff", insError);
    }
  } else {
    // Solo path, self-heal. A service with ZERO links is bookable by nobody and
    // the public pages now hide it (filterBookableServices) — but a solo org's
    // dialog never renders the checklist, so nothing above would ever repair
    // one left behind by a failed create-time link insert. Re-link the active
    // roster, which is exactly what createService would have written. A service
    // that already has links is untouched: solo behaviour is otherwise
    // unchanged, this costs one count query.
    const linkedRes = await supabase
      .from("service_staff")
      .select("staff_id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("service_id", id);
    if (linkedRes.error) return fail("updateService.countStaff", linkedRes.error);
    if ((linkedRes.count ?? 0) === 0) {
      const rosterRes = await supabase
        .from("staff")
        .select("id")
        .eq("org_id", orgId)
        .eq("active", true);
      if (rosterRes.error) return fail("updateService.readStaff", rosterRes.error);
      const roster = (rosterRes.data ?? []).map((s) => s.id);
      if (roster.length > 0) {
        const { error: healError } = await supabase
          .from("service_staff")
          .insert(roster.map((staffId) => ({ org_id: orgId, service_id: id, staff_id: staffId })));
        if (healError) return fail("updateService.relinkStaff", healError);
      }
    }
  }

  revalidateServices();
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
  revalidateServices();
  return { ok: true };
}

// EXCLUDE-guard violations (0035) — the DB is the authority on overlaps;
// map to the same message the client shows.
const OVERLAP_DB_CODE = "23P01";

const HANDLE_FORMAT_ERROR = "Use 3–50 lowercase letters, digits or hyphens.";

// Shape of an availability_exceptions row as the actions below write it.
type ExceptionInsert = {
  org_id: string;
  staff_id: string | null;
  rental_offering_id: string | null;
  date: string;
  closed: boolean;
  start_time: string | null;
  end_time: string | null;
};

// Replace one date's exception rows for one owner with `next`, over plain
// REST calls (no transaction), such that NO failure can leave the day
// emptier than it was: a day with no exception rows falls back to the
// weekly rules, i.e. a half-done rewrite would silently REOPEN a blocked or
// closed day for booking. The invariant: every intermediate state is the
// old state, or a state where a closed row is present (closed wins in
// effectiveWindows/slots), or old ∪ new.
//
// Plain "insert new, then delete old" is not available for open windows:
// availability_exceptions_no_overlap (0035/0041, `where (not closed)`) rejects
// an open row that overlaps another open row on the same date, and the new
// windows nearly always overlap the ones they replace. A closed row is
// outside that constraint, so it doubles as a bridge: park the day closed,
// swap the open rows underneath, lift the bridge. Two calls when no open
// rows exist yet (or when the result is closed), four otherwise — and the
// worst outcome of a mid-way failure is a day stuck CLOSED, which the
// calendar shows and "Reopen day" fixes; never a day stuck open.
//
// Returns the failing step's error (23P01 included, so callers keep their
// overlap mapping) or null.
async function replaceDayExceptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: { orgId: string; owner: Owner; date: string },
  prior: Array<{ id: string; closed: boolean }>,
  next: ExceptionInsert[],
): Promise<{ code?: string; message: string } | null> {
  const table = () => supabase.from("availability_exceptions");
  const deleteByIds = async (ids: string[]) => {
    if (ids.length === 0) return null;
    const { error } = await ownerEq(table().delete().eq("org_id", scope.orgId), scope.owner)
      .eq("date", scope.date)
      .in("id", ids);
    return error;
  };
  const priorIds = prior.map((r) => r.id);
  const priorHasOpen = prior.some((r) => !r.closed);
  const nextIsClosed = next.length > 0 && next.every((r) => r.closed);

  // "Back to the weekly rules": one statement, all-or-nothing on its own.
  if (next.length === 0) return deleteByIds(priorIds);

  if (!priorHasOpen || nextIsClosed) {
    // Nothing the new rows could collide with (closed rows are outside the
    // EXCLUDE; a closed result never collides). Insert first: a failure
    // here leaves the old rows untouched; a failed delete leaves old ∪ new,
    // which is at least as restrictive as either.
    const { error } = await table().insert(next);
    if (error) return error;
    return deleteByIds(priorIds);
  }

  // Bridge: the day is closed from here until the last step succeeds.
  const { data: bridge, error: bridgeError } = await table()
    .insert({
      org_id: scope.orgId,
      ...ownerCols(scope.owner),
      date: scope.date,
      closed: true,
      start_time: null,
      end_time: null,
    })
    .select("id")
    .single();
  if (bridgeError) return bridgeError;
  const oldError = await deleteByIds(priorIds);
  if (oldError) return oldError;
  const { error: nextError } = await table().insert(next);
  if (nextError) return nextError;
  return deleteByIds([bridge.id]);
}

// H2 (hourly mode): availability rows are per owner — a staff member XOR an
// hours rental offering (0040/0041/0056 — the XOR CHECK, EXCLUDE overlap
// guards keyed by owner). Each availability action below takes the owner id
// from its own input and both writes it (`ownerCols`) and filters on it
// (`ownerEq`). RLS plus the `check_staff_owner_org`/`check_offering_owner_org`
// triggers already reject another org's owner id, so the explicit org-scoped
// filters are defence-in-depth in the same spirit as the org scope beside
// them — `ownerBelongsToOrg` adds the friendly-error half of that for the
// offering path (the staff path already has it via `staffId` foreign keys
// resolved through RLS-visible staff rows elsewhere).
export async function addAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = availabilityRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { error } = await supabase.from("availability_rules").insert({
    org_id: orgId,
    ...ownerCols(parsed.data),
    weekday: parsed.data.weekday,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
  });
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("addAvailabilityRule", error);
  }
  revalidateOwner(parsed.data);
  revalidatePath("/bookings");
  return { ok: true };
}

// The one-click way out of a week with no hours at all: the editor shows
// the button only when every day is "Unavailable" (weekly-hours.tsx), and
// this runs the same insert the creation paths do (default-hours.ts). It is
// the recovery path for owners who predate the seeding, whose seed failed,
// or who cleared their week — a race that lands hours between render and
// click hits 0035's EXCLUDE guard and gets the shared overlap copy.
export async function applyDefaultHours(input: unknown): Promise<ActionState> {
  const parsed = availabilityOwnerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const error = await seedDefaultHours(supabase, orgId, parsed.data);
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("applyDefaultHours", error);
  }
  revalidateOwner(parsed.data);
  revalidatePath("/bookings");
  return { ok: true };
}

export async function deleteAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = ruleIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Row-id-keyed (no owner on the input — the row already knows whose it
  // is); reading it back off the delete tells `revalidateOwner` which page
  // to refresh without the caller having to say so.
  const { data, error } = await supabase
    .from("availability_rules")
    .delete()
    .eq("id", parsed.data.id)
    // Explicit org scope (defense-in-depth, mirrors deleteService) —
    // Task 11 hardening precedent applied to the delete actions here.
    .eq("org_id", orgId)
    .select("staff_id, rental_offering_id")
    .maybeSingle();
  if (error) return fail("deleteAvailabilityRule", error);
  // No row deleted (bad id or wrong org) — nothing to refresh either target
  // for; fall back to the pre-H2 default.
  if (!data) revalidatePath("/availability");
  else revalidateOwner(data.staff_id ? { staffId: data.staff_id } : { rentalOfferingId: data.rental_offering_id! });
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
  const { staffId, date, startTime, endTime } = parsed.data;

  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_time, end_time")
      .eq("org_id", orgId).eq("staff_id", staffId),
    supabase.from("availability_exceptions").select("id, date, closed, start_time, end_time")
      .eq("org_id", orgId).eq("staff_id", staffId).eq("date", date),
  ]);
  if (rulesRes.error) return fail("blockTimeRange", rulesRes.error);
  if (exceptionsRes.error) return fail("blockTimeRange", exceptionsRes.error);

  const prior = exceptionsRes.data ?? [];
  const windows = effectiveWindows(
    date,
    (rulesRes.data ?? []).map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })),
    prior.map((e) => ({ date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time })),
  );
  if (windows.length === 0) return { ok: true }; // already fully closed — no-op

  const remaining = subtractRange(windows, startTime, endTime);
  const rows: ExceptionInsert[] =
    remaining.length === 0
      ? [{ org_id: orgId, staff_id: staffId, rental_offering_id: null, date, closed: true, start_time: null, end_time: null }]
      : remaining.map((w) => ({
          org_id: orgId, staff_id: staffId, rental_offering_id: null, date, closed: false,
          start_time: w.startTime, end_time: w.endTime,
        }));
  const error = await replaceDayExceptions(supabase, { orgId, owner: { staffId }, date }, prior, rows);
  if (error) return fail("blockTimeRange", error);

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
  const { staffId, date, startTime, endTime } = parsed.data;

  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_time, end_time")
      .eq("org_id", orgId).eq("staff_id", staffId),
    supabase.from("availability_exceptions").select("id, date, closed, start_time, end_time")
      .eq("org_id", orgId).eq("staff_id", staffId).eq("date", date),
  ]);
  if (rulesRes.error) return fail("unblockTimeRange", rulesRes.error);
  if (exceptionsRes.error) return fail("unblockTimeRange", exceptionsRes.error);

  const rules = (rulesRes.data ?? []).map((r) => ({
    weekday: r.weekday, startTime: r.start_time, endTime: r.end_time,
  }));
  const prior = exceptionsRes.data ?? [];
  const dayExceptions = prior.map((e) => ({
    date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
  }));
  const merged = addRange(effectiveWindows(date, rules, dayExceptions), startTime, endTime);

  // Rules-only effective windows for this date — if the merged result
  // equals them, the day returns to clean rules (no rows) instead of
  // carrying an equivalent override. That is the one rewrite that MAY leave
  // the day without rows, because "no rows" is exactly the intended result.
  const ruleWindows = effectiveWindows(date, rules, []);
  const rows: ExceptionInsert[] =
    JSON.stringify(merged) === JSON.stringify(ruleWindows)
      ? []
      : merged.map((w) => ({
          org_id: orgId, staff_id: staffId, rental_offering_id: null, date, closed: false,
          start_time: w.startTime, end_time: w.endTime,
        }));
  const error = await replaceDayExceptions(supabase, { orgId, owner: { staffId }, date }, prior, rows);
  if (error) return fail("unblockTimeRange", error);

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
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { error } = await ownerEq(
    supabase.from("availability_exceptions").delete().eq("org_id", orgId),
    parsed.data,
  ).eq("date", parsed.data.date);
  if (error) return fail("reopenDay", error);
  revalidatePath("/bookings");
  revalidateOwner(parsed.data);
  return { ok: true };
}

export async function updateSchedulingSettings(input: unknown): Promise<ActionState> {
  const parsed = schedulingSettingsInput.safeParse(input);
  if (!parsed.success) {
    const h = typeof (input as { handle?: unknown })?.handle === "string" ? ((input as { handle: string }).handle).trim() : "";
    if (isReservedHandle(h)) return { ok: false, error: "That address is reserved — pick another." };
    // The one refusal a person can actually act on: the form normalises as
    // you type, so this is a too-short handle or a trailing dash.
    if (h !== "" && !HANDLE_RE.test(h)) return { ok: false, error: HANDLE_FORMAT_ERROR };
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: parsed.data.handle,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That handle is already taken." };
    return fail("updateSchedulingSettings", error);
  }
  revalidatePath("/booking-page");
  revalidatePath("/embed");
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
    .select("id, staff_id, rental_offering_id")
    .maybeSingle();
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("updateAvailabilityRule", error);
  }
  if (!data) return fail("updateAvailabilityRule", "rule not visible");
  revalidateOwner(data.staff_id ? { staffId: data.staff_id } : { rentalOfferingId: data.rental_offering_id! });
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
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { data: source, error: readError } = await ownerEq(
    supabase.from("availability_rules").select("start_time, end_time").eq("org_id", orgId),
    parsed.data,
  ).eq("weekday", parsed.data.sourceWeekday);
  if (readError) return fail("copyDayHours", readError);
  const { error: deleteError } = await ownerEq(
    supabase.from("availability_rules").delete().eq("org_id", orgId),
    parsed.data,
  ).in("weekday", parsed.data.targetWeekdays);
  if (deleteError) return fail("copyDayHours", deleteError);
  if ((source ?? []).length > 0) {
    const rows = parsed.data.targetWeekdays.flatMap((weekday) =>
      (source ?? []).map((w) => ({
        org_id: orgId,
        ...ownerCols(parsed.data),
        weekday,
        start_time: w.start_time,
        end_time: w.end_time,
      })),
    );
    const { error: insertError } = await supabase.from("availability_rules").insert(rows);
    if (insertError) return fail("copyDayHours", insertError);
  }
  revalidateOwner(parsed.data);
  revalidatePath("/bookings");
  return { ok: true };
}

// Replace-all-rows-for-the-date semantics (spec): one closed row, or N
// window rows. Ordered by replaceDayExceptions so a failure never leaves
// the day emptier (more open) than it was.
export async function setDateOverride(input: unknown): Promise<ActionState> {
  const parsed = dateOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { data: prior, error: readError } = await ownerEq(
    supabase.from("availability_exceptions").select("id, closed").eq("org_id", orgId),
    parsed.data,
  ).eq("date", parsed.data.date);
  if (readError) return fail("setDateOverride", readError);
  const rows: ExceptionInsert[] = parsed.data.closed
    ? [
        {
          org_id: orgId,
          ...ownerCols(parsed.data),
          date: parsed.data.date,
          closed: true,
          start_time: null,
          end_time: null,
        },
      ]
    : parsed.data.windows.map((w) => ({
        org_id: orgId,
        ...ownerCols(parsed.data),
        date: parsed.data.date,
        closed: false,
        start_time: w.startTime,
        end_time: w.endTime,
      }));
  const error = await replaceDayExceptions(
    supabase,
    { orgId, owner: parsed.data, date: parsed.data.date },
    prior ?? [],
    rows,
  );
  if (error) {
    // Only the new rows' own overlaps can trip the guard now — the bridge
    // pattern never inserts an open row next to one it is replacing.
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("setDateOverride", error);
  }
  revalidateOwner(parsed.data);
  revalidatePath("/bookings");
  return { ok: true };
}

export async function deleteDateOverride(input: unknown): Promise<ActionState> {
  const parsed = deleteOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  if (!(await ownerBelongsToOrg(supabase, orgId, parsed.data))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const { error } = await ownerEq(
    supabase.from("availability_exceptions").delete().eq("org_id", orgId),
    parsed.data,
  ).eq("date", parsed.data.date);
  if (error) return fail("deleteDateOverride", error);
  revalidateOwner(parsed.data);
  revalidatePath("/bookings");
  return { ok: true };
}
