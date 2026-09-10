// stripe.ts imports "@/env", which parses process.env eagerly at module
// load. Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before any import runs
// (fake.test.ts / drain-isolation.test.ts precedent). A static
// `import ... from "./stripe"` would be hoisted above these assignments (ES
// module semantics), so import it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
// checkoutParams resolves a price id through env (priceIdFor).
process.env.STRIPE_PRICE_PRO_MONTH ??= "price_pro_month";
process.env.STRIPE_PRICE_PRO_YEAR ??= "price_pro_year";
process.env.STRIPE_PRICE_TEAM_MONTH ??= "price_team_month";
process.env.STRIPE_PRICE_TEAM_YEAR ??= "price_team_year";

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
const { mapStripeStatus, planFromPriceId, normalizeStripeEvent, orgIdFromMetadata, isDiscountRejection, withOptionalDiscount, checkoutParams } =
  await import("./stripe");
import type { PriceMap } from "./stripe";
import { TEAM_INCLUDED_RESOURCES } from "./plans";

// A real UUID: apply_billing_event takes org_id as `uuid`, and the adapter
// now drops anything else (orgIdFromMetadata) — so the fixtures must carry
// the shape the RPC accepts, not a placeholder.
const ORG = "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

const priceMap: PriceMap = {
  price_pro_m: { plan: "pro", interval: "month" }, price_pro_y: { plan: "pro", interval: "year" },
  price_team_m: { plan: "team", interval: "month" }, price_team_y: { plan: "team", interval: "year" },
};

