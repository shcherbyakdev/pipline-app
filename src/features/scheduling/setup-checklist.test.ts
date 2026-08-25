import { describe, it, expect } from "vitest";
import { setupChecklist } from "./setup-checklist";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const nothing = { serviceCount: 0, spaceCount: 0, hourlySpaceCount: 0, ownersWithHours: 0, published: false };

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
    const items = setupChecklist({ mode: BOTH, serviceCount: 2, spaceCount: 0, hourlySpaceCount: 0, ownersWithHours: 1, published: true });
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({
      service: true, space: false, hours: true, publish: true,
    });
  });
});
