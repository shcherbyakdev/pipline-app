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
const { signFakeWebhook, parseFakeWebhook } = await import("./fake");

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
