/**
 * Booking approval (request-to-book), appointments half (0062):
 * services.requires_approval makes the public create RPC insert 'pending',
 * a pending row HOLDS its slot (the widened EXCLUDE + pick_staff_for_slot),
 * declining frees it, cancel_booking withdraws it, and the confirmed-only
 * manage RPCs (rotate/reschedule) leave it alone. Admin walk-ins ignore the
 * flag. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HANDLE = `approval-${Date.now()}`;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

let owner: SupabaseClient;
let orgId: string;
let serviceId: string;
let staffId: string;

beforeAll(async () => {
  owner = await signedInUser("approval_owner");
  const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "ApprovalCo" });
  if (e1) throw e1;
  orgId = (org as { id: string }).id;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: HANDLE,
    p_timezone: "UTC",
    p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: svc, error: e3 } = await owner
    .from("services")
    .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
    .select("id")
    .single();
  if (e3) throw e3;
  serviceId = svc!.id;
  // 0041: availability + bookings are keyed to a staff row; a raw services
  // insert does not fan out, so mirror createService's service_staff link.
  const { data: st, error: e3b } = await admin
    .from("staff")
    .select("id")
    .eq("org_id", orgId)
    .single();
  if (e3b) throw e3b;
  staffId = st!.id;
  const { error: e3c } = await owner
    .from("service_staff")
    .insert({ org_id: orgId, service_id: serviceId, staff_id: staffId });
  if (e3c) throw e3c;
  const { error: e4 } = await owner.from("availability_rules").insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      org_id: orgId,
      staff_id: staffId,
      weekday,
      start_time: "09:00",
      end_time: "17:00",
    })),
  );
  if (e4) throw e4;
});

describe("booking approval — appointments", () => {
  beforeAll(async () => {
    await owner.from("services").update({ requires_approval: true }).eq("id", serviceId);
  });

  const create = (startsAt: string, email = "req@example.com") => {
    const t = generateAccessToken();
    return admin
      .rpc("create_booking", {
        p_handle: HANDLE,
        p_service_id: serviceId,
        p_starts_at: startsAt,
        p_name: "Requester",
        p_email: email,
        p_note: null,
        p_token_hash: t.tokenHash,
        p_staff_id: null,
        p_candidates: null,
      })
      .then((r) => ({ ...r, token: t.token }));
  };
  const statusOf = async (id: string) =>
    (await admin.from("bookings").select("status").eq("id", id).single()).data!.status;

  it("flag on -> public create inserts status=pending", async () => {
    const { data, error } = await create("2027-07-01T10:00:00Z");
    expect(error).toBeNull();
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    expect(await statusOf(id)).toBe("pending");
  });

  it("a pending request blocks an overlapping public create", async () => {
    const { error } = await create("2027-07-01T10:00:00Z", "second@example.com");
    expect(error).not.toBeNull(); // 'taken' — the EXCLUDE covers pending
  });

  // The accept/decline status flips go through the service-role client, not
  // `owner`: RLS's authenticated seam (0028) is `update (status)` only, and
  // confirmed -> cancelled_by_provider only. The provider-facing accept /
  // decline write path is a later task's definer RPC; 0062 only has to make
  // the resulting states legal and correctly held/freed.
  it("accept (pending -> confirmed) succeeds; decline frees the slot", async () => {
    const { data } = await create("2027-07-02T10:00:00Z");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const { error: acceptErr } = await admin
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", id);
    expect(acceptErr).toBeNull();

    const { data: d2 } = await create("2027-07-03T10:00:00Z", "b@example.com");
    const id2 = (d2 as Array<{ booking_id: string }>)[0].booking_id;
    const { error: declineErr } = await admin
      .from("bookings")
      .update({ status: "declined", decline_note: "fully booked" })
      .eq("id", id2);
    expect(declineErr).toBeNull();
    const { error: rebookErr } = await create("2027-07-03T10:00:00Z", "c@example.com");
    expect(rebookErr).toBeNull(); // declined no longer holds the slot
  });

  it("cancel_booking withdraws a pending request", async () => {
    const { data, token } = await create("2027-07-04T10:00:00Z", "wd@example.com");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const { error } = await admin.rpc("cancel_booking", { p_token: token });
    expect(error).toBeNull();
    expect(await statusOf(id)).toBe("cancelled_by_client");
  });

  it("rotate_booking_token and reschedule_booking refuse a pending row", async () => {
    const { data, token } = await create("2027-07-05T10:00:00Z", "rr@example.com");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const fresh = generateAccessToken();
    const { error: rotErr } = await owner.rpc("rotate_booking_token", {
      p_booking_id: id,
      p_token_hash: fresh.tokenHash,
    });
    expect(rotErr).not.toBeNull(); // guard stays 'confirmed' — accept flips first
    // reschedule_booking's `where status = 'confirmed'` select finds nothing
    // and returns early: no error, zero rows, and the request is untouched.
    const { data: resData, error: resErr } = await admin.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-07-05T12:00:00Z",
      p_new_token_hash: fresh.tokenHash,
    });
    expect(resErr).toBeNull();
    expect((resData as unknown[] | null) ?? []).toHaveLength(0);
    expect(await statusOf(id)).toBe("pending");
  });

  it("create_booking_admin ignores the flag (walk-ins confirm instantly)", async () => {
    const t = generateAccessToken();
    const { data: id, error } = await owner.rpc("create_booking_admin", {
      p_service_id: serviceId,
      p_starts_at: "2027-07-06T10:00:00Z",
      p_name: "Walk-in",
      p_email: null,
      p_note: null,
      p_token_hash: t.tokenHash,
      p_duration_min: null,
      p_staff_id: staffId,
    });
    expect(error).toBeNull();
    expect(await statusOf(id as string)).toBe("confirmed");
  });
});
