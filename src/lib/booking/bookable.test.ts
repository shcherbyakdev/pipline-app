import { describe, it, expect } from "vitest";
import { filterBookableServices, limitPublicOffering } from "./bookable";
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

const now = new Date("2026-08-18T00:00:00Z");
const staff = [{ id: "a" }, { id: "b" }, { id: "c" }]; // already ordered by sort_order
const services = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
const map = { s1: ["a", "b"], s2: ["b"], s3: ["a"], s4: ["c"] };

describe("limitPublicOffering", () => {
  it("free: primary staff only, then services that person offers, capped at 3", () => {
    const r = limitPublicOffering(services, staff, map, entitlementsFor(null, now));
    expect(r.staff.map((s) => s.id)).toEqual(["a"]);
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s3"]); // s2 (b only), s4 (c only) drop; <= 3 anyway
  });

  it("free with 4 services all offered by the primary → first 3", () => {
    const r = limitPublicOffering(
      services,
      staff,
      { s1: ["a"], s2: ["a"], s3: ["a"], s4: ["a"] },
      entitlementsFor(null, now),
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
});
