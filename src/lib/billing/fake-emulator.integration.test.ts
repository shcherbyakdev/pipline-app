/**
 * The fake provider's emulator against the real DB. `fake-emulator.test.ts`
 * proves the builders produce the right event SHAPES; this proves the shapes
 * survive the projection — the same `applyBillingEvents` → `apply_billing_event`
 * (0043) path a Stripe webhook takes — across a whole subscription lifetime.
 *
 * Structured as one ordered chain rather than independent cases because that
 * is what the dev portal is: every click is applied to the row the previous
 * click left behind, and the interesting failures are the ones where step N
 * quietly poisons step N+1. Requires the local Supabase stack.
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyBillingEvents } from "./apply-events";
import { entitlementsFor, type SubscriptionStatus } from "./entitlements";
import { actionEvents, addInterval, checkoutEvents, fakeIds, type FakeRow } from "./fake-emulator";
import { TEAM_INCLUDED_SEATS, type Interval } from "./plans";
import type { BillingEvent } from "./provider";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

// Dynamic, not static: queries.ts pulls in @/lib/supabase/admin → @/env,
// which parses process.env eagerly at module load, so a static import would
// resolve (and fail) before the loadEnvFile() call above ever runs
// (billing.integration.test.ts precedent).
const { getOrgSubscription } = await import("./queries");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `emu_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

/** A brand-new org of its own, so the chain below owns every row and every
    `billing_events` entry it counts. `create_org` is the only way in — it
    seeds the membership the RLS policies key off. */
async function freshOrg(tag: string): Promise<string> {
  const client = await signedInUser(tag);
  const { data, error } = await client.rpc("create_org", { p_name: `Emulator ${tag}` });
  if (error) throw error;
  return (data as { id: string }).id;
}

const ROW_COLS =
  "plan, status, billing_interval, seats, current_period_end, cancel_at_period_end, provider_customer_id, provider_subscription_id, provider_updated_at";

/** The cached row as the emulator sees it (`readFakeRow`'s mapping, restated
    here so the test doesn't depend on a dev-only module), plus the audit
    column the projection orders by. `sub` is kept separate from
    `providerUpdatedAt` because `sub` is fed straight back into the builders:
    an extra key would ride into the event payload, which the real portal
    never sends. */
async function rowOf(orgId: string): Promise<{ sub: FakeRow; providerUpdatedAt: number } | null> {
  const { data, error } = await admin.from("org_subscriptions").select(ROW_COLS).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    sub: {
      plan: data.plan,
      status: data.status as SubscriptionStatus,
      interval: data.billing_interval as Interval,
      seats: data.seats,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      providerCustomerId: data.provider_customer_id,
      providerSubscriptionId: data.provider_subscription_id,
    },
    providerUpdatedAt: Date.parse(data.provider_updated_at),
  };
}

const at = (iso: string | null) => Date.parse(iso!);

