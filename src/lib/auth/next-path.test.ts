import { describe, it, expect } from "vitest";
import { afterLogin, isProtectedPath, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("accepts same-site paths with a query", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/bookings?week=2026-08-24")).toBe("/bookings?week=2026-08-24");
  });
  it("rejects anything a browser could read as another origin", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "https://booklo.co//evil.com",
      "javascript:alert(1)",
      "/settings\nX-Injected: 1",
      "",
      42,
      null,
    ]) {
      expect(safeNextPath(bad), String(bad)).toBeNull();
    }
  });
  it("never loops back into the auth pages", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/x")).toBeNull();
    expect(safeNextPath("/auth/confirm?x=1")).toBeNull();
  });
  it("afterLogin falls back to the dashboard", () => {
    expect(afterLogin("//evil.com")).toBe("/bookings");
    expect(afterLogin("/team")).toBe("/team");
  });
});

describe("isProtectedPath", () => {
  it("covers the dashboard, onboarding, utils, dev and the reset page", () => {
    for (const p of ["/bookings", "/clients/abc", "/embed", "/onboarding", "/utils/flags", "/dev/billing/checkout", "/reset-password", "/waitlist"]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
  });
  it("leaves every public surface alone", () => {
    for (const p of ["/", "/anna", "/anna/tomek", "/embed/anna", "/booking/tok", "/login", "/pricing", "/api/scheduling/drain", "/book/anna"]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });
});
