import { describe, it, expect } from "vitest";
import { applyChannel, embedChannel, requestedEmbedChannel, resolveChannelParam } from "./channel";

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

describe("embedChannel — the embed is always one channel (2026-09-02 ruling)", () => {
  const bothHas = { services: true, spaces: true };
  it("shows the requested channel when it has something bookable", () => {
    expect(embedChannel(bothHas, "spaces")).toBe("spaces");
    expect(embedChannel(bothHas, "services")).toBe("services");
  });
  it("without a request, or with an empty one, it is the front door: appointments when a service is bookable, else spaces", () => {
    expect(embedChannel(bothHas, null)).toBe("services");
    expect(embedChannel({ services: false, spaces: true }, null)).toBe("spaces");
    expect(embedChannel({ services: true, spaces: false }, "spaces")).toBe("services");
    expect(embedChannel({ services: false, spaces: true }, "services")).toBe("spaces");
  });
  it("nothing bookable: null (the route 404s)", () => {
    expect(embedChannel({ services: false, spaces: false }, "spaces")).toBeNull();
  });
});

describe("requestedEmbedChannel — what an embed URL asks for", () => {
  it("?channel= wins; a per-space or per-service deep link implies its channel (old snippets keep working)", () => {
    expect(requestedEmbedChannel({ channel: "spaces" })).toBe("spaces");
    expect(requestedEmbedChannel({ channel: "services", space: "o1" })).toBe("services");
    expect(requestedEmbedChannel({ space: "o1" })).toBe("spaces");
    expect(requestedEmbedChannel({ service: "s1" })).toBe("services");
    expect(requestedEmbedChannel({ space: "" })).toBeNull();
    expect(requestedEmbedChannel({})).toBeNull();
  });
});
