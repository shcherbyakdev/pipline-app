// provider.ts imports "@/env" (via stripe.ts / fake.ts too), which parses
// process.env eagerly at module load. Plain `npm run test` CI does not set
// the Supabase env vars (only the integration job does), so stub them here
// before any import runs (lib/billing/fake.test.ts precedent). A static
// `import ... from "./provider"` would be hoisted above these assignments
// (ES module semantics), so import it dynamically instead.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
const { checkoutExpiresAt } = await import("./provider");

describe("checkoutExpiresAt", () => {
  const now = new Date("2027-05-10T10:00:00Z");
  it("uses the hold when it is inside Stripe's window", () => {
    expect(checkoutExpiresAt(new Date("2027-05-10T11:00:00Z"), now)).toBe(Math.floor(new Date("2027-05-10T11:00:00Z").getTime() / 1000));
  });
  it("floors at now + 30 min 30 s", () => {
    expect(checkoutExpiresAt(new Date("2027-05-10T10:05:00Z"), now)).toBe(Math.floor(now.getTime() / 1000) + 30 * 60 + 30);
  });
  it("caps at now + 24 h", () => {
    expect(checkoutExpiresAt(new Date("2027-05-12T10:00:00Z"), now)).toBe(Math.floor(now.getTime() / 1000) + 24 * 3600);
  });
});
