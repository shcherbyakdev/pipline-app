import { describe, it, expect } from "vitest";
import { hrefForHint, upgradeHref } from "./upgrade-path";

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

describe("hrefForHint", () => {
  it("maps the gate's hint back to the door", () => {
    expect(hrefForHint("billing")).toBe("/billing");
    expect(hrefForHint("waitlist")).toBe("/waitlist");
    expect(hrefForHint("none")).toBeNull();
  });
});
