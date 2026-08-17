/**
 * Calendar slice: create_booking_admin RPC. Deliberately relaxed vs
 * create_booking — no availability containment, no min-notice, no throttle
 * (authenticated member only); past grace 24h; future cap 365 days. Overlap
 * is still enforced by the EXCLUDE guard (23P01). Requires the local
 * Supabase stack.
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

const HANDLE = `adm-cal-${Date.now()}`;

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

async function adminBook(
  client: SupabaseClient,
  startsAt: string,
  email: string | null,
  serviceOverride?: string,
) {
  const { tokenHash } = generateAccessToken();
  return client.rpc("create_booking_admin", {
    p_service_id: serviceOverride ?? serviceId,
    p_starts_at: startsAt,
    p_name: "Walk-in Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
    p_duration_min: null,
    // 0041: the appointment's staff is now required (and must offer the
    // service). Nothing here exercises multi-staff, so it is always the
    // org's seeded staff row.
    p_staff_id: defaultStaffId,
  });
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let serviceId: string;
let defaultStaffId: string;

describe("create_booking_admin", () => {
  beforeAll(async () => {
    owner = await signedInUser("adm_cal_owner");
    stranger = await signedInUser("adm_cal_stranger");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "AdminCalCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // stranger gets their own org so their staff client is a *member
    // somewhere* but foreign to AdminCalCo.
    const { error: e1b } = await stranger.rpc("create_org", { p_name: "StrangerCalCo" });
    if (e1b) throw e1b;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "UTC",
    });
    if (e2) throw e2;
    // 0041: create_org seeds one staff row — the calendar owner.
    const { data: st, error: e2c } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e2c) throw e2c;
    defaultStaffId = st!.id;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    // A raw services insert does not fan out to staff — that is
    // createService's job. Mirror it here.
    const { error: e3b } = await admin
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: defaultStaffId });
    if (e3b) throw e3b;
    const { error: e4 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId,
        staff_id: defaultStaffId,
        weekday,
        start_time: "09:00",
        end_time: "17:00",
      })),
    );
    if (e4) throw e4;
  });

  it("creates outside open hours (relaxed) and computes ends_at from duration", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T03:00:00Z", "night@example.com");
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("starts_at, ends_at, client_email").eq("id", data as string).single();
    expect(new Date(row!.ends_at).getTime() - new Date(row!.starts_at).getTime()).toBe(60 * 60 * 1000);
    expect(row!.client_email).toBe("night@example.com");
  });

  it("creates without email: client_email and client_id are null", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T05:00:00Z", null);
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("client_email, client_id").eq("id", data as string).single();
    expect(row!.client_email).toBeNull();
    expect(row!.client_id).toBeNull();
  });

  it("with email, upserts the client like create_booking", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T07:00:00Z", "repeat@example.com");
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("client_id").eq("id", data as string).single();
    expect(row!.client_id).not.toBeNull();
  });

  it("rejects a true overlap via the EXCLUDE guard (23P01)", async () => {
    const first = await adminBook(owner, "2027-05-04T10:00:00Z", null);
    expect(first.error).toBeNull();
    const second = await adminBook(owner, "2027-05-04T10:30:00Z", null);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23P01");
  });

  it("rejects starts more than 24h in the past and beyond 365 days", async () => {
    const past = await adminBook(owner, "2020-01-01T10:00:00Z", null);
    expect(past.error!.message).toContain("not found");
    const far = await adminBook(owner, "2100-01-01T10:00:00Z", null);
    expect(far.error!.message).toContain("not found");
  });

  it("rejects a non-member (stranger) and anon", async () => {
    const strangerRes = await adminBook(stranger, "2027-05-05T10:00:00Z", null);
    expect(strangerRes.error).not.toBeNull();
    const anonRes = await adminBook(anon as unknown as SupabaseClient, "2027-05-05T11:00:00Z", null);
    expect(anonRes.error).not.toBeNull();
  });
});

describe("create_booking_admin custom duration", () => {
  async function bookWithDuration(startsAt: string, durationMin: number | null) {
    const { tokenHash } = generateAccessToken();
    return owner.rpc("create_booking_admin", {
      p_service_id: serviceId,
      p_starts_at: startsAt,
      p_name: "Custom Duration",
      p_email: null,
      p_note: null,
      p_token_hash: tokenHash,
      p_duration_min: durationMin,
      p_staff_id: defaultStaffId,
    });
  }

  it("honors a custom duration", async () => {
    const { data, error } = await bookWithDuration("2027-05-06T09:00:00Z", 90);
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("starts_at, ends_at").eq("id", data as string).single();
    expect(new Date(row!.ends_at).getTime() - new Date(row!.starts_at).getTime()).toBe(90 * 60 * 1000);
  });

  it("falls back to the service duration when null", async () => {
    const { data, error } = await bookWithDuration("2027-05-06T12:00:00Z", null);
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("starts_at, ends_at").eq("id", data as string).single();
    expect(new Date(row!.ends_at).getTime() - new Date(row!.starts_at).getTime()).toBe(60 * 60 * 1000);
  });

  it("rejects out-of-range durations", async () => {
    const tooShort = await bookWithDuration("2027-05-06T14:00:00Z", 3);
    expect(tooShort.error).not.toBeNull();
    const tooLong = await bookWithDuration("2027-05-06T15:00:00Z", 600);
    expect(tooLong.error).not.toBeNull();
  });
});
