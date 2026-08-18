// return-url.ts imports env from "@/env", which parses process.env eagerly
// at module load, and plain `npm run test` CI does not set the Supabase vars
// (fake.test.ts / drain-isolation.test.ts precedent). Stub them, pin the app
// URL so the assertions below don't depend on whoever's .env.local, then
// import dynamically — a static import would hoist above these assignments.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

import { describe, it, expect } from "vitest";
const { safeReturnUrl, returnUrlWith } = await import("./return-url");

const APP = "http://localhost:3000";

describe("safeReturnUrl", () => {
  it("resolves a relative path against the app URL", () => {
    expect(safeReturnUrl("/billing?checkout=success&plan=pro")).toBe(
      `${APP}/billing?checkout=success&plan=pro`,
    );
  });

  it("keeps a same-origin absolute URL as-is", () => {
    expect(safeReturnUrl(`${APP}/settings/team`)).toBe(`${APP}/settings/team`);
  });

  it("refuses a foreign origin", () => {
    expect(safeReturnUrl("https://evil.example.com/steal")).toBe(`${APP}/billing`);
    // Protocol-relative: `new URL("//evil…", app)` inherits http: and lands
    // on the attacker's host, so it must be caught by the ORIGIN check, not
    // by the scheme one.
    expect(safeReturnUrl("//evil.example.com/steal")).toBe(`${APP}/billing`);
  });

  it("refuses a non-http(s) scheme", () => {
    expect(safeReturnUrl("javascript:alert(1)")).toBe(`${APP}/billing`);
    expect(safeReturnUrl("data:text/html,<script>alert(1)</script>")).toBe(`${APP}/billing`);
  });

  it("falls back for a missing or empty value", () => {
    expect(safeReturnUrl(null)).toBe(`${APP}/billing`);
    expect(safeReturnUrl(undefined)).toBe(`${APP}/billing`);
    expect(safeReturnUrl("")).toBe(`${APP}/billing`);
  });
});

describe("returnUrlWith", () => {
  it("sets checkout=success and plan on a plain return URL", () => {
    const url = new URL(returnUrlWith("/billing", { checkout: "success", plan: "pro" }));
    expect(url.origin + url.pathname).toBe(`${APP}/billing`);
    expect(url.searchParams.getAll("checkout")).toEqual(["success"]);
    expect(url.searchParams.getAll("plan")).toEqual(["pro"]);
  });

  it("does not duplicate params the return URL already carries", () => {
    // What startCheckout actually hands the provider.
    const url = new URL(
      returnUrlWith(`${APP}/billing?checkout=success&plan=pro`, { checkout: "success", plan: "team" }),
    );
    expect(url.searchParams.getAll("checkout")).toEqual(["success"]);
    expect(url.searchParams.getAll("plan")).toEqual(["team"]);
  });

  it("applies the params to the fallback when the return URL is foreign", () => {
    expect(returnUrlWith("https://evil.example.com/", { checkout: "success", plan: "pro" })).toBe(
      `${APP}/billing?checkout=success&plan=pro`,
    );
  });
});
