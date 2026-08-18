/**
 * Billing slice against the real DB: RLS/grants on org_subscriptions +
 * billing_events, applyBillingEvents idempotency/ordering, monthly usage
 * count, billing_mrr view. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyBillingEvents } from "./apply-events";
import type { BillingEvent } from "./provider";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

// Dynamic, not static: queries.ts pulls in @/lib/supabase/admin → @/env,
// which parses process.env eagerly at module load. A static import would
// resolve (and fail) before the loadEnvFile() call above ever runs.
const { monthlyBookingUsage, emailBadgeUrl } = await import("./queries");

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
  // Fixed, far-past baseline (not `new Date()`): the applyBillingEvents
  // suite below asserts ordering against fixture timestamps hardcoded to
  // "today" (2026-08-18); a real "now" baseline would race those fixed
  // clock-times and start failing the moment the suite runs past whatever
  // wall-clock hour the fixtures assume.
  cancel_at_period_end: false, provider_updated_at: "2000-01-01T00:00:00Z", ...o,
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
    // Insert too, not just update/delete: there is no insert POLICY, but the
    // grant is what actually stops it — a member handing itself a Team row
    // would be a free upgrade, so the hole is worth its own assertion.
    const ins = await owner.from("org_subscriptions").insert(subRow({ org_id: orgId, plan: "team", provider_subscription_id: `sub_self_${RUN}` }));
    expect(ins.error).not.toBeNull();
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
    // Original row, non-"confirmed" status — proves the count is "any
    // status", not `.eq("status", "confirmed")` in disguise.
    await admin.from("bookings").insert(mk(4, { status: "cancelled_by_client" }));
    const n = await monthlyBookingUsage(orgId, "UTC", new Date(), admin);
    expect(n).toBe(3);

    // Ordinal form (`before`): how many the org had made BEFORE that instant
    // — the number the reminder quota asks for. mk(1)+mk(2) went in as one
    // statement, so they share now(); mk(4) is a later statement, so asking
    // "before mk(4)" must answer 2, not 3.
    const { data: last } = await admin
      .from("bookings").select("created_at").eq("org_id", orgId).is("rescheduled_from_id", null)
      .order("created_at", { ascending: false }).limit(1).single();
    const before = await monthlyBookingUsage(orgId, "UTC", new Date(), admin, { before: last!.created_at });
    expect(before).toBe(2);
  });
});

describe("billing: emailBadgeUrl", () => {
  // While BILLING_ENABLED is false hiding is allowed unconditionally, so the
  // org's own tick decides — the same answer its booking page gives. (Flag
  // on, the org's plan has to allow it too; that path is unit-covered by
  // badgeVisible + entitlementsFor.)
  //
  // Its OWN org, with no org_subscriptions row: the shared `orgId` above is
  // on a paid plan by this point, which would hide the badge under either
  // rule and prove nothing. A Free org is exactly the case the old code got
  // wrong (Free.hideBadge = false → badge despite the tick).
  it("honours the org's Hide tick while billing is off, even with no subscription", async () => {
    const free = await signedInUser("badge");
    const { data, error: orgError } = await free.rpc("create_org", { p_name: "BadgeCo" });
    if (orgError) throw orgError;
    const freeOrgId = (data as { id: string }).id;
    const setTheme = async (hidePoweredBy: boolean) => {
      const { error } = await admin.from("orgs").update({ widget_theme: { hidePoweredBy } }).eq("id", freeOrgId);
      if (error) throw error;
    };
    await setTheme(true);
    expect(await emailBadgeUrl(freeOrgId)).toBeNull();
    await setTheme(false);
    expect(await emailBadgeUrl(freeOrgId)).toContain("?ref=badge");
  });
});

const ev = (id: string, at: string, o: Partial<BillingEvent> = {}, s: Partial<NonNullable<BillingEvent["subscription"]>> = {}): BillingEvent => ({
  provider: "fake", providerEventId: `${RUN}-${id}`, occurredAt: at, orgId: orgId, type: "subscription_updated", raw: { id },
  subscription: { providerCustomerId: `cus_${RUN}`, providerSubscriptionId: `sub_${RUN}`, plan: "team", interval: "year", seats: 5,
    status: "active", currentPeriodEnd: "2027-01-01T00:00:00Z", cancelAtPeriodEnd: false, ...s },
  ...o,
});

describe("billing: applyBillingEvents", () => {
  it("applies, dedupes replays, ignores older events, records unresolvable orgs", async () => {
    const r1 = await applyBillingEvents(admin, [ev("a", "2026-08-18T10:00:00Z")]);
    expect(r1).toEqual({ processed: 1, skipped: 0 });
    let row = (await admin.from("org_subscriptions").select("plan, seats").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");

    const r2 = await applyBillingEvents(admin, [ev("a", "2026-08-18T10:00:00Z")]); // replay
    expect(r2).toEqual({ processed: 0, skipped: 1 });

    const r3 = await applyBillingEvents(admin, [ev("old", "2026-08-18T09:00:00Z", {}, { plan: "pro" })]); // older
    expect(r3.skipped).toBe(1);
    row = (await admin.from("org_subscriptions").select("plan, seats").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");

    const r4 = await applyBillingEvents(admin, [ev("x", "2026-08-18T11:00:00Z", { orgId: null })]);
    expect(r4.skipped).toBe(1);
    const logged = await admin.from("billing_events").select("error").eq("provider_event_id", `${RUN}-x`).single();
    expect(logged.data?.error).toBe("unresolvable org");

    const r5 = await applyBillingEvents(admin, [ev("exp", "2026-08-18T12:00:00Z", { type: "subscription_expired" }, { status: "expired" })]);
    expect(r5.processed).toBe(1);
    // Separate variable, not a `row =` reassignment: `row`'s declared type
    // was fixed by its `select("plan, seats")` initializer above, so it has
    // no `status` field to narrow onto.
    const statusRow = (await admin.from("org_subscriptions").select("status").eq("org_id", orgId).single()).data! as unknown as { plan: string; seats: number; status: string };
    expect(statusRow.status).toBe("expired");
  });

  it("is order-safe under concurrent, interleaved deliveries", async () => {
    // Later than the previous test's last event (12:00Z), so every one of
    // these six actually beats the row currently in place.
    const base = Date.parse("2026-08-18T12:00:00Z");
    const cev = (n: number) => ev(`c${n}`, new Date(base + n * 60_000).toISOString(), {}, { plan: n % 2 === 0 ? "team" : "pro" });
    const [e1, e2, e3, e4, e5, e6] = [1, 2, 3, 4, 5, 6].map(cev);

    // Two overlapping batches, each internally out of order, racing the
    // same org's row — the projection RPC must still land on the single
    // newest event (e6) no matter how the two batches interleave.
    await Promise.all([
      applyBillingEvents(admin, [e6, e1, e3]),
      applyBillingEvents(admin, [e5, e2, e4]),
    ]);

    const row = (await admin.from("org_subscriptions").select("plan, provider_updated_at").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");
    // Value equality, not string equality: PostgREST serialises timestamptz
    // as "...+00:00", not the "...Z" that Date#toISOString() produces.
    expect(Date.parse(row.provider_updated_at)).toBe(Date.parse(e6.occurredAt));

    const recorded = await admin.from("billing_events").select("provider_event_id")
      .in("provider_event_id", [e1, e2, e3, e4, e5, e6].map((e) => e.providerEventId));
    expect(recorded.data ?? []).toHaveLength(6);
  });

  it("expires the cached row for a subscription_expired that carries no subscription payload", async () => {
    // Stripe deleted a subscription whose price maps to nothing we know
    // (rotated/archived price): the adapter still emits the expiry with
    // `subscription: null`. Dropping it as "skipped" would leave the org
    // paid forever in our cache, so the RPC expires it from type + org.
    const r = await applyBillingEvents(admin, [
      ev("expnull", "2026-08-18T13:00:00Z", { type: "subscription_expired", subscription: null }),
    ]);
    expect(r).toEqual({ processed: 1, skipped: 0 });
    const row = (await admin.from("org_subscriptions").select("status, provider_updated_at").eq("org_id", orgId).single()).data!;
    expect(row.status).toBe("expired");
    expect(Date.parse(row.provider_updated_at)).toBe(Date.parse("2026-08-18T13:00:00Z"));

    // Same guard as the upsert: an OLDER null-payload expiry is stale, not a
    // second write.
    const older = await applyBillingEvents(admin, [
      ev("expold", "2026-08-18T12:30:00Z", { type: "subscription_expired", subscription: null }),
    ]);
    expect(older).toEqual({ processed: 0, skipped: 1 });
  });

  it("same-second events: the later-applied one wins (guard is <=, not <)", async () => {
    // Stripe emits created + updated inside the same second routinely. A
    // strict `<` guard dropped the second of the pair as "stale"; replays
    // are caught by the billing_events unique index, not by this guard.
    const at = "2026-08-18T14:00:00Z";
    const first = ev("tie-a", at, {}, { plan: "pro", interval: "month", seats: 1 });
    const second = ev("tie-b", at, {}, { plan: "team", interval: "year", seats: 5 });
    const r = await applyBillingEvents(admin, [first, second]);
    expect(r).toEqual({ processed: 2, skipped: 0 });
    const row = (await admin.from("org_subscriptions").select("plan, seats, status").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");
    expect(row.seats).toBe(5);
  });
});
