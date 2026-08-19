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
});
