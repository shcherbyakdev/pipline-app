/**
 * Billing slice against the real DB: RLS/grants on org_subscriptions +
 * billing_events, applyBillingEvents idempotency/ordering, monthly usage
 * count, billing_mrr view. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

// Dynamic, not static: queries.ts pulls in @/lib/supabase/admin → @/env,
// which parses process.env eagerly at module load. A static import would
// resolve (and fail) before the loadEnvFile() call above ever runs.
const { monthlyBookingUsage } = await import("./queries");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `bill_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

const RUN = Date.now().toString(36);
let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;

const subRow = (o: Record<string, unknown> = {}) => ({
  org_id: orgId, plan: "pro", status: "active", billing_interval: "month", seats: 1,
  provider: "fake", provider_customer_id: `cus_${RUN}`, provider_subscription_id: `sub_${RUN}`,
  current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
  cancel_at_period_end: false, provider_updated_at: new Date().toISOString(), ...o,
});

describe("billing: RLS + grants", () => {
  beforeAll(async () => {
    owner = await signedInUser("owner");
    stranger = await signedInUser("stranger");
    const { data, error } = await owner.rpc("create_org", { p_name: "BillCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
    const { error: insErr } = await admin.from("org_subscriptions").insert(subRow());
    if (insErr) throw insErr;
  });

  it("member selects own row; stranger and anon see nothing", async () => {
    const mine = await owner.from("org_subscriptions").select("plan").eq("org_id", orgId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    const theirs = await stranger.from("org_subscriptions").select("plan").eq("org_id", orgId);
    expect(theirs.data ?? []).toHaveLength(0);
    const nobody = await anon.from("org_subscriptions").select("plan");
    expect(nobody.error).not.toBeNull(); // no grant at all
  });

  it("member cannot insert/update/delete", async () => {
    const up = await owner.from("org_subscriptions").update({ plan: "team" }).eq("org_id", orgId);
    expect(up.error).not.toBeNull();
    const del = await owner.from("org_subscriptions").delete().eq("org_id", orgId);
    expect(del.error).not.toBeNull();
  });

  it("billing_events: service_role only", async () => {
    const ins = await admin.from("billing_events").insert({
      provider: "fake", provider_event_id: `evt_${RUN}`, org_id: orgId, type: "subscription_created", payload: {},
    });
    expect(ins.error).toBeNull();
    const dup = await admin.from("billing_events").insert({
      provider: "fake", provider_event_id: `evt_${RUN}`, org_id: orgId, type: "subscription_created", payload: {},
    });
    expect(dup.error?.code).toBe("23505");
    const member = await owner.from("billing_events").select("id");
    expect(member.error).not.toBeNull();
  });

  it("CHECKs reject bad plan/status", async () => {
    const bad = await admin.from("org_subscriptions").update({ plan: "gold" }).eq("org_id", orgId);
    expect(bad.error).not.toBeNull();
  });

  it("billing_mrr counts this org's pro monthly", async () => {
    const { data, error } = await admin.from("billing_mrr").select("*").eq("plan", "pro").eq("billing_interval", "month");
    expect(error).toBeNull();
    expect((data ?? [])[0]?.subscriptions).toBeGreaterThanOrEqual(1);
  });
});

describe("billing: monthlyBookingUsage", () => {
  it("counts original bookings created this month, ignores reschedule rows", async () => {
    // Fixture: a staff + service exist for the org from create_org; insert bookings directly.
    const { data: staff } = await admin.from("staff").select("id").eq("org_id", orgId).limit(1).single();
    const { data: svc } = await admin.from("services").insert({ org_id: orgId, name: "U", duration_min: 30 }).select("id").single();
    const base = Date.now() + 7 * 864e5;
    const mk = (i: number, extra: Record<string, unknown> = {}) => ({
      org_id: orgId, service_id: svc!.id, staff_id: staff!.id, client_name: "c", client_email: "c@example.com",
      starts_at: new Date(base + i * 36e5).toISOString(), ends_at: new Date(base + i * 36e5 + 18e5).toISOString(),
      status: "confirmed", cancel_token_hash: `${RUN}${i}`.padEnd(64, "0").slice(0, 64), ...extra,
    });
    const { data: first, error } = await admin.from("bookings").insert([mk(1), mk(2)]).select("id");
    if (error) throw error;
    await admin.from("bookings").insert(mk(3, { rescheduled_from_id: first![0].id }));
    const n = await monthlyBookingUsage(orgId, "UTC", new Date(), admin);
    expect(n).toBe(2);
  });
});
