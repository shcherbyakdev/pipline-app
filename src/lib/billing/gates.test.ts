// gates.ts imports queries.ts, which imports "@/env" (eager parse) — stub the
// vars before any import runs, same as fake.test.ts does for env-eager
// billing modules. A static `import ... from "./gates"` would be hoisted
// above these assignments (ES module semantics), so import it dynamically.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlementsFor, type OrgSubscriptionRow, type ResourceKind } from "./entitlements";
import { enTranslator } from "@/i18n/test-translator";
import { refusalCopy, type GateRefusal } from "./refusal";
const { resourceGate, serviceGate, evaluateResourceGate, evaluateServiceGate, upgradeHint } = await import("./gates");
const T = enTranslator("errors");
const planLimitResourceError = (max: number, how: "billing" | "waitlist" | "none", kind: ResourceKind = "people"): GateRefusal => ({ reason: "resources", kind, max, how });
const planLimitServicesError = (max: number, how: "billing" | "waitlist" | "none"): GateRefusal => ({ reason: "services", max, how });
const GENERIC_WRITE_ERROR: GateRefusal = { reason: "failed", how: "none" };

const now = new Date("2026-08-18T12:00:00Z");
const row = (o: Partial<OrgSubscriptionRow>): OrgSubscriptionRow => ({
  plan: "pro", status: "active", interval: "month", seats: 1,
  currentPeriodEnd: "2026-09-18T12:00:00Z", cancelAtPeriodEnd: false, ...o,
});

const free = entitlementsFor(null, now);
const pro = entitlementsFor(row({ plan: "pro" }), now);
const team5 = entitlementsFor(row({ plan: "team", seats: 5 }), now);

const SPACES = { offersAppointments: false, offersRentals: true };

describe("resourceGate", () => {
  it("Free, spaces, the backfilled person + two units → the cap copy (both slots spent by units)", () => {
    expect(resourceGate({ activeStaff: 1, activeUnits: 2 }, SPACES, free)).toEqual(planLimitResourceError(2, "billing", "units"));
  });
  it("Free, appointments-only, one person → allowed (you plus one member is free)", () => {
    expect(resourceGate({ activeStaff: 1, activeUnits: 0 }, { offersAppointments: true, offersRentals: false }, free)).toBeNull();
  });
  it("Free, spaces-only, the backfilled person and no unit → allowed", () => {
    expect(resourceGate({ activeStaff: 1, activeUnits: 0 }, SPACES, free)).toBeNull();
  });
  it("Team (5 seats), spaces, 5 units → the cap copy", () => {
    const message = resourceGate({ activeStaff: 1, activeUnits: 5 }, SPACES, team5);
    expect(message).toEqual(planLimitResourceError(5, "billing", "units"));
    expect(refusalCopy(T, message!).error).toContain("covers 5 units");
  });
  it("Team (5 seats), spaces, 4 units → allowed", () => {
    expect(resourceGate({ activeStaff: 1, activeUnits: 4 }, SPACES, team5)).toBeNull();
  });
  it("S6: a count > 1 (an equipment space's items) is weighed as a whole", () => {
    expect(resourceGate({ activeStaff: 1, activeUnits: 2 }, SPACES, team5, "billing", 2)).toBeNull();
    expect(resourceGate({ activeStaff: 1, activeUnits: 2 }, SPACES, team5, "billing", 4)).toEqual(
      planLimitResourceError(5, "billing", "units"),
    );
  });
});

describe("refusalCopy", () => {
  it("names the org's own channel — people, or units — never \"resources\"", () => {
    expect(refusalCopy(T, planLimitResourceError(1, "billing")).error).toBe(
      "Your plan covers 1 person. Upgrade in Billing to add more.",
    );
    expect(refusalCopy(T, planLimitResourceError(5, "billing")).error).toBe(
      "Your plan covers 5 people. Upgrade in Billing to add more.",
    );
    expect(refusalCopy(T, planLimitResourceError(2, "billing", "units")).error).toBe(
      "Your plan covers 2 units. Upgrade in Billing to add more.",
    );
  });
  it("names the waitlist while that is the way up, and says so when nothing is", () => {
    expect(refusalCopy(T, planLimitResourceError(1, "waitlist"))).toEqual({
      error: "Your plan covers 1 person. Join the Premium waitlist to add more.",
      upgrade: { href: "/waitlist", label: "Join the waitlist" },
    });
    expect(refusalCopy(T, planLimitResourceError(3, "none", "units"))).toEqual({
      error: "Your plan covers 3 units. Higher limits come with paid plans.",
      upgrade: null,
    });
    expect(refusalCopy(T, planLimitServicesError(3, "billing"))).toEqual({
      error: "Your plan allows 3 services on your booking page. Upgrade in Billing to add more.",
      upgrade: { href: "/billing", label: "Open Billing" },
    });
    expect(refusalCopy(T, GENERIC_WRITE_ERROR)).toEqual({ error: "Couldn't save. Try again.", upgrade: null });
  });
});

describe("upgradeHint", () => {
  it("Billing while it is on, whatever the plan", () => {
    expect(upgradeHint({ billing: true, premium_waitlist: true }, free)).toBe("billing");
    expect(upgradeHint({ billing: true, premium_waitlist: false }, pro)).toBe("billing");
  });
  it("the waitlist only helps a Free org; a waitlisted org at Pro's cap has no door yet", () => {
    expect(upgradeHint({ billing: false, premium_waitlist: true }, free)).toBe("waitlist");
    expect(upgradeHint({ billing: false, premium_waitlist: true }, pro)).toBe("none");
    expect(upgradeHint({ billing: false, premium_waitlist: false }, free)).toBe("none");
  });
});

