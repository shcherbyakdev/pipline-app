"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import { assertCanAddStaff } from "@/lib/billing/gates";
import {
  staffInput,
  updateStaffInput,
  staffActiveInput,
  LAST_ACTIVE_STAFF_ERROR,
  STAFF_SLUG_TAKEN_ERROR,
  STAFF_SLUG_RESERVED_ISSUE,
  staffFutureBookingsError,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

// staff.slug is unique per org (0041) — a collision is the one write error with
// a field-level cause worth naming.
const UNIQUE_VIOLATION = "23505";

// Who can be booked changes what every other scheduling surface shows: the
// availability editor's staff tabs, the calendar's columns, the eligibility
// pickers on Services, the counts on Bookings — and the embed studio's
// "Book with" selector, which only exists once a second member is active.
function revalidateStaff() {
  revalidatePath("/team");
  revalidatePath("/availability");
  revalidatePath("/bookings");
  revalidatePath("/services");
  revalidatePath("/embed");
}

export async function createStaff(input: unknown): Promise<ActionState> {
  const parsed = staffInput.safeParse(input);
  if (!parsed.success) {
    // A reserved link name reads as "taken" to the owner — it is, by the page.
    const reserved = parsed.error.issues.some((i) => i.path[0] === "slug" && i.message === STAFF_SLUG_RESERVED_ISSUE);
    return { ok: false, error: reserved ? STAFF_SLUG_TAKEN_ERROR : GENERIC_WRITE_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { name, slug, email, color, serviceIds } = parsed.data;
  const supabase = await createClient();
  const refused = await assertCanAddStaff(orgId, supabase);
  if (refused) return { ok: false, error: refused };
  // The RPC does what a plain insert can't: copy the first active staff's
  // weekly hours + future overrides, and fan out service_staff in one txn.
  const { error } = await supabase.rpc("create_staff", {
    p_org_id: orgId,
    p_name: name,
    p_slug: slug,
    p_email: email ?? null,
    p_color: color,
    p_service_ids: serviceIds,
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: STAFF_SLUG_TAKEN_ERROR };
    return fail("createStaff", error);
  }
  revalidateStaff();
  return { ok: true };
}

export async function updateStaff(input: unknown): Promise<ActionState> {
  const parsed = updateStaffInput.safeParse(input);
  if (!parsed.success) {
    // A reserved link name reads as "taken" to the owner — it is, by the page.
    const reserved = parsed.error.issues.some((i) => i.path[0] === "slug" && i.message === STAFF_SLUG_RESERVED_ISSUE);
    return { ok: false, error: reserved ? STAFF_SLUG_TAKEN_ERROR : GENERIC_WRITE_ERROR };
  }
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, name, slug, email, color, serviceIds } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("staff")
    // org_id is deliberately absent: staff_guard_update rejects a change, and
    // an update must never move a row between a multi-org user's orgs.
    .update({ name, slug, email: email ?? null, color })
    .eq("id", id)
    // RLS already hides foreign rows; the explicit org scope is
    // defense-in-depth and keeps multi-org sessions unambiguous.
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: STAFF_SLUG_TAKEN_ERROR };
    return fail("updateStaff", error);
  }
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };

  // Reconcile the service checklist: service_staff has no update path (insert
  // + delete policies only), so diff it rather than replacing the set — a
  // delete-all/insert-all would briefly leave the person bookable for nothing.
  const currentRes = await supabase
    .from("service_staff")
    .select("service_id")
    .eq("org_id", orgId)
    .eq("staff_id", id);
  if (currentRes.error) return fail("updateStaff.readServices", currentRes.error);
  const current = new Set((currentRes.data ?? []).map((r) => r.service_id));
  const wanted = new Set(serviceIds);
  const toRemove = [...current].filter((sid) => !wanted.has(sid));
  const toAdd = [...wanted].filter((sid) => !current.has(sid));

  if (toRemove.length > 0) {
    const { error: delError } = await supabase
      .from("service_staff")
      .delete()
      .eq("org_id", orgId)
      .eq("staff_id", id)
      .in("service_id", toRemove);
    if (delError) return fail("updateStaff.removeServices", delError);
  }
  if (toAdd.length > 0) {
    const { error: insError } = await supabase
      .from("service_staff")
      .insert(toAdd.map((serviceId) => ({ org_id: orgId, service_id: serviceId, staff_id: id })));
    if (insError) return fail("updateStaff.addServices", insError);
  }

  revalidateStaff();
  return { ok: true };
}

export async function setStaffActive(input: unknown): Promise<ActionState> {
  const parsed = staffActiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, active } = parsed.data;
  const supabase = await createClient();
  if (active) {
    const refused = await assertCanAddStaff(orgId, supabase);
    if (refused) return { ok: false, error: refused };
  }
  const { data, error } = await supabase
    .from("staff")
    .update({ active })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    // staff_guard_update (0041) is the authority on whether someone can be
    // taken off the roster; it raises a bare sentinel that we translate here.
    if (isRpcSentinel(error, "last_active_staff")) {
      return { ok: false, error: LAST_ACTIVE_STAFF_ERROR };
    }
    if (isRpcSentinel(error, "has_future_bookings")) {
      const { data: person } = await supabase
        .from("staff")
        .select("name")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      return { ok: false, error: staffFutureBookingsError(person?.name ?? "This person") };
    }
    return fail("setStaffActive", error);
  }
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidateStaff();
  return { ok: true };
}
