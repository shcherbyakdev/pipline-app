import { describe, it, expect } from "vitest";
import { navItemsFor, titleForPath, NAV_SECTIONS, NAV_SECTION_LABELS } from "./nav";
import { FLAG_DEFAULTS, type Flags } from "@/lib/flags";
import { BOTH } from "@/features/orgs/mode";

const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
// Rentals flag forced ON here: nav must be exercised for the un-parked world
// regardless of what FLAG_DEFAULTS says while tasks land out of order.
const FLAGS: Flags = { ...FLAG_DEFAULTS, rentals: true };
const hrefs = (flags: typeof FLAGS, mode: typeof BOTH) => navItemsFor(flags, mode).map((i) => i.href);

describe("navItemsFor (flags × mode) — spec §1 table, fixed order, spaces first (H5b)", () => {
  it("both channels: every row, in the spec's order", () => {
    expect(hrefs(FLAGS, BOTH)).toEqual([
      "/overview", "/bookings", "/clients",
      "/rentals", "/services", "/team", "/availability",
      "/booking-page", "/embed",
      "/settings",
    ]);
  });
  it("rentals-only: keeps Availability (it covers spaces from U3), hides Services and Team", () => {
    expect(hrefs(FLAGS, RENTALS_ONLY)).toEqual([
      "/overview", "/bookings", "/clients", "/rentals", "/availability", "/booking-page", "/embed", "/settings",
    ]);
  });
  it("appointments-only: hides Spaces, keeps the rest in order", () => {
    expect(hrefs(FLAGS, APPTS_ONLY)).toEqual([
      "/overview", "/bookings", "/clients", "/services", "/team", "/availability", "/booking-page", "/embed", "/settings",
    ]);
  });
  it("sections: Offer holds the catalogue nouns, Share the channels, account the rest", () => {
    const all = navItemsFor({ ...FLAGS, billing: true, overview: true }, BOTH);
    const by = (s: (typeof NAV_SECTIONS)[number]) => all.filter((i) => i.section === s).map((i) => i.href);
    expect(by("main")).toEqual(["/overview", "/bookings", "/clients"]);
    expect(by("offer")).toEqual(["/rentals", "/services", "/team", "/availability"]);
    expect(by("share")).toEqual(["/booking-page", "/embed"]);
    expect(by("account")).toEqual(["/billing", "/settings"]);
    for (const i of all) expect(NAV_SECTIONS).toContain(i.section);
  });
  it("section labels: Offer and Share are labelled, main and account are not", () => {
    expect(NAV_SECTIONS).toEqual(["main", "offer", "share", "account"]);
    expect(NAV_SECTION_LABELS).toEqual({ main: null, offer: "offer", share: "share", account: null });
  });
  it("the /rentals item is labelled Spaces (H5a vocabulary), and titles its page", () => {
    const item = navItemsFor(FLAGS, BOTH).find((i) => i.href === "/rentals");
    expect(item?.labelKey).toBe("spaces");
    expect(titleForPath("/rentals", navItemsFor(FLAGS, BOTH))).toEqual({ key: "spaces" });
  });
  it("the rentals kill-switch beats the mode", () => {
    expect(hrefs({ ...FLAGS, rentals: false }, BOTH)).not.toContain("/rentals");
  });
  it("existing flag gating is untouched", () => {
    // Billing is off in FLAG_DEFAULTS; overview is on since the requests
    // inbox landed, so its gate is exercised by switching it back off (what
    // an opted-out org gets from /utils/flags).
    const h = hrefs({ ...FLAGS, overview: false }, BOTH);
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
