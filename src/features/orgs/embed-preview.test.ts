import { describe, it, expect } from "vitest";
import { previewFor } from "./embed-preview";

const anna = { id: "p1", name: "Anna", slug: "anna", color: "#000" };
const ben = { id: "p2", name: "Ben", slug: "ben", color: "#000" };
const staff = [anna, ben];
const services = [{ id: "s1" }, { id: "s2" }];
const offerings = [{ id: "o1" }];
const serviceStaffIds = { s1: ["p1"], s2: ["p1", "p2"] };
const input = { services, offerings, staff, serviceStaffIds };

describe("previewFor (the embed page's preview follows the snippet — app/embed/[handle]'s rule)", () => {
  it("no target: the org flow", () => {
    expect(previewFor(null, input)).toEqual({ services, offerings, lockedStaff: null, requestedService: null, requestedOffering: null });
  });
  it("a person: only what they offer, no spaces, locked to them", () => {
    const out = previewFor({ staff: "ben" }, input);
    expect(out.services.map((s) => s.id)).toEqual(["s2"]);
    expect(out.offerings).toEqual([]);
    expect(out.lockedStaff).toBe(ben);
  });
  it("a person who offers nothing (or an unknown slug) drops the lock — the org flow", () => {
    const nobody = previewFor({ staff: "anna" }, { ...input, serviceStaffIds: { s1: ["p2"], s2: ["p2"] } });
    expect(nobody.services).toEqual(services);
    expect(nobody.lockedStaff).toBeNull();
    expect(previewFor({ staff: "zed" }, input).lockedStaff).toBeNull();
  });
  it("a service or a space is a first-render request; unknown ids are ignored", () => {
    expect(previewFor({ service: "s1" }, input).requestedService).toEqual({ id: "s1", key: 1 });
    expect(previewFor({ space: "o1" }, input).requestedOffering).toEqual({ id: "o1", key: 1 });
    expect(previewFor({ service: "nope" }, input).requestedService).toBeNull();
  });
});
