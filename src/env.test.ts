import { describe, expect, it, vi } from "vitest";
import { envSchema } from "./env-schema";

// The three values CI's build job actually supplies (.github/workflows/ci.yml:52-58).
const CI_BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54351",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-placeholder-anon-key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const PROD_ENV = {
  APP_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_APP_URL: "https://booklo.co",
  DATABASE_URL: "postgresql://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "Booklo <noreply@booklo.co>",
  SCHEDULING_DRAIN_SECRET: "0123456789abcdef0123",
  INTERNAL_EMAILS: "owner@example.com",
};

describe("envSchema", () => {
  // Regression guard: if the gate were changed from APP_ENV to NODE_ENV, this
  // would fail. We stub the runner's own NODE_ENV to "production" to prove the
  // refinement does not consult it — only APP_ENV in the input object matters.
  // If it did consult process.env.NODE_ENV, the CI build (which sets neither
  // APP_ENV nor NODE_ENV to production) would be unaffected, but a NODE_ENV-based
  // gate would be wrong, because NODE_ENV is "production" inside every `next build`,
  // including CI's, which supplies placeholder values.
  it("still accepts CI's placeholder env even if the runner's own NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(envSchema.safeParse(CI_BUILD_ENV).success).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts a complete production env", () => {
    expect(envSchema.safeParse(PROD_ENV).success).toBe(true);
  });

  it("rejects a localhost app url in production", () => {
    const result = envSchema.safeParse({ ...PROD_ENV, NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("NEXT_PUBLIC_APP_URL");
    }
  });

  it.each([
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "SCHEDULING_DRAIN_SECRET",
    "INTERNAL_EMAILS",
  ])("rejects production without %s", (key) => {
    const incomplete: Record<string, unknown> = { ...PROD_ENV };
    delete incomplete[key];
    const result = envSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(key);
    }
  });

  // The fake billing provider's webhook grants any org a paid plan to anyone
  // who can sign the body with BILLING_FAKE_SECRET. That secret is dev-only and
  // must never survive into a production env block.
  it("rejects production when BILLING_FAKE_SECRET is set", () => {
    const result = envSchema.safeParse({ ...PROD_ENV, BILLING_FAKE_SECRET: "0123456789abcdef0123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("BILLING_FAKE_SECRET");
    }
  });

  // A dormant-billing production deploy (provider defaults to "fake", no fake
  // secret, webhook 503s) is still valid — the guard only forbids the secret.
  it("accepts a dormant-billing production env (fake provider, no fake secret)", () => {
    expect(envSchema.safeParse(PROD_ENV).success).toBe(true);
  });

  // When billing is live (provider=stripe), the Stripe secrets AND the four
  // price ids are load-bearing and must be present at boot rather than
  // failing on the first webhook/checkout: a missing price id throws on the
  // first checkout of that plan and leaves every subscription on that price
  // "unmapped" at the webhook (refused until the id is set).
  const STRIPE_LIVE = {
    BILLING_PROVIDER: "stripe",
    STRIPE_SECRET_KEY: "sk_live_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_PRO_MONTH: "price_pro_m",
    STRIPE_PRICE_PRO_YEAR: "price_pro_y",
    STRIPE_PRICE_TEAM_MONTH: "price_team_m",
    STRIPE_PRICE_TEAM_YEAR: "price_team_y",
  };

  it.each([
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO_MONTH",
    "STRIPE_PRICE_PRO_YEAR",
    "STRIPE_PRICE_TEAM_MONTH",
    "STRIPE_PRICE_TEAM_YEAR",
  ])("rejects production with BILLING_PROVIDER=stripe but no %s", (key) => {
    const stripeEnv: Record<string, unknown> = { ...PROD_ENV, ...STRIPE_LIVE };
    delete stripeEnv[key];
    const result = envSchema.safeParse(stripeEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(key);
    }
  });

  it("accepts a live-billing production env (provider=stripe with secrets and all four price ids)", () => {
    expect(envSchema.safeParse({ ...PROD_ENV, ...STRIPE_LIVE }).success).toBe(true);
  });

  // Outside production the price ids stay optional: a dev box can point at
  // Stripe test mode with only the plans it is exercising.
  it("does not require the price ids for provider=stripe outside production", () => {
    expect(envSchema.safeParse({ ...CI_BUILD_ENV, BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_x" }).success).toBe(true);
  });

  // S2 payments (mirrors BILLING_FAKE_SECRET): the fake webhook trusts a
  // caller-signed body verbatim and must never be reachable in production —
  // forbidden whether triggered by the secret or by selecting the provider.
  it("rejects production when PAYMENTS_FAKE_SECRET is set", () => {
    const result = envSchema.safeParse({ ...PROD_ENV, PAYMENTS_FAKE_SECRET: "0123456789abcdef0123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("PAYMENTS_PROVIDER");
    }
  });

  it("rejects production when PAYMENTS_PROVIDER=fake", () => {
    const result = envSchema.safeParse({ ...PROD_ENV, PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_SECRET: "0123456789abcdef0123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("PAYMENTS_PROVIDER");
    }
  });

  // The provider-completeness superRefine runs in every environment (unlike
  // the production-only block above), so prove it fires outside production too.
  it.each(["STRIPE_CONNECT_SECRET_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET"])(
    "rejects PAYMENTS_PROVIDER=stripe without %s, even outside production",
    (key) => {
      const paymentsEnv: Record<string, unknown> = {
        ...CI_BUILD_ENV,
        PAYMENTS_PROVIDER: "stripe",
        STRIPE_CONNECT_SECRET_KEY: "sk_connect_x",
        STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_connect_x",
      };
      delete paymentsEnv[key];
      const result = envSchema.safeParse(paymentsEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(key);
      }
    },
  );

  it("rejects PAYMENTS_PROVIDER=fake without PAYMENTS_FAKE_SECRET, even outside production", () => {
    const result = envSchema.safeParse({ ...CI_BUILD_ENV, PAYMENTS_PROVIDER: "fake" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("PAYMENTS_FAKE_SECRET");
    }
  });
});
