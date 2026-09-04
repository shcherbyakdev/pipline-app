import { describe, it, expect } from "vitest";
import { setupChecklist, showWelcome } from "./setup-checklist";

const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const nothing = {
  serviceCount: 0, spaceCount: 0, bookableSpaceCount: 0, unitlessSpaceId: null, hourlySpaceCount: 0, ownersWithHours: 0,
};

describe("setupChecklist (admin IA spec §4)", () => {
  // No publish chip: the page renders a default document once something is
  // bookable, so the chips below are exactly the go-live conditions.
  it("appointments: service then hours, all undone", () => {
    const items = setupChecklist({ mode: APPTS, ...nothing });
    expect(items.map((i) => i.id)).toEqual(["service", "hours"]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.map((i) => i.labelKey)).toEqual(["addService", "setHours"]);
    expect(items.map((i) => i.href)).toEqual(["/services/new", "/availability"]);
  });
  it("rentals-only, nights/days only: just space — there are no weekly hours to set", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing }).map((i) => i.id)).toEqual(["space"]);
  });
  it("rentals-only with an hourly space: hours joins (U3 — /availability serves hourly spaces)", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, hourlySpaceCount: 1 }).map((i) => i.id)).toEqual([
      "space", "hours",
    ]);
  });
  it("ticks follow the counts", () => {
    const items = setupChecklist({ mode: APPTS, ...nothing, serviceCount: 2, ownersWithHours: 0 });
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({ service: true, hours: false });
  });

  // A space only reaches the public page once it has an active unit
  // (lib/booking/public.ts listPublicOfferings); the D9 404 rule means an
  // owner with a unit-less space sees nothing at their address. The chip
  // must not tick until the space is bookable, and must send the owner to
  // the space that needs a unit rather than to "new space".
  it("a space with no active unit is not done — the chip sends the owner to that space", () => {
    const items = setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, bookableSpaceCount: 0, unitlessSpaceId: "off-1" });
    const space = items.find((i) => i.id === "space")!;
    expect(space.done).toBe(false);
    expect(space.labelKey).toBe("addUnit");
    expect(space.href).toBe("/rentals/off-1");
  });
  it("a space with an active unit ticks the chip; the label stays the plain one", () => {
    const items = setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, bookableSpaceCount: 1, unitlessSpaceId: null });
    const space = items.find((i) => i.id === "space")!;
    expect(space.done).toBe(true);
    expect(space.labelKey).toBe("addSpace");
    expect(space.href).toBe("/rentals/new");
  });
  it("two spaces, one bookable: done — the other's missing unit is the list's badge, not the checklist's job", () => {
    const items = setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 2, bookableSpaceCount: 1, unitlessSpaceId: "off-2" });
    expect(items.find((i) => i.id === "space")!.done).toBe(true);
  });
});

// The banner used to ride ?welcome=1 and vanished on the first click of any
// chip (every chip navigates away). It now shows until the checklist is
// done or the owner dismisses it — derived, not carried in the URL.
describe("showWelcome", () => {
  const todo = { id: "service" as const, labelKey: "addService" as const, href: "/services/new", done: false };
  const done = { ...todo, done: true };

  it("shows while any item is undone", () => {
    expect(showWelcome({ dismissed: false, handle: "acme", checklist: [done, todo] })).toBe(true);
  });
  it("hides by itself once every item is done — no persistence needed", () => {
    expect(showWelcome({ dismissed: false, handle: "acme", checklist: [done, done] })).toBe(false);
  });
  it("hides when dismissed, however much is left", () => {
    expect(showWelcome({ dismissed: true, handle: "acme", checklist: [todo] })).toBe(false);
  });
  it("a handle-less org (legacy) still gets the 'pick an address' banner", () => {
    expect(showWelcome({ dismissed: false, handle: null, checklist: [] })).toBe(true);
    expect(showWelcome({ dismissed: true, handle: null, checklist: [] })).toBe(false);
  });
  it("an empty checklist with a handle means nothing to do", () => {
    expect(showWelcome({ dismissed: false, handle: "acme", checklist: [] })).toBe(false);
  });
});
