// Ruling 2 (task-5): fake.ts imports env from "@/env", which parses
// process.env eagerly at module load. Plain `npm run test` CI does not set
// the Supabase env vars (only the integration job does), so stub them here
// before any import runs (drain-isolation.test.ts precedent). A static
// `import ... from "./fake"` would be hoisted above these assignments (ES
// module semantics), so import it dynamically instead, same as
// drain-isolation.test.ts does for "./drain".
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
const { signFakeWebhook, parseFakeWebhook, fakeProvider } = await import("./fake");

const secret = "0123456789abcdef0123456789abcdef";
const body = JSON.stringify([{ providerEventId: "e1", occurredAt: "2026-08-18T00:00:00Z", orgId: "o", type: "subscription_created", subscription: null }]);

describe("fake webhook", () => {
  it("accepts a correctly signed body", () => {
    const events = parseFakeWebhook(body, new Headers({ "x-signature": signFakeWebhook(body, secret) }), secret);
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("fake");
    expect(events[0].providerEventId).toBe("e1");
  });
  it("rejects a bad or missing signature", () => {
    expect(() => parseFakeWebhook(body, new Headers({ "x-signature": "deadbeef" }), secret)).toThrow();
    expect(() => parseFakeWebhook(body, new Headers(), secret)).toThrow();
  });
});

describe("fakeProvider URLs", () => {
  const input = {
    orgId: "org-1", plan: "pro" as const, interval: "month" as const, email: "a@b.com",
    returnUrl: "http://x/billing?checkout=success&plan=pro", cancelUrl: "http://x/billing?checkout=cancelled",
  };

  it("createCheckout points at the dev checkout page with org/plan/interval/return/cancel", async () => {
    const out = await fakeProvider().createCheckout(input);
    // The emulator has no promotion codes to run out of.
    expect(out.founderFallback).toBe(false);
    const parsed = new URL(out.url);
    expect(parsed.pathname).toBe("/dev/billing/checkout");
    expect(parsed.searchParams.get("org")).toBe("org-1");
    expect(parsed.searchParams.get("plan")).toBe("pro");
    expect(parsed.searchParams.get("interval")).toBe("month");
    expect(parsed.searchParams.get("return")).toBe(input.returnUrl);
    // Carried separately, the way a Stripe session carries cancel_url: the
    // page's Cancel link must not land on the success markers.
    expect(parsed.searchParams.get("cancel")).toBe(input.cancelUrl);
    expect(parsed.searchParams.has("customer")).toBe(false);
  });

  it("createCheckout carries the existing customer id when resubscribing", async () => {
    const { url } = await fakeProvider().createCheckout({
      ...input, plan: "team", interval: "year", providerCustomerId: "cus_fake_org-1",
    });
    expect(new URL(url).searchParams.get("customer")).toBe("cus_fake_org-1");
  });

  it("createPortalUrl points at the dev portal page carrying only the return url", async () => {
    const url = await fakeProvider().createPortalUrl("cus_fake_org-1", "http://x/billing");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/dev/billing/portal");
    expect(parsed.searchParams.get("return")).toBe("http://x/billing");
  });
});
