/**
 * S1-deferred e2e of the action layer: getSlots → createBooking (incl. the
 * off-grid slotTaken branch) → getManageSlots → rescheduleBooking →
 * cancelBooking. Emails are best-effort inside the actions; transport
 * failures must not fail the flow. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic imports so env is loaded before src/env.ts parses it.
const publicActions = await import("./public-actions");
const manageActions = await import("./manage-actions");
const { addDaysISO } = await import("./slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HANDLE = `flow-${Date.now()}`;
const CLIENT_EMAIL = `flow-${Date.now()}@example.com`;

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

let serviceId: string;
let orgId: string;
const fromDate = addDaysISO(new Date().toISOString().slice(0, 10), 7);

describe("booking flow e2e (action layer)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("flow_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "FlowCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "UTC",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Flow Session", duration_min: 60, booking_window_days: 60 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    // 0041: availability belongs to a staff row (create_org seeds one), and a
    // raw services insert does not fan out — mirror createService's link so
    // create_booking's "anyone available" pick has a candidate.
    const { data: st, error: e3b } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e3b) throw e3b;
    const staffId = st!.id;
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

  it("books, reschedules, and cancels end-to-end", async () => {
    const slotsRes = await publicActions.getSlots({
      handle: HANDLE,
      serviceId,
      fromDate,
      days: 7,
    });
    expect(slotsRes.ok).toBe(true);
    if (!slotsRes.ok) return;
    expect(slotsRes.slots.length).toBeGreaterThan(2);
    const [first, , third] = slotsRes.slots;

    // Off-grid instant → slotTaken branch, no booking created.
    const offGrid = await publicActions.createBooking({
      handle: HANDLE,
      serviceId,
      startsAt: new Date(new Date(first).getTime() + 7 * 60_000).toISOString(),
      name: "Flow Client",
      email: CLIENT_EMAIL,
    });
    expect(offGrid.ok).toBe(false);
    if (!offGrid.ok) expect(offGrid.slotTaken).toBe(true);

    const created = await publicActions.createBooking({
      handle: HANDLE,
      serviceId,
      startsAt: first,
      name: "Flow Client",
      email: CLIENT_EMAIL,
      note: "e2e",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The manage picker deliberately still offers the booking's OWN slot
    // (decision #11: excludeBookingId drops the booking's own interval so
    // self-overlap reschedules are legal — the RPC frees the old row first).
    const manageSlots = await manageActions.getManageSlots({
      token: created.token,
      fromDate,
      days: 7,
    });
    expect(manageSlots.ok).toBe(true);
    if (!manageSlots.ok) return;
    expect(manageSlots.slots).toContain(first);
    expect(manageSlots.slots).toContain(third);

    const moved = await manageActions.rescheduleBooking({
      token: created.token,
      startsAt: third,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.token).not.toBe(created.token);

    // Old booking is history; the flow continues on the new token.
    const { data: oldRows } = await admin
      .from("bookings")
      .select("status")
      .eq("org_id", orgId)
      .eq("client_email", CLIENT_EMAIL)
      .eq("starts_at", first);
    expect(oldRows![0].status).toBe("rescheduled");

    const cancelled = await manageActions.cancelBooking({ token: moved.token });
    expect(cancelled.ok).toBe(true);

    const { data: newRows } = await admin
      .from("bookings")
      .select("status")
      .eq("org_id", orgId)
      .eq("client_email", CLIENT_EMAIL)
      .eq("starts_at", third);
    expect(newRows![0].status).toBe("cancelled_by_client");

    // Cancelling again via the same token: friendly refusal, not a 500.
    const again = await manageActions.cancelBooking({ token: moved.token });
    expect(again.ok).toBe(false);
  });
});
