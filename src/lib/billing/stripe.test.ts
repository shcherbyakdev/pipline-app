// stripe.ts imports "@/env", which parses process.env eagerly at module
// load. Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before any import runs
// (fake.test.ts / drain-isolation.test.ts precedent). A static
// `import ... from "./stripe"` would be hoisted above these assignments (ES
// module semantics), so import it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const { mapStripeStatus, planFromPriceId, normalizeStripeEvent } = await import("./stripe");
import type { PriceMap } from "./stripe";

const priceMap: PriceMap = {
  price_pro_m: { plan: "pro", interval: "month" }, price_pro_y: { plan: "pro", interval: "year" },
  price_team_m: { plan: "team", interval: "month" }, price_team_y: { plan: "team", interval: "year" },
};

// Minimal Stripe event shape — only the fields the normaliser reads.
const subEvent = (type: string, sub: Record<string, unknown>) => ({
  id: "evt_1", type, created: 1_787_000_000,
  data: { object: { id: "sub_1", object: "subscription", customer: "cus_1", status: "active",
    cancel_at_period_end: false, metadata: { org_id: "org-uuid" },
    items: { data: [{ price: { id: "price_team_m" }, quantity: 5, current_period_end: 1_790_000_000 }] }, ...sub } },
});

describe("mapStripeStatus", () => {
  it("maps Stripe statuses onto ours", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) expect(mapStripeStatus(s)).toBe("expired");
  });
});

describe("planFromPriceId", () => {
  it("resolves both directions and unknown → null", () => {
    expect(planFromPriceId("price_pro_y", priceMap)).toEqual({ plan: "pro", interval: "year" });
    expect(planFromPriceId("nope", priceMap)).toBeNull();
  });
});

describe("normalizeStripeEvent", () => {
  it("customer.subscription.updated → subscription_updated with org from metadata", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", {}) as never, priceMap)!;
    expect(e.type).toBe("subscription_updated");
    expect(e.orgId).toBe("org-uuid");
    expect(e.providerEventId).toBe("evt_1");
    expect(e.occurredAt).toBe(new Date(1_787_000_000 * 1000).toISOString());
    expect(e.subscription).toMatchObject({ plan: "team", interval: "month", seats: 5, status: "active",
      providerCustomerId: "cus_1", providerSubscriptionId: "sub_1", currentPeriodEnd: new Date(1_790_000_000 * 1000).toISOString() });
  });
  it("customer.subscription.deleted → subscription_expired regardless of status", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.deleted", { status: "canceled" }) as never, priceMap)!;
    expect(e.type).toBe("subscription_expired");
    expect(e.subscription?.status).toBe("expired");
  });
  it("cancel_at_period_end stays active with the flag", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { cancel_at_period_end: true }) as never, priceMap)!;
    expect(e.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });
  it("unknown price → orgId kept, subscription null (recorded, not applied)", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { items: { data: [{ price: { id: "zzz" }, quantity: 1 }] } }) as never, priceMap)!;
    expect(e.subscription).toBeNull();
  });
  it("ignores unrelated events", () => {
    expect(normalizeStripeEvent({ id: "evt_2", type: "checkout.session.completed", created: 1, data: { object: {} } } as never, priceMap)).toBeNull();
  });
  it("ignores invoice.payment_failed and invoice.paid (subscription.updated carries status)", () => {
    expect(normalizeStripeEvent({ id: "evt_3", type: "invoice.payment_failed", created: 1, data: { object: {} } } as never, priceMap)).toBeNull();
    expect(normalizeStripeEvent({ id: "evt_4", type: "invoice.paid", created: 1, data: { object: {} } } as never, priceMap)).toBeNull();
  });
  it("normalises a file-shaped customer.subscription.updated fixture", () => {
    const raw = readFileSync(join(process.cwd(), "src/lib/billing/__fixtures__/stripe-subscription-updated.json"), "utf8");
    const fixture = JSON.parse(raw);
    const e = normalizeStripeEvent(fixture as never, priceMap)!;
    expect(e.type).toBe("subscription_updated");
    expect(e.orgId).toBe("org-uuid");
    expect(e.subscription).toMatchObject({ plan: "team", interval: "month", seats: 5, status: "active" });
  });
});
