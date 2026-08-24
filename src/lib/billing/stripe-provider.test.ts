// stripeProvider() against a stubbed Stripe SDK: what the adapter actually
// SENDS Stripe (success_url vs cancel_url, the discount, the customer
// either/or) and what comes back when the Founder code is refused. The pure
// mappers are covered in stripe.test.ts; this file is the I/O seam.
//
// Env is parsed eagerly at module load (stripe.test.ts precedent), and the
// provider refuses to construct without a secret key and throws on a missing
// price id, so both are stubbed before the dynamic import.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.STRIPE_SECRET_KEY ??= "sk_test_stub";
process.env.STRIPE_PRICE_PRO_MONTH ??= "price_pro_m";
process.env.STRIPE_PRICE_PRO_YEAR ??= "price_pro_y";
process.env.STRIPE_PRICE_TEAM_MONTH ??= "price_team_m";
process.env.STRIPE_PRICE_TEAM_YEAR ??= "price_team_y";

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

const sessionsCreate = vi.fn<(p: Stripe.Checkout.SessionCreateParams) => Promise<{ url: string | null }>>();

// The SDK's default export is the client class; `Stripe.errors.*` are static
// on it and the adapter's isDiscountRejection needs the REAL classes, so the
// stub keeps them and replaces only the client surface the adapter touches.
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  class StripeStub {
    static errors = actual.default.errors;
    checkout = { sessions: { create: sessionsCreate } };
    billingPortal = { sessions: { create: vi.fn() } };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: StripeStub };
});

const StripeSdk = (await import("stripe")).default;
const { stripeProvider } = await import("./stripe");

const input = {
  orgId: "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", plan: "pro" as const, interval: "month" as const, email: "a@b.co",
  returnUrl: "https://app.test/billing?checkout=success&plan=pro",
  cancelUrl: "https://app.test/billing?checkout=cancelled",
};

const promoRejected = () =>
  new StripeSdk.errors.StripeInvalidRequestError({
    type: "invalid_request_error", message: "This promotion code cannot be redeemed.", param: "discounts[0][promotion_code]",
  });

beforeEach(() => {
  sessionsCreate.mockReset();
  sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test" });
});

describe("stripeProvider().createCheckout", () => {
  it("sends success_url and cancel_url as two different URLs", async () => {
    // cancel_url used to equal success_url: abandoning Checkout landed on
    // `checkout=success` and /billing polled 30s for a purchase that never
    // happened.
    const out = await stripeProvider().createCheckout(input);
    expect(out).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test", founderFallback: false });
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const params = sessionsCreate.mock.calls[0][0];
    expect(params.success_url).toBe(input.returnUrl);
    expect(params.cancel_url).toBe(input.cancelUrl);
    expect(params.cancel_url).not.toBe(params.success_url);
    expect(params.line_items).toEqual([{ price: "price_pro_m", quantity: 1 }]);
    expect(params.metadata).toEqual({ org_id: input.orgId });
    expect(params.subscription_data).toEqual({ metadata: { org_id: input.orgId } });
    expect(params.discounts).toBeUndefined();
  });

  it("customer and customer_email are an either/or", async () => {
    await stripeProvider().createCheckout(input);
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ customer_email: "a@b.co" });
    expect(sessionsCreate.mock.calls[0][0].customer).toBeUndefined();
    await stripeProvider().createCheckout({ ...input, providerCustomerId: "cus_1" });
    expect(sessionsCreate.mock.calls[1][0]).toMatchObject({ customer: "cus_1" });
    expect(sessionsCreate.mock.calls[1][0].customer_email).toBeUndefined();
  });

  it("a refused Founder code → the list-price session, flagged founderFallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sessionsCreate.mockImplementation(async (p) => {
      if (p.discounts) throw promoRejected();
      return { url: "https://checkout.stripe.com/c/pay/cs_list" };
    });
    const out = await stripeProvider().createCheckout({ ...input, discountCode: "promo_founder" });
    expect(out).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_list", founderFallback: true });
    expect(sessionsCreate).toHaveBeenCalledTimes(2);
    expect(sessionsCreate.mock.calls[0][0].discounts).toEqual([{ promotion_code: "promo_founder" }]);
    expect(sessionsCreate.mock.calls[1][0].discounts).toBeUndefined();
    warn.mockRestore();
  });

  it("any other Stripe error surfaces as-is — one attempt, no list-price retry", async () => {
    const auth = new StripeSdk.errors.StripeAuthenticationError({ type: "invalid_request_error", message: "Invalid API Key provided" });
    sessionsCreate.mockRejectedValue(auth);
    await expect(stripeProvider().createCheckout({ ...input, discountCode: "promo_founder" })).rejects.toBe(auth);
    expect(sessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("a session without a url is an error, not a redirect to 'undefined'", async () => {
    sessionsCreate.mockResolvedValue({ url: null });
    await expect(stripeProvider().createCheckout(input)).rejects.toThrow("stripe: no checkout url");
  });
});
