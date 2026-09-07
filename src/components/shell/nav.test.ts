import { describe, it, expect } from "vitest";
import { navItemsFor, titleForPath, NAV_SECTIONS, NAV_SECTION_LABELS } from "./nav";
import { FLAG_DEFAULTS, type Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";

const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
// Rentals flag forced ON here: nav must be exercised for the un-parked world
// regardless of what FLAG_DEFAULTS says while tasks land out of order.
const FLAGS: Flags = { ...FLAG_DEFAULTS, rentals: true };
const hrefs = (flags: typeof FLAGS, mode: OrgMode) => navItemsFor(flags, mode).map((i) => i.href);

describe("navItemsFor (flags × mode) — spec §1 table, fixed order, spaces first (H5b)", () => {
  it("rentals-only: keeps Availability (it covers spaces from U3), hides Services and Team", () => {
    expect(hrefs(FLAGS, RENTALS_ONLY)).toEqual([
      "/overview", "/bookings", "/clients", "/rentals", "/availability", "/booking-page", "/embed", "/notifications", "/integrations", "/settings",
    ]);
  });
  it("appointments-only: hides Spaces, keeps the rest in order", () => {
    expect(hrefs(FLAGS, APPTS_ONLY)).toEqual([
      "/overview", "/bookings", "/clients", "/services", "/team", "/availability", "/booking-page", "/embed", "/notifications", "/integrations", "/settings",
    ]);
  });
  it("sections: Offer holds the catalogue nouns, Share the channels, account the rest", () => {
    const flags = { ...FLAGS, billing: true, overview: true };
    const by = (mode: OrgMode, s: (typeof NAV_SECTIONS)[number]) =>
      navItemsFor(flags, mode).filter((i) => i.section === s).map((i) => i.href);
    expect(by(APPTS_ONLY, "main")).toEqual(["/overview", "/bookings", "/clients"]);
    expect(by(RENTALS_ONLY, "offer")).toEqual(["/rentals", "/availability"]);
    expect(by(APPTS_ONLY, "offer")).toEqual(["/services", "/team", "/availability"]);
    expect(by(APPTS_ONLY, "share")).toEqual(["/booking-page", "/embed"]);
    expect(by(APPTS_ONLY, "account")).toEqual(["/billing", "/notifications", "/integrations", "/settings"]);
    for (const i of navItemsFor(flags, APPTS_ONLY)) expect(NAV_SECTIONS).toContain(i.section);
  });
  it("section labels: Offer and Share are labelled, main and account are not", () => {
    expect(NAV_SECTIONS).toEqual(["main", "offer", "share", "account"]);
    expect(NAV_SECTION_LABELS).toEqual({ main: null, offer: "offer", share: "share", account: null });
  });
  it("the /rentals item is labelled Spaces (H5a vocabulary), and titles its page", () => {
    const item = navItemsFor(FLAGS, RENTALS_ONLY).find((i) => i.href === "/rentals");
    expect(item?.labelKey).toBe("spaces");
    expect(titleForPath("/rentals", navItemsFor(FLAGS, RENTALS_ONLY))).toEqual({ key: "spaces" });
  });
  it("the rentals kill-switch beats the mode", () => {
    expect(hrefs({ ...FLAGS, rentals: false }, RENTALS_ONLY)).not.toContain("/rentals");
  });
  it("existing flag gating is untouched", () => {
    // Billing is off in FLAG_DEFAULTS; overview is on since the requests
    // inbox landed, so its gate is exercised by switching it back off (what
    // an opted-out org gets from /utils/flags).
    const h = hrefs({ ...FLAGS, overview: false }, APPTS_ONLY);
    expect(h).not.toContain("/billing");
    expect(h).not.toContain("/overview");
  });
});

describe("titleForPath", () => {
  // Appointments-only mode: /rentals is filtered out of items, so the
  // "/rentals/xyz" case below genuinely exercises the fallback branch
  // rather than matching a real (post-restore) nav item.
  const items = navItemsFor({ ...FLAGS, billing: true }, APPTS_ONLY);
  it("matches an item and its sub-paths", () => {
    expect(titleForPath("/billing", items)).toEqual({ key: "billing" });
    expect(titleForPath("/clients/abc", items)).toEqual({ key: "clients" });
  });
  it("falls back to the capitalised first segment", () => {
    expect(titleForPath("/rentals/xyz", items)).toEqual({ text: "Rentals" });
    expect(titleForPath("/", items)).toEqual({ text: "" });
  });
});
