// stripe.ts imports "@/env", which parses process.env eagerly at module
// load. Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before any import runs
// (fake.test.ts / drain-isolation.test.ts precedent). A static
// `import ... from "./stripe"` would be hoisted above these assignments (ES
// module semantics), so import it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Stripe from "stripe";
const { mapStripeStatus, planFromPriceId, normalizeStripeEvent, withOptionalDiscount } = await import("./stripe");
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
    expect(e.orgId).toBe("org-uuid");
  });
  it("unmapped price falls back to the price's plan/interval metadata", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", {
      items: { data: [{ price: { id: "price_rotated", metadata: { plan: "pro", interval: "year" } }, quantity: 1, current_period_end: 1_790_000_000 }] },
    }) as never, priceMap)!;
    expect(e.subscription).toMatchObject({ plan: "pro", interval: "year", seats: 1 });
  });
  it("metadata that isn't a plan/interval pair we understand stays unmapped", () => {
    for (const metadata of [{ plan: "gold", interval: "month" }, { plan: "pro", interval: "weekly" }, { plan: "pro" }]) {
      const e = normalizeStripeEvent(subEvent("customer.subscription.updated", {
        items: { data: [{ price: { id: "price_rotated", metadata }, quantity: 1 }] },
      }) as never, priceMap)!;
      expect(e.subscription, JSON.stringify(metadata)).toBeNull();
    }
  });
  it("deleted with an unmappable price still expires: type + org, no subscription", () => {
    // apply_billing_event (0043) expires the cached row from these two alone,
    // so an unknown price can't leave the org paid forever in our cache.
    const e = normalizeStripeEvent(subEvent("customer.subscription.deleted", {
      status: "canceled", items: { data: [{ price: { id: "zzz" }, quantity: 1 }] },
    }) as never, priceMap)!;
    expect(e.type).toBe("subscription_expired");
    expect(e.orgId).toBe("org-uuid");
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

describe("withOptionalDiscount", () => {
  const params = { mode: "subscription" } as Stripe.Checkout.SessionCreateParams;
  const seen = () => {
    const calls: Stripe.Checkout.SessionCreateParams[] = [];
    return { calls, record: (p: Stripe.Checkout.SessionCreateParams) => { calls.push(p); } };
  };

  it("sends the discount on the first attempt and never retries when it works", async () => {
    const { calls, record } = seen();
    const out = await withOptionalDiscount(async (p) => { record(p); return "session"; }, params, "promo_1");
    expect(out).toBe("session");
    expect(calls).toHaveLength(1);
    expect(calls[0].discounts).toEqual([{ promotion_code: "promo_1" }]);
  });

  it("retries once WITHOUT the discount when the discounted attempt fails", async () => {
    // The Founder code is capped (max_redemptions): once it runs out Stripe
    // rejects the whole session, and "the promo ended" must not become "you
    // cannot buy Pro".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, record } = seen();
    const out = await withOptionalDiscount(async (p) => {
      record(p);
      if (p.discounts) throw new Error("This promotion code cannot be redeemed.");
      return "session";
    }, params, "promo_exhausted");
    expect(out).toBe("session");
    expect(calls).toHaveLength(2);
    expect(calls[1].discounts).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[billing] founder code rejected, retrying without it:",
      "This promotion code cannot be redeemed.",
    );
    warn.mockRestore();
  });

  it("keeps the FIRST error when the retry fails too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    await expect(
      withOptionalDiscount(async () => { n += 1; throw new Error(n === 1 ? "first" : "second"); }, params, "promo_1"),
    ).rejects.toThrow("first");
    expect(n).toBe(2);
    warn.mockRestore();
  });

  it("without a discount there is one attempt and the error goes straight through", async () => {
    const { calls, record } = seen();
    await withOptionalDiscount(async (p) => { record(p); return "session"; }, params, undefined);
    expect(calls).toEqual([params]);
    await expect(
      withOptionalDiscount(async () => { throw new Error("card_declined"); }, params, undefined),
    ).rejects.toThrow("card_declined");
  });
});