describe("serviceGate", () => {
  it("Free at 50 services → null (services are unlimited on every plan)", () => {
    expect(serviceGate(50, free)).toBeNull();
  });
  it("a capped plan at its limit → message carrying the cap", () => {
    expect(serviceGate(3, { ...free, publicServices: 3 })).toEqual(planLimitServicesError(3, "billing"));
  });
  it("Pro at 50 services → null", () => {
    expect(serviceGate(50, pro)).toBeNull();
  });
});

// Minimal stub: `client.from(table)` returns a chainable+awaitable builder.
// `.select()`/`.eq()` return the builder itself (so any number of chained
// `.eq()` calls works — one for services, two for staff); `.maybeSingle()`
// and `await`ing the builder directly both resolve to the same result,
// matching how queries.ts and gates.ts each terminate the chain.
type TableResult = { count?: number | null; data?: unknown; error?: unknown };
function stubClient(tables: Record<string, TableResult>): SupabaseClient {
  const builderFor = (t: TableResult) => {
    const result = Promise.resolve({ data: t.data ?? null, count: t.count ?? null, error: t.error ?? null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => result,
      then: result.then.bind(result),
    };
    return builder;
  };
  return { from: (table: string) => builderFor(tables[table] ?? {}) } as unknown as SupabaseClient;
}

const orgSubRow = (o: Partial<{ plan: string; status: string; billing_interval: string; seats: number; current_period_end: string | null; cancel_at_period_end: boolean }>) => ({
  plan: "pro", status: "active", billing_interval: "month", seats: 1,
  current_period_end: "2026-09-18T12:00:00Z", cancel_at_period_end: false, ...o,
});

const orgModeRow = (offersAppointments: boolean, offersRentals: boolean) => ({
  offers_appointments: offersAppointments, offers_rentals: offersRentals,
});
const FLAGS_ON = { rentals: true, billing: true, premium_waitlist: false };
// The pre-billing world: the waitlist is the upgrade path.
const FLAGS_WAITLIST = { rentals: true, billing: false, premium_waitlist: true };

describe("evaluateResourceGate", () => {
  it("Free both-mode org at 2 people + 0 units → refusal (the second member spent the free slot)", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 2, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toEqual(planLimitResourceError(2, "billing"));
  });
  it("Free org at 1 person → allowed: you plus one team member is free", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, false), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_WAITLIST)).resolves.toBeNull();
  });
  it("with the waitlist as the way up, the Free refusal points at it", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 2, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_WAITLIST)).resolves.toEqual(planLimitResourceError(2, "waitlist"));
  });
  it("a waitlisted org gets Pro's budget, and at its cap is told there is no door yet", async () => {
    const waitlisted = (staff: number) => stubClient({
      org_subscriptions: { data: null, error: null },
      premium_waitlist: { data: { joined_at: "2026-09-01T00:00:00Z" }, error: null },
      orgs: { data: orgModeRow(true, false), error: null },
      staff: { count: staff, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", waitlisted(4), FLAGS_WAITLIST)).resolves.toBeNull();
    await expect(evaluateResourceGate("org-1", waitlisted(5), FLAGS_WAITLIST)).resolves.toEqual(planLimitResourceError(5, "none"));
  });
  it("Free spaces-only org at 1 (backfilled) person + 0 units → allowed", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(false, true), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("the rentals kill-switch stops units from counting", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(false, true), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 9, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, { ...FLAGS_ON, rentals: false })).resolves.toBeNull();
  });
  it("Team org (5 seats) at 2 people + 2 units → allowed (null)", async () => {
    const client = stubClient({
      org_subscriptions: { data: orgSubRow({ plan: "team", seats: 5 }), error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 2, error: null },
      rental_units: { count: 2, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("a failed count lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: null, error: new Error("connection reset") },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toEqual(GENERIC_WRITE_ERROR);
  });
  it("a missing org row refuses conservatively too", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: null, error: null },
      staff: { count: 0, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toEqual(GENERIC_WRITE_ERROR);
  });
  it("a failed entitlements lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: new Error("connection reset") },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 0, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toEqual(GENERIC_WRITE_ERROR);
  });
});

describe("evaluateServiceGate", () => {
  it("Free org at 50 services → allowed (no plan caps services)", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      services: { count: 50, error: null },
    });
    await expect(evaluateServiceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("a waitlisted org at 50 services → allowed (the waitlist grants Pro)", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      premium_waitlist: { data: { joined_at: "2026-09-01T00:00:00Z" }, error: null },
      services: { count: 50, error: null },
    });
    await expect(evaluateServiceGate("org-1", client, FLAGS_WAITLIST)).resolves.toBeNull();
  });
  it("Pro org at 50 services → allowed (null)", async () => {
    const client = stubClient({
      org_subscriptions: { data: orgSubRow({ plan: "pro" }), error: null },
      services: { count: 50, error: null },
    });
    await expect(evaluateServiceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("a failed count lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      services: { count: null, error: new Error("connection reset") },
    });
    await expect(evaluateServiceGate("org-1", client, FLAGS_ON)).resolves.toEqual(GENERIC_WRITE_ERROR);
  });
});
