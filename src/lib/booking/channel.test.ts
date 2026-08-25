import { describe, it, expect } from "vitest";
import { applyChannel, resolveChannelParam } from "./channel";

const svc = { id: "s1" };
const person = { id: "p1" };
const room = { id: "o1" };
const both = { services: [svc], staff: [person], serviceStaffIds: { s1: ["p1"] }, offerings: [room] };

describe("resolveChannelParam (spec §5 — one channel only)", () => {
  it("accepts exactly services or spaces", () => {
    expect(resolveChannelParam("services")).toBe("services");
    expect(resolveChannelParam("spaces")).toBe("spaces");
  });
  it("anything else is null: other words, case, arrays, absence", () => {
    expect(resolveChannelParam("rooms")).toBeNull();
    expect(resolveChannelParam("Services")).toBeNull();
    expect(resolveChannelParam(["services"])).toBeNull();
    expect(resolveChannelParam(undefined)).toBeNull();
  });
});

describe("applyChannel", () => {
  it("services: drops the spaces; spaces: drops services, staff and the staff map", () => {
    expect(applyChannel(both, "services")).toEqual({ ...both, offerings: [] });
    expect(applyChannel(both, "spaces")).toEqual({ services: [], staff: [], serviceStaffIds: {}, offerings: [room] });
  });
  it("no channel: the catalogue is returned as-is", () => {
    expect(applyChannel(both, null)).toBe(both);
  });
  it("degrades to the full catalogue when the requested channel has nothing in it (never an empty widget)", () => {
    const spacesOnly = { ...both, services: [], staff: [], serviceStaffIds: {} };
    expect(applyChannel(spacesOnly, "services")).toBe(spacesOnly);
    const servicesOnly = { ...both, offerings: [] };
    expect(applyChannel(servicesOnly, "spaces")).toBe(servicesOnly);
  });
});
