import { describe, it, expect } from "vitest";
import { availabilityOwnerOf, ownerHref, resolveOwner } from "./availability-owner";

const ANNA = { id: "11111111-1111-4111-8111-111111111111", name: "Anna", color: "#f00" };
const BEN = { id: "22222222-2222-4222-8222-222222222222", name: "Ben", color: "#0f0" };
const ROOM = { id: "33333333-3333-4333-8333-333333333333", name: "Room A" };
const STUDIO = { id: "44444444-4444-4444-8444-444444444444", name: "Studio" };
const STALE = "99999999-9999-4999-8999-999999999999";

describe("resolveOwner (spec §3 — people and hourly spaces are one kind of owner)", () => {
  it("a listed ?staff= wins", () => {
    expect(resolveOwner({ staff: BEN.id }, [ANNA, BEN], [ROOM])).toEqual({ kind: "staff", ...BEN });
  });
  it("a listed ?space= wins when ?staff= is absent or unlisted", () => {
    expect(resolveOwner({ space: STUDIO.id }, [ANNA], [ROOM, STUDIO])).toEqual({ kind: "space", ...STUDIO });
    expect(resolveOwner({ staff: STALE, space: ROOM.id }, [ANNA], [ROOM])).toEqual({ kind: "space", ...ROOM });
  });
  it("both listed: the person wins", () => {
    expect(resolveOwner({ staff: ANNA.id, space: ROOM.id }, [ANNA], [ROOM])?.kind).toBe("staff");
  });
  it("no usable param: first person, else first space, else null", () => {
    expect(resolveOwner({}, [BEN, ANNA], [ROOM])).toEqual({ kind: "staff", ...BEN });
    expect(resolveOwner({ staff: STALE }, [], [STUDIO, ROOM])).toEqual({ kind: "space", ...STUDIO });
    expect(resolveOwner({ space: ROOM.id }, [], [])).toBeNull();
  });
  it("a malformed id never matches, even when a listed id equals the raw string", () => {
    expect(resolveOwner({ staff: "not-a-uuid" }, [BEN, { ...ANNA, id: "not-a-uuid" }], [])).toEqual({ kind: "staff", ...BEN });
    expect(resolveOwner({ space: "not-a-uuid" }, [], [STUDIO, { ...ROOM, id: "not-a-uuid" }])).toEqual({ kind: "space", ...STUDIO });
  });
  it("keeps only the fields the page needs off a wide row", () => {
    const wide = { ...ANNA, slug: "anna", email: null, active: true, sortOrder: 0, serviceIds: [] };
    expect(resolveOwner({}, [wide], [])).toEqual({ kind: "staff", id: ANNA.id, name: "Anna", color: "#f00" });
    const wideSpace = { ...ROOM, rangeMode: "hours", active: true, unitCount: 2 };
    expect(resolveOwner({}, [], [wideSpace])).toEqual({ kind: "space", id: ROOM.id, name: "Room A" });
  });
});

describe("ownerHref / availabilityOwnerOf", () => {
  it("builds the tab and edit links", () => {
    expect(ownerHref({ kind: "staff", id: ANNA.id })).toBe(`/availability?staff=${ANNA.id}`);
    expect(ownerHref({ kind: "space", id: ROOM.id })).toBe(`/availability?space=${ROOM.id}`);
  });
  it("maps to the editor's staffId XOR rentalOfferingId", () => {
    expect(availabilityOwnerOf({ kind: "staff", ...ANNA })).toEqual({ staffId: ANNA.id });
    expect(availabilityOwnerOf({ kind: "space", ...ROOM })).toEqual({ rentalOfferingId: ROOM.id });
  });
});
