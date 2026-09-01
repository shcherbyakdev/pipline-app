import { beforeAll, describe, expect, it } from "vitest";

// safeReturnUrl resolves against NEXT_PUBLIC_APP_URL, which @/env parses from
// process.env at import time. No other unit test imports env, so populate the
// required public vars with fixed values and dynamic-import after, giving the
// origin check a deterministic app origin to test against.
const APP_ORIGIN = "https://app.test";
let safeReturnUrl: (returnTo: string) => string;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = `${APP_ORIGIN}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  ({ safeReturnUrl } = await import("./return-url"));
});

describe("safeReturnUrl", () => {
  it("passes a relative path through as an app-origin absolute URL", () => {
    expect(safeReturnUrl("/billing?checkout=success")).toBe(`${APP_ORIGIN}/billing?checkout=success`);
  });

  it("passes a same-origin absolute URL through unchanged", () => {
    expect(safeReturnUrl(`${APP_ORIGIN}/team`)).toBe(`${APP_ORIGIN}/team`);
  });

  it("rejects an off-origin absolute URL (open-redirect vector)", () => {
    expect(safeReturnUrl("https://evil.example/phish")).toBe(`${APP_ORIGIN}/billing`);
  });

  it("rejects a protocol-relative //host redirect", () => {
    expect(safeReturnUrl("//evil.example")).toBe(`${APP_ORIGIN}/billing`);
  });

  it("rejects a javascript: scheme (opaque origin, never matches)", () => {
    expect(safeReturnUrl("javascript:alert(document.cookie)")).toBe(`${APP_ORIGIN}/billing`);
  });
});
