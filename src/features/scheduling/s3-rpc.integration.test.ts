/**
 * S3 widget/embed RPCs: update_org_widget_theme (validated jsonb write to
 * orgs.widget_theme, same select-only-orgs discipline as branding) and
 * rotate_booking_token (manage-link rotation — confirmed + future only).
 * Requires the local Supabase stack.
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

const HANDLE = `s3-rpc-${Date.now()}`;

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
let stranger: SupabaseClient;
let orgId: string;
let serviceId: string;

beforeAll(async () => {
  owner = await signedInUser("s3_owner");
  stranger = await signedInUser("s3_stranger");
  const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "WidgetCo" });
  if (e1) throw e1;
  orgId = (org as { id: string }).id;
  // stranger gets their own org so their staff client is a *member
  // somewhere* but foreign to WidgetCo.
  const { error: e1b } = await stranger.rpc("create_org", { p_name: "StrangerWidgetCo" });
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
  const { error: e4 } = await owner.from("availability_rules").insert(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      org_id: orgId,
      weekday,
      start_time: "09:00",
      end_time: "17:00",
    })),
  );
  if (e4) throw e4;
});

describe("update_org_widget_theme", () => {
  it("stores a valid theme and null clears it", async () => {
    const theme = { theme: "dark", radius: "round", font: "inter", hidePoweredBy: true };
    const { error } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: theme });
    expect(error).toBeNull();
    const { data } = await admin.from("orgs").select("widget_theme").eq("id", orgId).single();
    expect(data!.widget_theme).toEqual(theme);
    const { error: clearErr } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: null });
    expect(clearErr).toBeNull();
    const { data: cleared } = await admin.from("orgs").select("widget_theme").eq("id", orgId).single();
    expect(cleared!.widget_theme).toBeNull();
  });

  it("rejects bad enum, bad hex, unknown font, non-boolean flag", async () => {
    for (const bad of [
      { theme: "neon" },
      { background: "#12345" },
      { background: "#GGGGGG" },
      { font: "comic-sans" },
      { hidePoweredBy: "yes" },
    ]) {
      const { error } = await owner.rpc("update_org_widget_theme", { p_org_id: orgId, p_theme: bad });
      expect(error, JSON.stringify(bad)).not.toBeNull();
    }
  });

  it("rejects a non-member", async () => {
    const { error } = await stranger.rpc("update_org_widget_theme", {
      p_org_id: orgId, p_theme: { theme: "dark" },
    });
    expect(error).not.toBeNull();
  });
});

describe("rotate_booking_token", () => {
  it("rotates the hash so the old manage link dies", async () => {
    const first = generateAccessToken();
    const { data: bookingId } = await anon.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId,
      p_starts_at: "2027-06-01T10:00:00Z", p_name: "Rotate Me",
      p_email: "rotate@example.com", p_note: null, p_token_hash: first.tokenHash,
    });
    const fresh = generateAccessToken();
    const { data: rotated, error } = await owner.rpc("rotate_booking_token", {
      p_booking_id: bookingId, p_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    expect(rotated).toBe(bookingId);
    const { data: oldResolve } = await anon.rpc("resolve_booking_token", { p_token: first.token });
    expect(oldResolve).toEqual([]);
    const { data: newResolve } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
    expect((newResolve as unknown[]).length).toBe(1);
  });

  it("rejects foreign, cancelled, and past bookings", async () => {
    const fresh = generateAccessToken();
    const { error: foreignErr } = await stranger.rpc("rotate_booking_token", {
      p_booking_id: "00000000-0000-4000-8000-000000000000", p_token_hash: fresh.tokenHash,
    });
    expect(foreignErr).not.toBeNull();
    // cancelled: create then admin-cancel via status update, then rotate must fail
    const t = generateAccessToken();
    const { data: cancelId } = await anon.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId,
      p_starts_at: "2027-06-01T12:00:00Z", p_name: "Cancelled",
      p_email: "cancelled@example.com", p_note: null, p_token_hash: t.tokenHash,
    });
    await owner.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", cancelId);
    const { error: cancelledErr } = await owner.rpc("rotate_booking_token", {
      p_booking_id: cancelId, p_token_hash: generateAccessToken().tokenHash,
    });
    expect(cancelledErr).not.toBeNull();
    // past: create in the future (create_booking rejects past starts_at
    // outright), then admin-backdate starts_at/ends_at, then rotate must fail.
    const p = generateAccessToken();
    const { data: pastId } = await anon.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId,
      p_starts_at: "2027-06-01T14:00:00Z", p_name: "Past",
      p_email: "past@example.com", p_note: null, p_token_hash: p.tokenHash,
    });
    const { error: backdateErr } = await admin
      .from("bookings")
      .update({ starts_at: "2020-01-01T10:00:00Z", ends_at: "2020-01-01T11:00:00Z" })
      .eq("id", pastId);
    if (backdateErr) throw backdateErr;
    const { error: pastErr } = await owner.rpc("rotate_booking_token", {
      p_booking_id: pastId, p_token_hash: generateAccessToken().tokenHash,
    });
    expect(pastErr).not.toBeNull();
  });
});
