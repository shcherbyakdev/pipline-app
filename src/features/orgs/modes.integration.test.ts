/**
 * Org modes (0054, one channel per org since 0073): create_org /
 * create_org_with_page with channel flags, update_org_modes, the
 * orgs_offers_one CHECK, and public-RPC gating — the other channel's create
 * RPC answers the uniform 'not found'. The public create RPCs are
 * service_role-only (0052), so they are exercised through `admin`. Requires
 * the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone } from "@/features/scheduling/slots";

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

const TZ = "Europe/Berlin";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

async function flags(orgId: string) {
  const { data, error } = await admin
    .from("orgs")
    .select("offers_appointments, offers_rentals")
    .eq("id", orgId)
    .single();
  if (error) throw error;
  return data as { offers_appointments: boolean; offers_rentals: boolean };
}

describe("create_org (0054 / 0073)", () => {
  it("defaults to appointments when called with only a name", async () => {
    const u = await signedInUser("modes_default");
    const { data, error } = await u.rpc("create_org", { p_name: "DefaultCo" });
    expect(error).toBeNull();
    expect(await flags((data as { id: string }).id)).toEqual({
      offers_appointments: true,
      offers_rentals: false,
    });
  });

  it("rejects both channels off, and both on", async () => {
    const u = await signedInUser("modes_none");
    const none = await u.rpc("create_org", { p_name: "NoneCo", p_offers_appointments: false, p_offers_rentals: false });
    expect(none.error?.message).toMatch(/pick one/);
    const both = await u.rpc("create_org", { p_name: "BothCo", p_offers_appointments: true, p_offers_rentals: true });
    expect(both.error?.message).toMatch(/pick one/);
  });
});

describe("create_org_with_page (0054)", () => {
  it("stores an explicit spaces choice alongside handle and timezone", async () => {
    const u = await signedInUser("modes_page");
    const handle = `modes-page-${Date.now()}`;
    const { data, error } = await u.rpc("create_org_with_page", {
      p_name: "PageCo",
      p_handle: handle,
      p_timezone: TZ,
      p_offers_appointments: false,
      p_offers_rentals: true,
    });
    expect(error).toBeNull();
    const org = data as { id: string; handle: string };
    expect(org.handle).toBe(handle);
    expect(await flags(org.id)).toEqual({ offers_appointments: false, offers_rentals: true });
  });
});

describe("update_org_modes (0054 / 0073)", () => {
  let owner: SupabaseClient;
  let orgId: string;

  beforeAll(async () => {
    owner = await signedInUser("modes_owner");
    const { data, error } = await owner.rpc("create_org", { p_name: "ModesCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
  });

  it("switches the channel for a member", async () => {
    const { error } = await owner.rpc("update_org_modes", {
      p_org_id: orgId,
      p_offers_appointments: false,
      p_offers_rentals: true,
    });
    expect(error).toBeNull();
    expect(await flags(orgId)).toEqual({ offers_appointments: false, offers_rentals: true });
  });

  it("rejects both off, and both on", async () => {
    const none = await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: false, p_offers_rentals: false });
    expect(none.error?.message).toMatch(/pick one/);
    const both = await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: true, p_offers_rentals: true });
    expect(both.error?.message).toMatch(/pick one/);
    expect(await flags(orgId)).toEqual({ offers_appointments: false, offers_rentals: true });
  });

  it("rejects a non-member with 'org not found'", async () => {
    const stranger = await signedInUser("modes_stranger");
    const { error } = await stranger.rpc("update_org_modes", {
      p_org_id: orgId,
      p_offers_appointments: true,
      p_offers_rentals: false,
    });
    expect(error?.message).toMatch(/org not found/);
  });

  it("CHECK blocks a direct all-false or all-true write even for service_role", async () => {
    const none = await admin.from("orgs").update({ offers_appointments: false, offers_rentals: false }).eq("id", orgId);
    expect(none.error?.message).toMatch(/orgs_offers_one/);
    const both = await admin.from("orgs").update({ offers_appointments: true, offers_rentals: true }).eq("id", orgId);
    expect(both.error?.message).toMatch(/orgs_offers_one/);
  });
  it("refuses to leave a channel that still has an active row; allowed once it is off", async () => {
    // ModesCo is a spaces org by now (the first test switched it).
    const { data: off, error: e1 } = await owner
      .from("rental_offerings")
      .insert({ org_id: orgId, name: "Cabin", range_mode: "nights", start_time: "15:00", end_time: "11:00" })
      .select("id")
      .single();
    if (e1) throw e1;
    const blocked = await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: true, p_offers_rentals: false });
    expect(blocked.error?.message).toMatch(/channel_in_use/);
    expect(await flags(orgId)).toEqual({ offers_appointments: false, offers_rentals: true });
    // Re-asserting the current channel is a no-op, not a refusal.
    const same = await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: false, p_offers_rentals: true });
    expect(same.error).toBeNull();
    const { error: e2 } = await owner.from("rental_offerings").update({ active: false }).eq("id", off!.id);
    if (e2) throw e2;
    const ok = await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: true, p_offers_rentals: false });
    expect(ok.error).toBeNull();
    expect(await flags(orgId)).toEqual({ offers_appointments: true, offers_rentals: false });
  });
});

describe("public RPC gating (0054 / 0073)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  const HANDLE = `modes-gate-${Date.now()}`;

  // An appointments org (the default) that holds a space anyway — rows are
  // never channel-gated, only the public create RPCs are.
  beforeAll(async () => {
    owner = await signedInUser("modes_gate");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "GateCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    const { data: off, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Cabin",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        turnover_days: 0,
        booking_window_days: 730,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = off!.id;
    const { error: e4 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Cabin 1" });
    if (e4) throw e4;
  });

  // service_role-only since 0052 — exercised via `admin`, exactly as the
  // server actions call it.
  function bookRental() {
    return admin.rpc("create_rental_booking", {
      p_handle: HANDLE,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(30),
      p_end_date: d(32),
      p_name: "Gate Guest",
      p_email: `gate-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
  }

  it("admin RPCs are not gated: create_rental_booking_admin succeeds while rentals are off", async () => {
    expect(await flags(orgId)).toEqual({ offers_appointments: true, offers_rentals: false });
    // create_rental_booking_admin (0039) resolves org via user_orgs() — no
    // p_org_id — and has no p_ignore_limits param; it does require the same
    // token hash the anon RPC does.
    const { error } = await owner.rpc("create_rental_booking_admin", {
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(60),
      p_end_date: d(61),
      p_name: "Walk-in",
      p_email: `walkin-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
  });

  it("create_rental_booking answers 'not found' while rentals are off, then works once the org switches", async () => {
    const blocked = await bookRental();
    expect(blocked.error?.message).toMatch(/not found/);

    // No active service, so the switch is allowed.
    const on = await owner.rpc("update_org_modes", {
      p_org_id: orgId,
      p_offers_appointments: false,
      p_offers_rentals: true,
    });
    expect(on.error).toBeNull();
    const ok = await bookRental();
    expect(ok.error).toBeNull();
    expect(typeof ok.data).toBe("string");
  });

  it("create_booking answers 'not found' while appointments are off", async () => {
    // The gate fires at org resolution, before any service/slot lookup —
    // a bogus service id must not change the answer.
    const { error } = await admin.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: "00000000-0000-0000-0000-000000000000",
      p_starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      p_name: "Gate Client",
      p_email: "gate-client@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error?.message).toMatch(/not found/);
  });
});
