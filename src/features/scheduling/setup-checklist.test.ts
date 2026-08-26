import { describe, it, expect } from "vitest";
import { setupChecklist } from "./setup-checklist";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const nothing = {
  serviceCount: 0, spaceCount: 0, bookableSpaceCount: 0, unitlessSpaceId: null, hourlySpaceCount: 0, ownersWithHours: 0, published: false,
};

describe("setupChecklist (admin IA spec §4)", () => {
  it("both modes: space, service, hours, publish — in that order, all undone", () => {
    const items = setupChecklist({ mode: BOTH, ...nothing });
    expect(items.map((i) => i.id)).toEqual(["space", "service", "hours", "publish"]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.map((i) => i.label)).toEqual(["Add a space", "Add a service", "Set hours", "Publish your page"]);
    expect(items.map((i) => i.href)).toEqual(["/rentals?new=1", "/services?new=1", "/availability", "/booking-page"]);
  });
  it("appointments-only: no space item", () => {
    expect(setupChecklist({ mode: APPTS, ...nothing }).map((i) => i.id)).toEqual(["service", "hours", "publish"]);
  });
  it("rentals-only, nights/days only: space and publish — there are no weekly hours to set", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing }).map((i) => i.id)).toEqual(["space", "publish"]);
  });
  it("rentals-only with an hourly space: hours joins (U3 — /availability serves hourly spaces)", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, hourlySpaceCount: 1 }).map((i) => i.id)).toEqual([
      "space", "hours", "publish",
    ]);
  });
  it("ticks follow the counts", () => {
    const items = setupChecklist({ mode: BOTH, ...nothing, serviceCount: 2, ownersWithHours: 1, published: true });
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({
      service: true, space: false, hours: true, publish: true,
    });
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
    expect(space.label).toBe("Add a unit to your space");
    expect(space.href).toBe("/rentals/off-1");
  });
  it("a space with an active unit ticks the chip; the label stays the plain one", () => {
    const items = setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, bookableSpaceCount: 1, unitlessSpaceId: null });
    const space = items.find((i) => i.id === "space")!;
    expect(space.done).toBe(true);
    expect(space.label).toBe("Add a space");
    expect(space.href).toBe("/rentals?new=1");
  });
  it("two spaces, one bookable: done — the other's missing unit is the list's badge, not the checklist's job", () => {
    const items = setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 2, bookableSpaceCount: 1, unitlessSpaceId: "off-2" });
    expect(items.find((i) => i.id === "space")!.done).toBe(true);
  });
});
