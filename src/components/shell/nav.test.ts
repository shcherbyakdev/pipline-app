import { describe, it, expect } from "vitest";
import { FLAG_DEFAULTS } from "@/lib/flags";
import { navItemsFor, titleForPath } from "./nav";

const off = { ...FLAG_DEFAULTS, billing: false, overview: false };

describe("navItemsFor", () => {
  it("defaults: no Overview, no Billing; Bookings leads", () => {
    const hrefs = navItemsFor(off).map((i) => i.href);
    expect(hrefs[0]).toBe("/bookings");
    expect(hrefs).not.toContain("/overview");
    expect(hrefs).not.toContain("/billing");
  });
  it("overview on → Overview is the first main item", () => {
    expect(navItemsFor({ ...off, overview: true })[0].href).toBe("/overview");
  });
  it("billing on → Billing sits in Configure before Settings", () => {
    const hrefs = navItemsFor({ ...off, billing: true }).map((i) => i.href);
    expect(hrefs.indexOf("/billing")).toBe(hrefs.indexOf("/settings") - 1);
  });
});

describe("titleForPath", () => {
  const items = navItemsFor({ ...off, billing: true });
  it("matches an item and its sub-paths", () => {
    expect(titleForPath("/billing", items)).toBe("Billing");
    expect(titleForPath("/clients/abc", items)).toBe("Clients");
  });
  it("falls back to the capitalised first segment", () => {
    expect(titleForPath("/rentals/xyz", items)).toBe("Rentals");
    expect(titleForPath("/", items)).toBe("");
  });
});
