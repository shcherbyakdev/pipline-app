import { describe, it, expect } from "vitest";
import { navItemsFor, titleForPath } from "./nav";
import { FLAG_DEFAULTS } from "@/lib/flags";
import { BOTH } from "@/features/orgs/mode";

const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
// Rentals flag forced ON here: nav must be exercised for the un-parked world
// regardless of what FLAG_DEFAULTS says while tasks land out of order.
const FLAGS = { ...FLAG_DEFAULTS, rentals: true };
const hrefs = (flags: typeof FLAGS, mode: typeof BOTH) => navItemsFor(flags, mode).map((i) => i.href);

describe("navItemsFor (flags × mode)", () => {
  it("both channels: appointment items and Rentals are all present", () => {
    const h = hrefs(FLAGS, BOTH);
    for (const x of ["/bookings", "/clients", "/services", "/team", "/availability", "/rentals", "/booking-page", "/embed", "/settings"]) {
      expect(h).toContain(x);
    }
  });
  it("rentals-only: hides Services, Team and Availability", () => {
    const h = hrefs(FLAGS, RENTALS_ONLY);
    expect(h).not.toContain("/services");
    expect(h).not.toContain("/team");
    expect(h).not.toContain("/availability");
    expect(h).toContain("/rentals");
  });
  it("appointments-only: hides Rentals", () => {
    const h = hrefs(FLAGS, APPTS_ONLY);
    expect(h).not.toContain("/rentals");
    expect(h).toContain("/services");
  });
  it("the /rentals item is labelled Spaces (H5a vocabulary), and titles its page", () => {
    const item = navItemsFor(FLAGS, BOTH).find((i) => i.href === "/rentals");
    expect(item?.label).toBe("Spaces");
    expect(titleForPath("/rentals", navItemsFor(FLAGS, BOTH))).toBe("Spaces");
  });
  it("the rentals kill-switch beats the mode", () => {
    expect(hrefs({ ...FLAGS, rentals: false }, BOTH)).not.toContain("/rentals");
  });
  it("existing flag gating is untouched", () => {
    const h = hrefs(FLAGS, BOTH); // billing + overview off in FLAG_DEFAULTS
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
    expect(titleForPath("/billing", items)).toBe("Billing");
    expect(titleForPath("/clients/abc", items)).toBe("Clients");
  });
  it("falls back to the capitalised first segment", () => {
    expect(titleForPath("/rentals/xyz", items)).toBe("Rentals");
    expect(titleForPath("/", items)).toBe("");
  });
});
