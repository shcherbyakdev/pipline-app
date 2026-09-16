import { describe, it, expect } from "vitest";
import { narrowCatalogue, parseIds } from "./narrow-catalogue";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const services = [{ id: A }, { id: B }];
const offerings = [{ id: C }];
const anna = { id: "p1" };
const ben = { id: "p2" };
const input = { services, offerings, staff: [anna, ben], serviceStaffIds: { [A]: ["p1"], [B]: ["p1", "p2"] } };

describe("parseIds (?service= / ?space=, one or more, comma-separated)", () => {
  it("one id, several ids; non-uuids are dropped", () => {
    expect(parseIds(A)).toEqual([A]);
    expect(parseIds(`${A},${B}`)).toEqual([A, B]);
    expect(parseIds(`${A},preview-service,`)).toEqual([A]);
  });
  it("a repeated key or absence names nothing", () => {
    expect(parseIds([A, B])).toEqual([]);
    expect(parseIds(undefined)).toEqual([]);
  });
});

describe("narrowCatalogue (spec 2026-09-16 — a link shows exactly what it names)", () => {
  it("nothing named: the whole catalogue, nothing pre-picked", () => {
    expect(narrowCatalogue(input, {})).toEqual({ services, offerings, staff: [anna, ben], initialServiceId: null, initialOfferingId: null });
  });
  it("one service: only it, opened straight away; only the people who offer it", () => {
    const out = narrowCatalogue(input, { services: [A] });
    expect(out.services).toEqual([{ id: A }]);
    expect(out.staff).toEqual([anna]);
    expect(out.initialServiceId).toBe(A);
    expect(out.offerings).toEqual(offerings);
  });
  it("several services: those, in catalogue order, and the visitor chooses", () => {
    const out = narrowCatalogue(input, { services: [B, A] });
    expect(out.services.map((s) => s.id)).toEqual([A, B]);
    expect(out.staff).toEqual([anna, ben]);
    expect(out.initialServiceId).toBeNull();
  });
  it("one space: only it, opened straight away", () => {
    const out = narrowCatalogue(input, { spaces: [C] });
    expect(out.offerings).toEqual(offerings);
    expect(out.initialOfferingId).toBe(C);
    expect(out.services).toEqual(services);
  });
  it("ids the catalogue doesn't list are dropped; none left ⇒ the whole page", () => {
    const stale = "44444444-4444-4444-8444-444444444444";
    expect(narrowCatalogue(input, { services: [stale, A] }).services).toEqual([{ id: A }]);
    const none = narrowCatalogue(input, { services: [stale], spaces: [A] });
    expect(none.services).toEqual(services);
    expect(none.offerings).toEqual(offerings);
    expect(none.staff).toEqual([anna, ben]);
    expect(none.initialServiceId).toBeNull();
    expect(none.initialOfferingId).toBeNull();
  });
});