describe("fake emulator: the whole lifecycle through applyBillingEvents", () => {
  it("checkout → cancel → expire → resubscribe → switch → dunning → renew → cancel now", async () => {
    const orgId = await freshOrg("chain");
    const ids = fakeIds(orgId);

    // A controlled clock, one second per step and starting a minute in the
    // PAST: `occurredAt` becomes `provider_updated_at`, the ordering guard,
    // so every stamp this chain writes must stay behind the wall clock — the
    // final assertion checks exactly that (see below).
    let clock = Date.now() - 60_000;
    const tick = () => new Date((clock += 1_000));

    const stamps: number[] = [];
    let applied = 0;

    /** Apply a step's events, assert the projection actually took them, and
        record what the row's stamp became. Nothing here is allowed to be
        "skipped": a stale or replayed event in a hand-built chain means the
        previous step wrote a timestamp it had no business writing. */
    async function step(events: BillingEvent[]): Promise<FakeRow> {
      expect(await applyBillingEvents(admin, events)).toEqual({ processed: events.length, skipped: 0 });
      applied += events.length;
      const read = await rowOf(orgId);
      expect(read).not.toBeNull();
      // The row's stamp is the newest event's `occurredAt` — the direct form
      // of the ordering invariant, and what makes a builder stamping
      // simulated (future) time fail here instead of three steps later.
      const newest = Math.max(...events.map((e) => Date.parse(e.occurredAt)));
      expect(read!.providerUpdatedAt).toBe(newest);
      stamps.push(read!.providerUpdatedAt);
      return read!.sub;
    }

    const planAt = async (now: Date) => entitlementsFor(await getOrgSubscription(orgId, admin), now).plan;

    // 1. Checkout: Pro, monthly.
    let now = tick();
    let row = await step(checkoutEvents({ orgId, plan: "pro", interval: "month", now }));
    expect(row.plan).toBe("pro");
    expect(row.status).toBe("active");
    expect(row.seats).toBe(1);
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.providerCustomerId).toBe(ids.customer);
    expect(row.providerSubscriptionId).toBe(ids.subscription);
    expect(at(row.currentPeriodEnd)).toBe(addInterval(now, "month").getTime());
    expect(await planAt(now)).toBe("pro");

    // 2. Cancel at period end: flagged, but still fully entitled — the whole
    //    point of the flag is that nothing changes until the boundary.
    const flaggedPeriodEnd = at(row.currentPeriodEnd);
    now = tick();
    row = await step(actionEvents("cancel_at_period_end", row, orgId, now));
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.status).toBe("active");
    expect(at(row.currentPeriodEnd)).toBe(flaggedPeriodEnd);
    expect(await planAt(now)).toBe("pro");

    // 3. The boundary arrives: a cancelling subscription expires there
    //    rather than renewing, and the org drops to Free.
    now = tick();
    row = await step(actionEvents("advance_period", row, orgId, now));
    expect(row.status).toBe("expired");
    expect(await planAt(now)).toBe("free");

    // 4. Resubscribe. The org already has a provider customer, so checkout
    //    is handed it (startCheckout's resubscribe path) — a second customer
    //    would split the org's history in two.
    const existingCustomerId = row.providerCustomerId;
    now = tick();
    row = await step(checkoutEvents({ orgId, plan: "pro", interval: "month", now, existingCustomerId }));
    expect(row.providerCustomerId).toBe(existingCustomerId);
    expect(row.status).toBe("active");
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(await planAt(now)).toBe("pro");

    // 5. Pro → Team: seats move with the plan, and the entitlement that
    //    reads them (bookableStaff) moves with the seats.
    now = tick();
    row = await step(actionEvents("switch_team", row, orgId, now));
    expect(row.plan).toBe("team");
    expect(row.seats).toBe(TEAM_INCLUDED_SEATS);
    const teamEnt = entitlementsFor(await getOrgSubscription(orgId, admin), now);
    expect(teamEnt.plan).toBe("team");
    expect(teamEnt.bookableStaff).toBe(TEAM_INCLUDED_SEATS);

    // 6. Renewal charge fails: past_due, and STILL entitled — dunning has
    //    not run out, so the org keeps its plan while the retries happen.
    now = tick();
    row = await step(actionEvents("fail_renewal", row, orgId, now));
    expect(row.status).toBe("past_due");
    expect(row.plan).toBe("team");
    expect(await planAt(now)).toBe("team");

    // 7. Retry succeeds: active again, period rolls from the recovery.
    now = tick();
    row = await step(actionEvents("recover", row, orgId, now));
    expect(row.status).toBe("active");
    expect(at(row.currentPeriodEnd)).toBe(addInterval(now, "month").getTime());
    expect(await planAt(now)).toBe("team");

    // 8. A normal renewal: the new period end is the OLD one + one month,
    //    not `now` + one month — a plan ending on the 18th renews to the
    //    18th however late the boundary is processed.
    const renewedFrom = at(row.currentPeriodEnd);
    now = tick();
    row = await step(actionEvents("advance_period", row, orgId, now));
    expect(row.status).toBe("active");
    expect(at(row.currentPeriodEnd)).toBe(addInterval(new Date(renewedFrom), "month").getTime());
    expect(await planAt(now)).toBe("team");

    // 9. Cancel now: gone immediately, whatever is left of the period.
    now = tick();
    row = await step(actionEvents("cancel_now", row, orgId, now));
    expect(row.status).toBe("expired");
    expect(await planAt(now)).toBe("free");

    // --- Invariants over the whole chain ---

    // `provider_updated_at` never goes backwards. It is the guard
    // apply_billing_event orders by (`provider_updated_at <= incoming`), so a
    // step that writes a timestamp AHEAD of real time makes every later
    // event read as stale and get dropped — silently, until the wall clock
    // catches up. That is exactly the Task-1 bug: `advance_period` stamped
    // the period END, normally a month or a year out, and "cancel now"
    // afterwards appeared to do nothing.
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i], `provider_updated_at went backwards at step ${i + 1}`).toBeGreaterThanOrEqual(stamps[i - 1]);
    }
    // Monotonic against each other is not enough — a single jump into the
    // future is monotonic too. Every stamp must also be behind REAL time.
    const wallClock = Date.now();
    for (const [i, stamp] of stamps.entries()) {
      expect(stamp, `step ${i + 1} stamped the future`).toBeLessThanOrEqual(wallClock);
    }

    // Every event reached the audit log exactly once: `billing_events` is
    // both the audit trail and the idempotency key, so a chain that lost or
    // duplicated one has a projection that cannot be replayed.
    const { count, error } = await admin
      .from("billing_events").select("*", { count: "exact", head: true }).eq("org_id", orgId);
    expect(error).toBeNull();
    expect(count).toBe(applied);
  });

  it("a first charge that fails creates the subscription past_due", async () => {
    // Stripe's `4000 0000 0000 0341`: the card attaches, the subscription is
    // created, the first charge fails. The org is born in dunning — the row
    // exists and still entitles, it just started past_due instead of active.
    const orgId = await freshOrg("firstcharge");
    const now = new Date();
    const events = checkoutEvents({ orgId, plan: "team", interval: "year", now, firstChargeFails: true });
    expect(await applyBillingEvents(admin, events)).toEqual({ processed: 1, skipped: 0 });

    const read = await rowOf(orgId);
    expect(read).not.toBeNull();
    expect(read!.sub.status).toBe("past_due");
    expect(read!.sub.plan).toBe("team");
    expect(read!.sub.interval).toBe("year");
    expect(read!.sub.seats).toBe(TEAM_INCLUDED_SEATS);
    expect(at(read!.sub.currentPeriodEnd)).toBe(addInterval(now, "year").getTime());
    expect(entitlementsFor(await getOrgSubscription(orgId, admin), now).plan).toBe("team");
  });
});
