/**
 * Google Calendar against the real DB (0076): the queue trigger on
 * bookings, the service_role-only grants on both tables, and the reserved
 * handle. Requires the local Supabase stack. notifications.integration
 * idiom throughout.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function signedInUser(tag: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `gcal_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { client, id: data.user.id };
}

let owner: SupabaseClient;
let ownerId: string;
let orgId: string;
let serviceId: string;
let staffId: string;
let day = 0;

async function walkIn(): Promise<string> {
  day += 1;
  const { data, error } = await owner.rpc("create_booking_admin", {
    p_service_id: serviceId,
    p_starts_at: `2027-07-${String(day).padStart(2, "0")}T10:00:00Z`,
    p_name: "Walk-in",
    p_email: null,
    p_note: null,
    p_token_hash: generateAccessToken().tokenHash,
    p_duration_min: null,
    p_staff_id: staffId,
  });
  if (error) throw error;
  return data as string;
}

async function queueRow(bookingId: string) {
  const { data, error } = await admin
    .from("booking_calendar_events")
    .select("pending, attempts, last_error, updated_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  ({ client: owner, id: ownerId } = await signedInUser("owner"));
  const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "GcalCo" });
  if (e1) throw e1;
  orgId = (org as { id: string }).id;
  const { data: svc, error: e2 } = await owner
    .from("services")
    .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
    .select("id")
    .single();
  if (e2) throw e2;
  serviceId = svc!.id;
  const { data: st, error: e3 } = await admin.from("staff").select("id").eq("org_id", orgId).single();
  if (e3) throw e3;
  staffId = st!.id;
  const { error: e4 } = await owner.from("service_staff").insert({ org_id: orgId, service_id: serviceId, staff_id: staffId });
  if (e4) throw e4;
  // The system reschedule checks hours (slot_within_availability); walk-ins do not.
  const { error: e5 } = await owner
    .from("availability_rules")
    .insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ org_id: orgId, staff_id: staffId, weekday, start_time: "09:00", end_time: "17:00" })));
  if (e5) throw e5;
});

describe("queue trigger", () => {
  it("an org without a connection queues nothing", async () => {
    const id = await walkIn();
    expect(await queueRow(id)).toBeNull();
  });

  it("with a connection: insert queues; a tracked change re-queues and resets attempts; an untracked one does not", async () => {
    const { error } = await admin.from("calendar_connections").insert({
      org_id: orgId,
      user_id: ownerId,
      account_email: "owner@example.com",
      refresh_token_enc: "sealed",
    });
    expect(error).toBeNull();

    const id = await walkIn();
    const queued = await queueRow(id);
    expect(queued).toMatchObject({ pending: true, attempts: 0 });

    // The sync "finished" with a failure; a reminder stamp must not disturb it.
    await admin.from("booking_calendar_events").update({ pending: false, attempts: 3, last_error: "boom" }).eq("booking_id", id);
    await admin.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id);
    expect(await queueRow(id)).toMatchObject({ pending: false, attempts: 3, last_error: "boom" });

    // The admin cancel is the app-side UPDATE that runs as `authenticated`.
    const { error: cancelErr } = await owner.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", id);
    expect(cancelErr).toBeNull();
    expect(await queueRow(id)).toMatchObject({ pending: true, attempts: 0, last_error: null });
  });
});

describe("grants", () => {
  it("authenticated can read neither table, service_role can", async () => {
    const conn = await owner.from("calendar_connections").select("id").eq("org_id", orgId);
    expect(conn.error).not.toBeNull();
    const ev = await owner.from("booking_calendar_events").select("booking_id").eq("org_id", orgId);
    expect(ev.error).not.toBeNull();
    const mine = await admin.from("calendar_connections").select("id, account_email").eq("org_id", orgId);
    expect(mine.data).toHaveLength(1);
  });

  it("reschedule_booking_system (0077) is service_role only and moves a confirmed appointment", async () => {
    const id = await walkIn();
    const hash = generateAccessToken().tokenHash;
    const target = `2027-08-${String(day).padStart(2, "0")}T11:00:00Z`;
    const asOwner = await owner.rpc("reschedule_booking_system", { p_booking_id: id, p_starts_at: target, p_token_hash: hash });
    expect(asOwner.error).not.toBeNull();
    const { data, error } = await admin.rpc("reschedule_booking_system", { p_booking_id: id, p_starts_at: target, p_token_hash: hash });
    expect(error).toBeNull();
    const row = (data as Array<{ new_booking_id: string; staff_name: string }>)[0];
    const { data: old } = await admin.from("bookings").select("status").eq("id", id).single();
    const { data: fresh } = await admin.from("bookings").select("status, starts_at, rescheduled_from_id").eq("id", row.new_booking_id).single();
    expect(old?.status).toBe("rescheduled");
    expect(fresh).toMatchObject({ status: "confirmed", rescheduled_from_id: id });
    expect(new Date(fresh!.starts_at).toISOString()).toBe(new Date(target).toISOString());
    // Both rows were queued for the mirror by the trigger.
    expect(await queueRow(row.new_booking_id)).toMatchObject({ pending: true });
  });

  it("'integrations' is a reserved handle", async () => {
    const { error } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: "integrations",
      p_timezone: "UTC",
      p_currency: "PLN",
    });
    expect(error).not.toBeNull();
  });
});
