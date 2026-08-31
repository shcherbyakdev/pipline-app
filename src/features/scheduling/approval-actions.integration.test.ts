/**
 * Booking approval (Task 7): the provider-side accept/decline server actions
 * and the 0063 SECURITY DEFINER RPCs they call (accept_booking /
 * decline_booking). 0028's provider seam pins authenticated status updates to
 * confirmed -> cancelled_by_provider, so the flip cannot be a plain UPDATE —
 * the RPCs are the mutation and the action re-reads the row for its emails.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// The actions run under `currentOrg()`, which reads the session through
// `@/lib/supabase/server`'s cookie-based createClient — there is no Next
// request context under vitest to carry a session cookie. Swapped for a
// directly authenticated supabase-js client (hourly-rpc.integration.test.ts's
// idiom): everything past that boundary — Zod, the RPC, the follow-up read,
// the error mapping — runs for real. revalidatePath throws outside a request
// scope, so it is a no-op mock.
const actingClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => actingClient.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Dynamic import so env is loaded (loadEnvFile above) before src/env.ts —
// booking-actions.ts's own import — parses it.
const bookingActions = await import("./booking-actions");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TZ = "UTC";
const HANDLE = `approval-${Date.now()}`;
// Relative to today, not a calendar literal: create_booking refuses a past
// starts_at and anything past the service's booking window.
const DAY = addDaysISO(dateInZone(new Date(), TZ), 30);

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

describe("accept/decline booking requests (Task 7)", () => {
  let owner: SupabaseClient;
  let stranger: SupabaseClient;
  let orgId: string;
  let serviceId: string;
  /** Stays pending for the whole file: the RPC-level negatives read it. */
  let requestId: string;
  let acceptId: string;
  let declineId: string;
  let expiredId: string;

  /** A pending request at `${DAY}T${hour}:00Z`. Each caller gets its own
      address: create_booking caps one address at 5 rows an hour. */
  async function newRequest(hour: number): Promise<string> {
    const { data, error } = await admin.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: `${DAY}T${String(hour).padStart(2, "0")}:00:00Z`,
      p_name: "Kasia",
      p_email: `req-${hour}-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
      p_staff_id: null,
    });
    if (error) throw error;
    return (data as Array<{ booking_id: string }>)[0].booking_id;
  }

  const statusOf = async (id: string): Promise<string> => {
    const { data, error } = await admin.from("bookings").select("status").eq("id", id).single();
    if (error) throw error;
    return data!.status as string;
  };

  beforeAll(async () => {
    owner = await signedInUser("approval_owner");
    stranger = await signedInUser("approval_stranger");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "ApprovalCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // The stranger is a member *somewhere* — foreign to ApprovalCo, which is
    // what user_orgs() has to stop.
    const { error: e1b } = await stranger.rpc("create_org", { p_name: "StrangerApprovalCo" });
    if (e1b) throw e1b;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ,
      p_currency: "PLN",
    });
    if (e2) throw e2;

    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({
        org_id: orgId,
        name: "Session",
        duration_min: 60,
        booking_window_days: 365,
        requires_approval: true,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    // 0041: a raw services insert does not fan out to service_staff — mirror
    // createService's link so the org's one member can take the booking.
    const { data: st, error: e4 } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e4) throw e4;
    const { error: e5 } = await owner
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: st!.id });
    if (e5) throw e5;
    const { error: e6 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId,
        staff_id: st!.id,
        weekday,
        start_time: "09:00",
        end_time: "17:00",
      })),
    );
    if (e6) throw e6;

    // Distinct hours: a pending request HOLDS its slot under the widened
    // EXCLUDE (0062), so two requests cannot share one.
    acceptId = await newRequest(9);
    declineId = await newRequest(10);
    requestId = await newRequest(11);
    expiredId = await newRequest(12);
    const { error: e7 } = await admin
      .from("bookings")
      .update({ starts_at: "2020-01-01T10:00:00Z", ends_at: "2020-01-01T11:00:00Z" })
      .eq("id", expiredId);
    if (e7) throw e7;

    // The createClient() swap: this org's owner is "the session" below.
    actingClient.current = owner;
  });

  it("accept flips to confirmed and rotates the manage token", async () => {
    const before = await admin
      .from("bookings")
      .select("status, cancel_token_hash")
      .eq("id", acceptId)
      .single();
    expect(before.data!.status).toBe("pending");
    const result = await bookingActions.acceptBookingRequest({ id: acceptId });
    expect(result.ok).toBe(true);
    const after = await admin
      .from("bookings")
      .select("status, cancel_token_hash")
      .eq("id", acceptId)
      .single();
    expect(after.data!.status).toBe("confirmed");
    expect(after.data!.cancel_token_hash).not.toBe(before.data!.cancel_token_hash);
  });

  it("decline stamps declined + note; both refuse an already-resolved row", async () => {
    const result = await bookingActions.declineBookingRequest({
      id: declineId,
      note: "fully booked",
    });
    expect(result.ok).toBe(true);
    const row = await admin
      .from("bookings")
      .select("status, decline_note")
      .eq("id", declineId)
      .single();
    expect(row.data!.status).toBe("declined");
    expect(row.data!.decline_note).toBe("fully booked");

    // The friendly line, not GENERIC: the RPC's bare 'not found' sentinel is
    // the only error the actions may relabel (a transport/PGRST202 failure
    // must fall through to fail()).
    const again = await bookingActions.acceptBookingRequest({ id: declineId });
    expect(again).toEqual({ ok: false, error: "Only a live pending request can be accepted." });
    // The already-confirmed row from the previous test is just as resolved.
    const declineConfirmed = await bookingActions.declineBookingRequest({ id: acceptId });
    expect(declineConfirmed).toEqual({
      ok: false,
      error: "Only a live pending request can be declined.",
    });
    expect(await statusOf(acceptId)).toBe("confirmed");
  });

  it("accept refuses an expired request", async () => {
    const result = await bookingActions.acceptBookingRequest({ id: expiredId });
    expect(result).toEqual({ ok: false, error: "Only a live pending request can be accepted." });
    expect(await statusOf(expiredId)).toBe("pending");
  });

  it("a member of another org cannot accept or decline the request", async () => {
    // The RPC's own raise, not "could not find the function": a missing
    // function errors too, and these two would pass on it.
    const { error: e1 } = await stranger.rpc("accept_booking", { p_booking_id: requestId });
    expect(e1?.message).toMatch(/not found/);
    const { error: e2 } = await stranger.rpc("decline_booking", {
      p_booking_id: requestId,
      p_note: null,
    });
    expect(e2?.message).toMatch(/not found/);
    expect(await statusOf(requestId)).toBe("pending");
  });

  it("decline_booking rejects a note over 500 chars", async () => {
    const { error } = await owner.rpc("decline_booking", {
      p_booking_id: requestId,
      p_note: "x".repeat(501),
    });
    expect(error?.message).toMatch(/not found/);
    expect(await statusOf(requestId)).toBe("pending");
  });
});