// Minimal Stripe event shape — only the fields the normaliser reads.
const subEvent = (type: string, sub: Record<string, unknown>) => ({
  id: "evt_1", type, created: 1_787_000_000,
  data: { object: { id: "sub_1", object: "subscription", customer: "cus_1", status: "active",
    cancel_at_period_end: false, metadata: { org_id: ORG },
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
    expect(e.orgId).toBe(ORG);
    expect(e.providerEventId).toBe("evt_1");
    expect(e.occurredAt).toBe(new Date(1_787_000_000 * 1000).toISOString());
    expect(e.subscription).toMatchObject({ plan: "team", interval: "month", seats: TEAM_INCLUDED_RESOURCES, status: "active",
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
  // What the Customer Portal actually sends (test-mode walk 2026-09-10): the
  // cancellation is a DATE, and the old flag stays false. Read only the flag
  // and someone who has just cancelled is told their plan renews.
  it("a dated cancel_at counts as cancelled even with the flag false", () => {
    const e = normalizeStripeEvent(
      subEvent("customer.subscription.updated", { cancel_at_period_end: false, cancel_at: 1_820_000_000 }) as never,
      priceMap,
    )!;
    expect(e.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });

  // A cancellation can be scheduled for any date, not only the renewal — and
  // the copy that reads this says "ends on".
  it("the end date is the cancellation date, not the renewal date", () => {
    const midPeriod = 1_788_000_000; // before the fixture's period end
    const e = normalizeStripeEvent(
      subEvent("customer.subscription.updated", { cancel_at: midPeriod }) as never,
      priceMap,
    )!;
    expect(e.subscription?.currentPeriodEnd).toBe(new Date(midPeriod * 1000).toISOString());
  });
  it("a LIVE subscription on an unknown price throws, so the provider retries instead of considering it delivered", () => {
    // Returning `subscription: null` here used to record the event with
    // error='no subscription payload' and answer 200 — Stripe never retried,
    // and a dashboard resend hit the billing_events unique index
    // ('replayed'). The org paid and had no plan, forever. A throw makes the
    // route answer non-2xx; Stripe keeps retrying, and the retries succeed
    // once the price is mapped (env) or given plan/interval metadata.
    for (const type of ["customer.subscription.created", "customer.subscription.updated"]) {
      expect(() =>
        normalizeStripeEvent(subEvent(type, { items: { data: [{ price: { id: "zzz" }, quantity: 1 }] } }) as never, priceMap),
      ).toThrow("unmapped price zzz");
    }
  });
  it("unmapped price falls back to the price's plan/interval metadata", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", {
      items: { data: [{ price: { id: "price_rotated", metadata: { plan: "pro", interval: "year" } }, quantity: 1, current_period_end: 1_790_000_000 }] },
    }) as never, priceMap)!;
    expect(e.subscription).toMatchObject({ plan: "pro", interval: "year", seats: 1 });
  });
  it("metadata that isn't a plan/interval pair we understand is as unmapped as an unknown id", () => {
    for (const metadata of [{ plan: "gold", interval: "month" }, { plan: "pro", interval: "weekly" }, { plan: "pro" }]) {
      expect(() => normalizeStripeEvent(subEvent("customer.subscription.updated", {
        items: { data: [{ price: { id: "price_rotated", metadata }, quantity: 1 }] },
      }) as never, priceMap), JSON.stringify(metadata)).toThrow("unmapped price price_rotated");
    }
  });
  it("deleted with an unmappable price still expires: type + org, no subscription", () => {
    // apply_billing_event (0043) expires the cached row from these two alone,
    // so an unknown price can't leave the org paid forever in our cache.
    const e = normalizeStripeEvent(subEvent("customer.subscription.deleted", {
      status: "canceled", items: { data: [{ price: { id: "zzz" }, quantity: 1 }] },
    }) as never, priceMap)!;
    expect(e.type).toBe("subscription_expired");
    expect(e.orgId).toBe(ORG);
    expect(e.subscription).toBeNull();
  });
  it("customer.subscription.created → subscription_created when the subscription is live", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.created", {}) as never, priceMap)!;
    expect(e.type).toBe("subscription_created");
    expect(e.subscription?.status).toBe("active");
  });
  it("ignores a created(incomplete | incomplete_expired): the same-second updated(active) is the source of truth", () => {
    // mapStripeStatus reads `incomplete` as expired, and the RPC breaks
    // same-second ties by arrival — a created(incomplete) delivered AFTER
    // the updated(active) would overwrite the active row with an expired
    // one. Nothing in the created says anything the updated doesn't.
    for (const status of ["incomplete", "incomplete_expired"]) {
      expect(normalizeStripeEvent(subEvent("customer.subscription.created", { status }) as never, priceMap), status).toBeNull();
    }
    // …and on an unmapped price too: ignored comes before refused.
    expect(normalizeStripeEvent(subEvent("customer.subscription.created", {
      status: "incomplete", items: { data: [{ price: { id: "zzz" }, quantity: 1 }] },
    }) as never, priceMap)).toBeNull();
  });
  it("an updated(incomplete_expired) still projects: that subscription is dead", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { status: "incomplete_expired" }) as never, priceMap)!;
    expect(e.type).toBe("subscription_updated");
    expect(e.subscription?.status).toBe("expired");
  });
  it("metadata.org_id that is not a UUID → orgId null (recorded as 'unresolvable org', never a 22P02 in the RPC)", () => {
    for (const org_id of ["org-uuid", "", "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b; drop table orgs", "0F2A6B1E3C4D4E5F8A9B0C1D2E3F4A5B"]) {
      const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { metadata: { org_id } }) as never, priceMap)!;
      expect(e.orgId, JSON.stringify(org_id)).toBeNull();
    }
    expect(normalizeStripeEvent(subEvent("customer.subscription.updated", { metadata: {} }) as never, priceMap)!.orgId).toBeNull();
    // Upper-case hex is still a UUID to Postgres.
    const upper = ORG.toUpperCase();
    expect(normalizeStripeEvent(subEvent("customer.subscription.updated", { metadata: { org_id: upper } }) as never, priceMap)!.orgId).toBe(upper);
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
    expect(e.orgId).toBe(ORG);
    expect(e.subscription).toMatchObject({ plan: "team", interval: "month", seats: TEAM_INCLUDED_RESOURCES, status: "active" });
  });
});

describe("checkoutParams", () => {
  const base = {
    orgId: ORG, plan: "pro", interval: "month", email: "owner@example.com",
    returnUrl: "https://booklo.co/billing?checkout=success", cancelUrl: "https://booklo.co/billing",
  } as const;

  // Stripe refuses a session carrying both, EVEN with the flag false — and
  // the flag was false, so every Founder checkout was rejected, retried at
  // list price, and told the member the promo had ended (test-mode walk
  // 2026-09-10). Omitting it is the same as false.
  it("never carries allow_promotion_codes, which Stripe refuses next to a discount", () => {
    expect(checkoutParams(base)).not.toHaveProperty("allow_promotion_codes");
  });

  it("hands over an existing customer on a resubscribe, never both customer and email", () => {
    const resubscribe = checkoutParams({ ...base, providerCustomerId: "cus_1" });
    expect(resubscribe).toMatchObject({ customer: "cus_1" });
    expect(resubscribe).not.toHaveProperty("customer_email");
    expect(checkoutParams(base)).toMatchObject({ customer_email: "owner@example.com" });
  });

  it("carries the org on both the session and the subscription, and sells through Managed Payments", () => {
    expect(checkoutParams(base)).toMatchObject({
      mode: "subscription",
      metadata: { org_id: ORG },
      subscription_data: { metadata: { org_id: ORG } },
      managed_payments: { enabled: true },
    });
  });
});

