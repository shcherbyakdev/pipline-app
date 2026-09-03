import { describe, it, expect } from "vitest";
import { bookableAdminServices, chooseStaffForBooking, filterBookableServices, limitPublicOffering, limitPublicResources } from "./bookable";
import { entitlementsFor } from "@/lib/billing/entitlements";

const anna = { id: "a" };
const ben = { id: "b" };
const cut = { id: "cut" };
const colour = { id: "colour" };

describe("filterBookableServices", () => {
  // The regression this guards: /book and /embed listed every active service,
  // so a service linked to nobody (or only to people since deactivated) put a
  // card on the page whose confirm step can only ever fail.
  it("drops a service with no staff links at all", () => {
    expect(filterBookableServices([cut, colour], { cut: ["a"] }, [anna])).toEqual([cut]);
  });

  it("drops a service whose only linked staff are inactive", () => {
    // `serviceStaffIds` is unfiltered by staff.active — the active roster is
    // what decides, so a link to someone absent from it counts for nothing.
    expect(filterBookableServices([cut], { cut: ["b"] }, [anna])).toEqual([]);
  });

  it("keeps a service as long as one linked member is active", () => {
    expect(filterBookableServices([cut], { cut: ["b", "a"] }, [anna])).toEqual([cut]);
  });

  it("empty roster leaves nothing bookable", () => {
    expect(filterBookableServices([cut, colour], { cut: ["a"], colour: ["b"] }, [])).toEqual([]);
  });

  it("onlyStaffId narrows to what that person offers", () => {
    const map = { cut: ["a", "b"], colour: ["b"] };
    expect(filterBookableServices([cut, colour], map, [anna, ben], "a")).toEqual([cut]);
    expect(filterBookableServices([cut, colour], map, [anna, ben], "b")).toEqual([cut, colour]);
  });

  it("onlyStaffId who is not on the active roster offers nothing", () => {
    expect(filterBookableServices([cut], { cut: ["b"] }, [anna], "b")).toEqual([]);
  });

  it("preserves input order and identity", () => {
    const services = [colour, cut];
    const out = filterBookableServices(services, { cut: ["a"], colour: ["a"] }, [anna]);
    expect(out).toEqual([colour, cut]);
    expect(out[0]).toBe(colour);
  });
});

describe("bookableAdminServices (admin twin of filterBookableServices)", () => {
  const annaActive = { id: "a", active: true };
  const benInactive = { id: "b", active: false };

  it("keeps an active service linked to an active person", () => {
    const cut2 = { id: "cut", active: true, staffIds: ["a"] };
    expect(bookableAdminServices([cut2], [annaActive])).toEqual([cut2]);
  });

  it("drops an inactive service", () => {
    const cut2 = { id: "cut", active: false, staffIds: ["a"] };
    expect(bookableAdminServices([cut2], [annaActive])).toEqual([]);
  });

  it("drops an active service whose only linked person is inactive", () => {
    const cut2 = { id: "cut", active: true, staffIds: ["b"] };
    expect(bookableAdminServices([cut2], [annaActive, benInactive])).toEqual([]);
  });

  it("drops an active service with no links", () => {
    const cut2 = { id: "cut", active: true, staffIds: [] };
    expect(bookableAdminServices([cut2], [annaActive])).toEqual([]);
  });

  it("preserves input order", () => {
    const colour2 = { id: "colour", active: true, staffIds: ["a"] };
    const cut2 = { id: "cut", active: true, staffIds: ["a"] };
    expect(bookableAdminServices([colour2, cut2], [annaActive]).map((s) => s.id)).toEqual(["colour", "cut"]);
  });
});

const now = new Date("2026-08-18T00:00:00Z");
const staff = [{ id: "a" }, { id: "b" }, { id: "c" }]; // already ordered by sort_order
const services = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
const map = { s1: ["a", "b"], s2: ["b"], s3: ["a"], s4: ["c"] };

