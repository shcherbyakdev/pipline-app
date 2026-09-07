// stripe.ts imports "@/env", which parses process.env eagerly at module
// load. Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before any import runs
// (lib/billing/stripe.test.ts precedent). A static `import ... from
// "./stripe"` would be hoisted above these assignments (ES module
// semantics), so import it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import Stripe from "stripe";
const { normalizeConnectEvent } = await import("./stripe");

const session = (over: Record<string, unknown>) =>
  ({ id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 5000, payment_intent: "pi_1", ...over }) as unknown as Stripe.Checkout.Session;
const event = (type: string, obj: unknown, account = "acct_1") =>
  ({ id: "evt_1", type, account, data: { object: obj } }) as unknown as Stripe.Event;

describe("normalizeConnectEvent", () => {
  it("completed + paid", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({})))).toEqual({
      type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_1", eventId: "evt_1",
    });
  });
  it("completed + unpaid (P24 in flight)", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })))?.paid).toBe(false);
  });
  it("async succeeded / failed / expired map; others are null", () => {
    expect(normalizeConnectEvent(event("checkout.session.async_payment_succeeded", session({})))?.type).toBe("checkout.async_succeeded");
    expect(normalizeConnectEvent(event("checkout.session.async_payment_failed", session({})))?.type).toBe("checkout.async_failed");
    expect(normalizeConnectEvent(event("checkout.session.expired", session({})))?.type).toBe("checkout.expired");
    expect(normalizeConnectEvent(event("payment_intent.succeeded", {}))).toBeNull();
  });
  it("an expanded payment_intent object still yields its id", () => {
    expect(normalizeConnectEvent(event("checkout.session.completed", session({ payment_intent: { id: "pi_obj" } })))?.paymentIntentId).toBe("pi_obj");
  });
});