describe("orgIdFromMetadata", () => {
  it("accepts only a UUID", () => {
    expect(orgIdFromMetadata({ org_id: ORG })).toBe(ORG);
    expect(orgIdFromMetadata({ org_id: "nope" })).toBeNull();
    expect(orgIdFromMetadata({})).toBeNull();
    expect(orgIdFromMetadata(undefined)).toBeNull();
  });
});

/** Stripe's SDK error classes, built the way the SDK builds them from a
    response body — so `instanceof` and `.param` behave as in production. */
const stripeError = (Cls: typeof Stripe.errors.StripeError, message: string, param?: string) =>
  new Cls({ type: "invalid_request_error", message, param });

describe("isDiscountRejection", () => {
  it("is true for an invalid_request_error about the discount — by param or by message", () => {
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeInvalidRequestError, "No such promotion code", "discounts[0][promotion_code]"))).toBe(true);
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeInvalidRequestError, "This promotion code cannot be redeemed because the coupon is inactive."))).toBe(true);
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeInvalidRequestError, "The coupon does not apply to this price.", "discounts"))).toBe(true);
  });
  it("is false for every other error, Stripe's or not", () => {
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeInvalidRequestError, "No such price: 'price_x'", "line_items[0][price]"))).toBe(false);
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeAuthenticationError, "Invalid API Key provided"))).toBe(false);
    expect(isDiscountRejection(stripeError(Stripe.errors.StripeConnectionError, "promotion code service unreachable"))).toBe(false);
    expect(isDiscountRejection(new Error("This promotion code cannot be redeemed."))).toBe(false);
    expect(isDiscountRejection("promotion")).toBe(false);
  });
});

describe("withOptionalDiscount", () => {
  const params = { mode: "subscription" } as Stripe.Checkout.SessionCreateParams;
  const seen = () => {
    const calls: Stripe.Checkout.SessionCreateParams[] = [];
    return { calls, record: (p: Stripe.Checkout.SessionCreateParams) => { calls.push(p); } };
  };
  const promoRejected = () =>
    stripeError(Stripe.errors.StripeInvalidRequestError, "This promotion code cannot be redeemed.", "discounts[0][promotion_code]");

  it("sends the discount on the first attempt and never retries when it works", async () => {
    const { calls, record } = seen();
    const out = await withOptionalDiscount(async (p) => { record(p); return "session"; }, params, "promo_1");
    expect(out).toEqual({ session: "session", founderFallback: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].discounts).toEqual([{ promotion_code: "promo_1" }]);
  });

  it("retries once WITHOUT the discount when Stripe rejects the discount, and says so", async () => {
    // The Founder code is capped (max_redemptions): once it runs out Stripe
    // rejects the whole session, and "the promo ended" must not become "you
    // cannot buy Pro". `founderFallback` is how the caller learns the member
    // is not getting the price they were shown.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, record } = seen();
    const out = await withOptionalDiscount(async (p) => {
      record(p);
      if (p.discounts) throw promoRejected();
      return "session";
    }, params, "promo_exhausted");
    expect(out).toEqual({ session: "session", founderFallback: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].discounts).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[billing] founder code rejected, retrying without it:",
      "This promotion code cannot be redeemed.",
    );
    warn.mockRestore();
  });

  it("rethrows any OTHER error without retrying: the discount was not the problem", async () => {
    // A bad key, a wrong price id, a network failure: retrying at list price
    // would only sell into whatever is broken — and hide it behind
    // "founder ended".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const error of [
      stripeError(Stripe.errors.StripeAuthenticationError, "Invalid API Key provided"),
      stripeError(Stripe.errors.StripeInvalidRequestError, "No such price: 'price_x'", "line_items[0][price]"),
      new Error("ECONNRESET"),
    ]) {
      const { calls, record } = seen();
      await expect(
        withOptionalDiscount(async (p) => { record(p); throw error; }, params, "promo_1"),
      ).rejects.toBe(error);
      expect(calls, error.message).toHaveLength(1);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the FIRST error when the retry fails too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    await expect(
      withOptionalDiscount(async () => {
        n += 1;
        throw n === 1 ? promoRejected() : new Error("second");
      }, params, "promo_1"),
    ).rejects.toThrow("This promotion code cannot be redeemed.");
    expect(n).toBe(2);
    warn.mockRestore();
  });

  it("without a discount there is one attempt and the error goes straight through", async () => {
    const { calls, record } = seen();
    const out = await withOptionalDiscount(async (p) => { record(p); return "session"; }, params, undefined);
    expect(out).toEqual({ session: "session", founderFallback: false });
    expect(calls).toEqual([params]);
    await expect(
      withOptionalDiscount(async () => { throw new Error("card_declined"); }, params, undefined),
    ).rejects.toThrow("card_declined");
  });
});
