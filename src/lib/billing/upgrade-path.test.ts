import { describe, it, expect } from "vitest";
import { upgradeHref, upgradeHrefFromRefusal } from "./upgrade-path";
import { planLimitResourceError, planLimitServicesError, GENERIC_WRITE_ERROR } from "@/features/scheduling/schema";

describe("upgradeHref", () => {
  it("Billing while it is on, whatever the plan", () => {
    expect(upgradeHref({ billing: true, premium_waitlist: true }, "free")).toBe("/billing");
    expect(upgradeHref({ billing: true, premium_waitlist: false }, "pro")).toBe("/billing");
  });
  it("the waitlist only for a Free org; no door otherwise", () => {
    expect(upgradeHref({ billing: false, premium_waitlist: true }, "free")).toBe("/waitlist");
    expect(upgradeHref({ billing: false, premium_waitlist: true }, "pro")).toBeNull();
    expect(upgradeHref({ billing: false, premium_waitlist: false }, "free")).toBeNull();
  });
});

describe("upgradeHrefFromRefusal", () => {
  it("reads the door back off the gate's copy", () => {
    expect(upgradeHrefFromRefusal(planLimitResourceError(1, "waitlist"))).toBe("/waitlist");
    expect(upgradeHrefFromRefusal(planLimitServicesError("billing"))).toBe("/billing");
    expect(upgradeHrefFromRefusal(planLimitResourceError(3, "none"))).toBeNull();
    expect(upgradeHrefFromRefusal(GENERIC_WRITE_ERROR)).toBeNull();
  });
});
