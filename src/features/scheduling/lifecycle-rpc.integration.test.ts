/**
 * S2 lifecycle RPCs: cancel_booking, reschedule_booking,
 * reschedule_booking_admin, the hardened create_booking (throttle +
 * availability containment), the recreated resolver, and the
 * column-scoped admin status seam. Requires the local Supabase stack.
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
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const HANDLE = `lc-rpc-${Date.now()}`;

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

async function book(startsAt: string, email: string) {
  const { token, tokenHash } = generateAccessToken();
  const { data, error } = await admin.rpc("create_booking", {
    p_handle: HANDLE,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_name: "Lifecycle Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
    p_staff_id: null,
  });
  // 0041: create_booking returns table(booking_id, staff_id, staff_name);
  // null p_staff_id = "anyone available" (this org is solo).
  const row = (data as Array<{ booking_id: string }> | null)?.[0];
  return { token, bookingId: row?.booking_id ?? null, error };
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let serviceId: string;
let staffId: string;

describe("S2 lifecycle RPCs", () => {
  beforeAll(async () => {
    owner = await signedInUser("lc_owner");
    stranger = await signedInUser("lc_stranger");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "LifecycleCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // stranger gets their own org so their staff client is a *member
    // somewhere* but foreign to LifecycleCo.
    const { error: e1b } = await stranger.rpc("create_org", { p_name: "StrangerCo" });
    if (e1b) throw e1b;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "UTC",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    const { data: st, error: e3b } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e3b) throw e3b;
    staffId = st!.id;
    // A raw services insert does not fan out to staff (that is createService's
    // job); create_booking needs the service_staff link to assign anyone.
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

  it("hardening: off-hours direct RPC create is rejected, in-hours accepted", async () => {
    const night = await book("2027-04-05T03:00:00Z", "night@example.com");
    expect(night.error).not.toBeNull();
    expect(night.error!.message).toContain("not found");
    const day = await book("2027-04-05T10:00:00Z", "day@example.com");
    expect(day.error).toBeNull();
  });

  it("hardening: closed exception blocks the day; open exception replaces rules", async () => {
    const { error: exErr } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, staff_id: staffId, date: "2027-04-06", closed: true });
    expect(exErr).toBeNull();
    const closed = await book("2027-04-06T10:00:00Z", "closed@example.com");
    expect(closed.error).not.toBeNull();

    const { error: ex2Err } = await owner
      .from("availability_exceptions")
      .insert({
        org_id: orgId,
        staff_id: staffId,
        date: "2027-04-07",
        closed: false,
        start_time: "13:00",
        end_time: "15:00",
      });
    expect(ex2Err).toBeNull();
    const outside = await book("2027-04-07T10:00:00Z", "outside@example.com");
    expect(outside.error).not.toBeNull();
    const inside = await book("2027-04-07T13:00:00Z", "inside@example.com");
    expect(inside.error).toBeNull();
  });

  it("resolver v2 exposes org_id and service_id", async () => {
    const { token, error } = await book("2027-04-05T11:00:00Z", "resolve@example.com");
    expect(error).toBeNull();
    const { data } = await anon.rpc("resolve_booking_token", { p_token: token });
    const row = (data as Array<{ org_id: string; service_id: string }>)[0];
    expect(row.org_id).toBe(orgId);
    expect(row.service_id).toBe(serviceId);
  });

  it("cancel_booking flips a confirmed future booking and frees its slot", async () => {
    const { token, error } = await book("2027-04-05T12:00:00Z", "cancelme@example.com");
    expect(error).toBeNull();
    const { data, error: cErr } = await admin.rpc("cancel_booking", { p_token: token });
    expect(cErr).toBeNull();
    const row = (data as Array<{ booking_id: string; org_timezone: string; client_email: string }>)[0];
    expect(row.client_email).toBe("cancelme@example.com");
    expect(row.org_timezone).toBe("UTC");

    const { data: b } = await admin
      .from("bookings")
      .select("status")
      .eq("id", row.booking_id)
      .single();
    expect(b!.status).toBe("cancelled_by_client");

    // Second cancel with the same token: uniform empty no-op.
    const { data: again } = await admin.rpc("cancel_booking", { p_token: token });
    expect(again).toEqual([]);

    // The slot is free again.
    const rebook = await book("2027-04-05T12:00:00Z", "rebook@example.com");
    expect(rebook.error).toBeNull();
  });

  it("cancel_booking refuses a past booking", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { error } = await admin.from("bookings").insert({
      org_id: orgId,
      service_id: serviceId,
      staff_id: staffId,
      client_name: "Past",
      client_email: "past@example.com",
      starts_at: "2026-01-05T10:00:00Z",
      ends_at: "2026-01-05T11:00:00Z",
      cancel_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const { data } = await admin.rpc("cancel_booking", { p_token: token });
    expect(data).toEqual([]);
  });

  it("reschedule_booking: new linked row, old freed + marked, both tokens resolve", async () => {
    const { token, bookingId, error } = await book("2027-04-05T13:00:00Z", "move@example.com");
    expect(error).toBeNull();
    const fresh = generateAccessToken();
    const { data, error: rErr } = await admin.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-04-05T15:00:00Z",
      p_new_token_hash: fresh.tokenHash,
    });
    expect(rErr).toBeNull();
    const row = (data as Array<{ new_booking_id: string; old_starts_at: string; new_starts_at: string }>)[0];

    const { data: oldRow } = await admin
      .from("bookings").select("status").eq("id", bookingId!).single();
    expect(oldRow!.status).toBe("rescheduled");
    const { data: newRow } = await admin
      .from("bookings")
      .select("status, rescheduled_from_id, starts_at")
      .eq("id", row.new_booking_id)
      .single();
    expect(newRow!.status).toBe("confirmed");
    expect(newRow!.rescheduled_from_id).toBe(bookingId);

    // Old token resolves to history; new token resolves to the new booking.
    const { data: oldResolved } = await anon.rpc("resolve_booking_token", { p_token: token });
    expect((oldResolved as Array<{ booking_status: string }>)[0].booking_status).toBe("rescheduled");
    const { data: newResolved } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
    expect((newResolved as Array<{ booking_id: string }>)[0].booking_id).toBe(row.new_booking_id);

    // The vacated 13:00 slot is bookable again.
    const rebook = await book("2027-04-05T13:00:00Z", "vacated@example.com");
    expect(rebook.error).toBeNull();
  });

  it("reschedule conflict rolls the whole transaction back (old stays confirmed)", async () => {
    const a = await book("2027-04-08T10:00:00Z", "atomic-a@example.com");
    const b = await book("2027-04-08T12:00:00Z", "atomic-b@example.com");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const { error } = await admin.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-08T12:00:00Z",
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23P01");
    const { data: aRow } = await admin
      .from("bookings").select("status").eq("id", a.bookingId!).single();
    expect(aRow!.status).toBe("confirmed");
  });

  it("reschedule allows overlapping the booking's own old slot", async () => {
    const a = await book("2027-04-09T10:00:00Z", "shift@example.com");
    expect(a.error).toBeNull();
    const { data, error } = await admin.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-09T10:30:00Z", // overlaps its own 10:00–11:00
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(1);
  });

  it("reschedule_booking rejects off-availability and malformed hash", async () => {
    const a = await book("2027-04-12T10:00:00Z", "reject@example.com");
    expect(a.error).toBeNull();
    const { error: offHours } = await admin.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-12T20:00:00Z",
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(offHours).not.toBeNull();
    const { error: badHash } = await admin.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-12T14:00:00Z",
      p_new_token_hash: "not-hex",
    });
    expect(badHash).not.toBeNull();
  });

  it("reschedule_booking_admin: member ok, foreign member uniform miss", async () => {
    const a = await book("2027-04-13T10:00:00Z", "admin-move@example.com");
    expect(a.error).toBeNull();
    const { error: foreign } = await stranger.rpc("reschedule_booking_admin", {
      p_booking_id: a.bookingId,
      p_starts_at: "2027-04-13T14:00:00Z",
      p_token_hash: generateAccessToken().tokenHash,
      p_staff_id: null,
    });
    expect(foreign).not.toBeNull();
    expect(foreign!.message).toContain("not found");

    const { data: moved, error } = await owner.rpc("reschedule_booking_admin", {
      p_booking_id: a.bookingId,
      p_starts_at: "2027-04-13T14:00:00Z",
      p_token_hash: generateAccessToken().tokenHash,
      p_staff_id: null,
    });
    expect(error).toBeNull();
    // 0041: null p_staff_id keeps the booking's own staff.
    const movedRow = (moved as Array<{ new_booking_id: string; staff_changed: boolean }>)[0];
    expect(movedRow.staff_changed).toBe(false);
    const { data: newRow } = await admin
      .from("bookings")
      .select("rescheduled_from_id, status")
      .eq("id", movedRow.new_booking_id)
      .single();
    expect(newRow!.rescheduled_from_id).toBe(a.bookingId);
    expect(newRow!.status).toBe("confirmed");
  });

  it("admin status seam: confirmed→cancelled_by_provider only, own org only", async () => {
    const a = await book("2027-04-14T10:00:00Z", "seam@example.com");
    expect(a.error).toBeNull();

    // Foreign member: policy filters the row out — zero rows updated.
    const { data: foreignRows } = await stranger
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(foreignRows).toEqual([]);

    // A non-status column is not granted at all.
    const { error: colErr } = await owner
      .from("bookings")
      .update({ client_name: "hax" })
      .eq("id", a.bookingId!);
    expect(colErr).not.toBeNull();

    // Member flips confirmed → cancelled_by_provider.
    const { data: rows, error } = await owner
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(error).toBeNull();
    expect(rows!.length).toBe(1);

    // Un-cancel is impossible: USING pins status='confirmed'.
    const { data: unRows } = await owner
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(unRows).toEqual([]);

    // An arbitrary target status fails WITH CHECK.
    const b2 = await book("2027-04-14T12:00:00Z", "seam2@example.com");
    expect(b2.error).toBeNull();
    const { error: badTarget } = await owner
      .from("bookings")
      .update({ status: "rescheduled" })
      .eq("id", b2.bookingId!);
    expect(badTarget).not.toBeNull();
  });

  // LAST on purpose: floods its own dedicated org so the 30/min per-org
  // throttle never bleeds into the suites above.
  it("hardening: per-org creation throttle trips at 30/min", async () => {
    const flooder = await signedInUser("lc_flood");
    const { data: org2 } = await flooder.rpc("create_org", { p_name: "FloodCo" });
    const floodOrgId = (org2 as { id: string }).id;
    const floodHandle = `lc-flood-${Date.now()}`;
    await flooder.rpc("update_org_scheduling", {
      p_org_id: floodOrgId,
      p_handle: floodHandle,
      p_timezone: "UTC",
    });
    const { data: svc2 } = await flooder
      .from("services")
      .insert({ org_id: floodOrgId, name: "Flood", duration_min: 30, booking_window_days: 365 })
      .select("id")
      .single();
    const { data: floodStaff } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", floodOrgId)
      .single();
    await flooder
      .from("service_staff")
      .insert({ org_id: floodOrgId, service_id: svc2!.id, staff_id: floodStaff!.id });
    await flooder.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: floodOrgId,
        staff_id: floodStaff!.id,
        weekday,
        start_time: "00:00",
        end_time: "23:59",
      })),
    );

    // 48 half-hour slots per day — walk forward from 2027-05-03T00:00Z.
    let rejected = false;
    for (let i = 0; i < 31; i++) {
      const day = 3 + Math.floor(i / 48);
      const minutes = (i % 48) * 30;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      const { error } = await admin.rpc("create_booking", {
        p_handle: floodHandle,
        p_service_id: svc2!.id,
        p_starts_at: `2027-05-${String(day).padStart(2, "0")}T${hh}:${mm}:00Z`,
        p_name: "Flood",
        p_email: `flood${i}@example.com`,
        p_note: null,
        p_token_hash: generateAccessToken().tokenHash,
        p_staff_id: null,
      });
      if (error) {
        rejected = true;
        expect(i).toBeGreaterThanOrEqual(30);
        break;
      }
    }
    expect(rejected).toBe(true);
  });
});
