// fake.ts imports "@/env", which parses process.env eagerly at module load.
// Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before any import runs
// (lib/billing/fake.test.ts precedent). A static `import ... from "./fake"`
// would be hoisted above these assignments (ES module semantics), so import
// it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
const { parseFakePaymentsWebhook, signFakePaymentsWebhook } = await import("./fake");

describe("fake payments webhook", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const body = JSON.stringify([{ type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_fake" }]);
  it("accepts a good signature and normalises", () => {
    const events = parseFakePaymentsWebhook(body, new Headers({ "x-signature": signFakePaymentsWebhook(body, secret) }), secret);
    expect(events).toEqual([{ type: "checkout.completed", sessionId: "cs_1", paymentIntentId: "pi_1", amountCents: 5000, paid: true, accountId: "acct_fake", eventId: expect.any(String) }]);
  });
  it("rejects a bad signature", () => {
    expect(() => parseFakePaymentsWebhook(body, new Headers({ "x-signature": "nope" }), secret)).toThrow(/signature/);
  });
});
