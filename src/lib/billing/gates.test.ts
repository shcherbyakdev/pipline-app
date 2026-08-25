// gates.ts imports queries.ts, which imports "@/env" (eager parse) — stub the
// vars before any import runs, same as fake.test.ts does for env-eager
// billing modules. A static `import ... from "./gates"` would be hoisted
// above these assignments (ES module semantics), so import it dynamically.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlementsFor, type OrgSubscriptionRow } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";
const { staffGateMessage, serviceGateMessage, evaluateStaffGate, evaluateServiceGate } = await import("./gates");

const now = new Date("2026-08-18T12:00:00Z");
const row = (o: Partial<OrgSubscriptionRow>): OrgSubscriptionRow => ({
  plan: "pro", status: "active", interval: "month", seats: 1,
  currentPeriodEnd: "2026-09-18T12:00:00Z", cancelAtPeriodEnd: false, ...o,
});

const free = entitlementsFor(null, now);
const pro = entitlementsFor(row({ plan: "pro" }), now);
const team5 = entitlementsFor(row({ plan: "team", seats: 5 }), now);

describe("staffGateMessage", () => {
  it("Free at 1 active staff → the one-resource copy", () => {
    expect(staffGateMessage(1, free)).toBe(planLimitResourceError(1));
  });
  it("Team (5 seats) at 4 active staff → null", () => {
    expect(staffGateMessage(4, team5)).toBeNull();
  });
  it("Team (5 seats) at 5 active staff → names the cap", () => {
    const message = staffGateMessage(5, team5);
    expect(message).toBe(planLimitResourceError(5));
    expect(message).toContain("allows 5 bookable resources");
  });
});

describe("planLimitResourceError", () => {
  it("one resource explains the budget; more than one names the cap", () => {
    expect(planLimitResourceError(1)).toBe(
      "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more.",
    );
    expect(planLimitResourceError(5)).toBe(
      "Your plan allows 5 bookable resources — people and units together. Upgrade in Billing to add more.",
    );
  });
});

describe("serviceGateMessage", () => {
  it("Free at 3 services → message", () => {
    expect(serviceGateMessage(3, free)).toBe(PLAN_LIMIT_SERVICES_ERROR);
  });
  it("Pro at 50 services → null", () => {
    expect(serviceGateMessage(50, pro)).toBeNull();
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

describe("evaluateStaffGate", () => {
  it("Free org at 1 active staff (limit) → refusal", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      staff: { count: 1, error: null },
    });
    await expect(evaluateStaffGate("org-1", client)).resolves.toBe(planLimitResourceError(1));
  });
  it("Team org (5 seats) at 4 active staff → allowed (null)", async () => {
    const client = stubClient({
      org_subscriptions: { data: orgSubRow({ plan: "team", seats: 5 }), error: null },
      staff: { count: 4, error: null },
    });
    await expect(evaluateStaffGate("org-1", client)).resolves.toBeNull();
  });
  it("a failed count lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      staff: { count: null, error: new Error("connection reset") },
    });
    await expect(evaluateStaffGate("org-1", client)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
  it("a failed entitlements lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: new Error("connection reset") },
      staff: { count: 0, error: null },
    });
    await expect(evaluateStaffGate("org-1", client)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
});

describe("evaluateServiceGate", () => {
  it("Free org at 3 services (limit) → refusal", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      services: { count: 3, error: null },
    });
    await expect(evaluateServiceGate("org-1", client)).resolves.toBe(PLAN_LIMIT_SERVICES_ERROR);
  });
  it("Pro org at 50 services → allowed (null)", async () => {
    const client = stubClient({
      org_subscriptions: { data: orgSubRow({ plan: "pro" }), error: null },
      services: { count: 50, error: null },
    });
    await expect(evaluateServiceGate("org-1", client)).resolves.toBeNull();
  });
  it("a failed count lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      services: { count: null, error: new Error("connection reset") },
    });
    await expect(evaluateServiceGate("org-1", client)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
});