describe("limitPublicOffering", () => {
  it("free: the first two people, then services they offer, capped at 3", () => {
    const r = limitPublicOffering(services, staff, map, entitlementsFor(null, now));
    expect(r.staff.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s2", "s3"]); // s4 (c only) drops; <= 3 anyway
  });

  it("free with 4 services all offered by the primary → all four (no plan caps services)", () => {
    const r = limitPublicOffering(
      services,
      staff,
      { s1: ["a"], s2: ["a"], s3: ["a"], s4: ["a"] },
      entitlementsFor(null, now),
    );
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });
  it("a plan capped at 3 services → first 3 in order", () => {
    const r = limitPublicOffering(
      services,
      staff,
      { s1: ["a"], s2: ["a"], s3: ["a"], s4: ["a"] },
      { ...entitlementsFor(null, now), publicServices: 3 },
    );
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("team: everyone, everything", () => {
    const team = entitlementsFor(
      { plan: "team", status: "active", interval: "month", seats: 5, currentPeriodEnd: null, cancelAtPeriodEnd: false },
      now,
    );
    const r = limitPublicOffering(services, staff, map, team);
    expect(r.staff).toHaveLength(3);
    expect(r.services).toHaveLength(4);
  });

  it("team with 2 seats and 3 staff → first 2 by order", () => {
    const team = entitlementsFor(
      { plan: "team", status: "active", interval: "month", seats: 2, currentPeriodEnd: null, cancelAtPeriodEnd: false },
      now,
    );
    expect(limitPublicOffering(services, staff, map, team).staff.map((s) => s.id)).toEqual(["a", "b"]);
  });

  // Order of operations, pinned: narrow to the bookable roster FIRST, cap
  // SECOND. s1 belongs to b alone, so Free (roster [a]) drops it and the cap
  // never bites — capping first would have spent a slot on s1 and returned
  // ["s2", "s3"], hiding a service the org may legitimately offer.
  it("narrows to the bookable roster before capping, not after", () => {
    // c is the third person, outside Free's two slots: s1 must drop BEFORE
    // the cap of 3 is applied, or the cap would keep s1 and lose s4.
    const r = limitPublicOffering(
      services,
      staff,
      { s1: ["c"], s2: ["a"], s3: ["a"], s4: ["a"] },
      entitlementsFor(null, now),
    );
    expect(r.services.map((s) => s.id)).toEqual(["s2", "s3", "s4"]);
  });
});

describe("chooseStaffForBooking", () => {
  const base = { bookableIds: ["a", "b", "c"], eligibleStaffIds: ["a", "b", "c"], freeStaffIdsAtSlot: ["b", "c"] };

  it("a named staff member is passed straight through, no candidates", () => {
    expect(chooseStaffForBooking({ ...base, staffId: "b" })).toEqual({ staffId: "b", candidates: null });
    // Even when the plan would not offer them: the RPC's strict named check
    // is the gate, and this function must not silently redirect a booking.
    expect(chooseStaffForBooking({ ...base, staffId: "z" })).toEqual({ staffId: "z", candidates: null });
  });

  it("one bookable person is named rather than auto-assigned", () => {
    expect(
      chooseStaffForBooking({ staffId: "any", bookableIds: ["a"], eligibleStaffIds: ["a", "b"], freeStaffIdsAtSlot: ["a"] }),
    ).toEqual({ staffId: "a", candidates: null });
  });

  it("hands the DB the choice among the people the engine found free", () => {
    expect(chooseStaffForBooking({ ...base, staffId: "any" })).toEqual({ staffId: null, candidates: ["b", "c"] });
  });

  it("never lets a non-bookable (plan-hidden) person into the candidate set", () => {
    // c is eligible but not bookable; the engine listed b and c as free.
    expect(
      chooseStaffForBooking({
        staffId: "any",
        bookableIds: ["a", "b"],
        eligibleStaffIds: ["a", "b", "c"],
        freeStaffIdsAtSlot: ["b", "c"],
      }),
    ).toEqual({ staffId: null, candidates: ["b"] });
  });

  it("falls back to the whole bookable roster when nobody is listed as free", () => {
    expect(
      chooseStaffForBooking({
        staffId: "any",
        bookableIds: ["a", "b"],
        eligibleStaffIds: ["a", "b", "c"],
        freeStaffIdsAtSlot: [],
      }),
    ).toEqual({ staffId: null, candidates: ["a", "b"] });
  });
});

describe("limitPublicResources (H5b: one budget for the org's channel)", () => {
  const APPTS = { offersAppointments: true, offersRentals: false };
  const SPACES = { offersAppointments: false, offersRentals: true };
  const people = [{ id: "a" }, { id: "b" }];
  const units = [
    { id: "u1", offeringId: "o1" },
    { id: "u2", offeringId: "o1" },
    { id: "u3", offeringId: "o2" },
  ];
  const free = entitlementsFor(null, now);
  const pro = entitlementsFor(
    { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    now,
  );
  const unlimited = { ...free, bookableResources: Number.MAX_SAFE_INTEGER };

  it("people are kept in the order given, up to the cap", () => {
    const r = limitPublicResources(people, units, APPTS, { ...pro, bookableResources: 1 });
    expect(r.staff.map((s) => s.id)).toEqual(["a"]);
    expect(r.units).toEqual([]);
  });
  it("Pro (five slots) fits three units", () => {
    const r = limitPublicResources(people, units, SPACES, pro);
    expect(r.staff).toEqual([]);
    expect(r.units.map((u) => u.id)).toEqual(["u1", "u2", "u3"]);
  });
  it("spaces-only: the backfilled staff row neither shows nor spends a slot", () => {
    const r = limitPublicResources(people, units, SPACES, free);
    expect(r.staff).toEqual([]);
    expect(r.units.map((u) => u.id)).toEqual(["u1", "u2"]);
  });
  it("appointments-only: units neither show nor spend a slot", () => {
    const r = limitPublicResources(people, units, APPTS, pro);
    expect(r.staff.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.units).toEqual([]);
  });
  it("an uncapped plan keeps everything, identity preserved", () => {
    const r = limitPublicResources(people, units, SPACES, unlimited);
    expect(r.units).toHaveLength(3);
    expect(r.units[0]).toBe(units[0]);
  });
});
