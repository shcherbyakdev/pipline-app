// requireDevBilling's four conditions, with the production one pinned to
// APP_ENV. Everything the guard reaches (env, session, flags, notFound) is
// mocked; the env mock is mutable so one file can walk every combination
// without re-importing the module per case.
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({
  APP_ENV: undefined as "development" | "production" | undefined,
  BILLING_PROVIDER: "fake" as "fake" | "stripe",
}));
vi.mock("@/env", () => ({ env: envMock }));

const flags = vi.hoisted(() => ({ billing: true }));
vi.mock("@/lib/flags/resolve", () => ({ getDashboardFlags: vi.fn(async () => flags) }));

const ORG = { id: "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", name: "DevCo", slug: "devco" };
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ user: { id: "u1", email: "dev@example.com" }, org: ORG })),
}));

// The real notFound() throws NEXT_HTTP_ERROR_FALLBACK;404; emulate the throw
// (utils/actions.test.ts idiom for redirect) so the gate is assertable.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const { requireDevBilling } = await import("./guard");

beforeEach(() => {
  envMock.APP_ENV = undefined;
  envMock.BILLING_PROVIDER = "fake";
  flags.billing = true;
  vi.unstubAllEnvs();
});

describe("requireDevBilling", () => {
  it("passes on a dev box: no APP_ENV, fake provider, billing flag on, own org", async () => {
    await expect(requireDevBilling()).resolves.toEqual({ user: expect.objectContaining({ id: "u1" }), org: ORG });
    await expect(requireDevBilling(ORG.id)).resolves.toMatchObject({ org: ORG });
    envMock.APP_ENV = "development";
    await expect(requireDevBilling()).resolves.toMatchObject({ org: ORG });
  });

  it("404s when APP_ENV=production — these pages hand out plans for free", async () => {
    envMock.APP_ENV = "production";
    await expect(requireDevBilling()).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the real provider is on: only Stripe's webhooks may write a subscription", async () => {
    envMock.BILLING_PROVIDER = "stripe";
    await expect(requireDevBilling()).rejects.toThrow("NOT_FOUND");
  });

  it("does NOT read NODE_ENV: `next dev` against a production database must still be gated by APP_ENV alone", async () => {
    // Regression guard (env.test.ts idiom): the gate used to be NODE_ENV,
    // which is "production" inside every `next build` (CI's included) and
    // "development" under `next dev` whatever database it points at.
    vi.stubEnv("NODE_ENV", "production");
    await expect(requireDevBilling()).resolves.toMatchObject({ org: ORG });
    vi.stubEnv("NODE_ENV", "development");
    envMock.APP_ENV = "production";
    await expect(requireDevBilling()).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the caller's org has billing off, or names someone else's org", async () => {
    flags.billing = false;
    await expect(requireDevBilling()).rejects.toThrow("NOT_FOUND");
    flags.billing = true;
    await expect(requireDevBilling("11111111-2222-4333-8444-555555555555")).rejects.toThrow("NOT_FOUND");
  });
});
