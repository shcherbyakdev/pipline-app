// gates.ts imports queries.ts, which imports "@/env" (eager parse) — stub the
// vars before any import runs, same as fake.test.ts does for env-eager
// billing modules. A static `import ... from "./gates"` would be hoisted
// above these assignments (ES module semantics), so import it dynamically.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import { entitlementsFor, type OrgSubscriptionRow } from "./entitlements";
import { PLAN_LIMIT_SERVICES_ERROR, PLAN_LIMIT_STAFF_ERROR } from "@/features/scheduling/schema";
const { staffGateMessage, serviceGateMessage } = await import("./gates");

const now = new Date("2026-08-18T12:00:00Z");
const row = (o: Partial<OrgSubscriptionRow>): OrgSubscriptionRow => ({
  plan: "pro", status: "active", interval: "month", seats: 1,
  currentPeriodEnd: "2026-09-18T12:00:00Z", cancelAtPeriodEnd: false, ...o,
});

const free = entitlementsFor(null, now);
const pro = entitlementsFor(row({ plan: "pro" }), now);
const team5 = entitlementsFor(row({ plan: "team", seats: 5 }), now);

describe("staffGateMessage", () => {
  it("Free at 1 active staff → message", () => {
    expect(staffGateMessage(1, free)).toBe(PLAN_LIMIT_STAFF_ERROR);
  });
  it("Team (5 seats) at 4 active staff → null", () => {
    expect(staffGateMessage(4, team5)).toBeNull();
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
