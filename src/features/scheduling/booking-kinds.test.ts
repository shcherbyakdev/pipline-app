import { describe, it, expect } from "vitest";
import { canCreateWalkIn, defaultSelection, dragInitial, parseSelection, pickerLabel } from "./booking-kinds";

const services = [{ id: "s1" }, { id: "s2" }];
const hourly = { id: "h1", name: "Room", rangeMode: "hours" as const, slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 };
const nightly = { id: "n1", name: "Flat", rangeMode: "nights" as const };
const sel = { date: "2026-08-25", startMin: 600, endMin: 660 };

describe("pickerLabel", () => {
  it("names both, one, or the other", () => {
    expect(pickerLabel(true, true)).toBe("Space or service");
    expect(pickerLabel(true, false)).toBe("Service");
    expect(pickerLabel(false, true)).toBe("Space");
  });
});

describe("defaultSelection", () => {
  it("a prefilled id wins, then the first service, then the first space, then nothing", () => {
    expect(defaultSelection(services, [hourly], { kind: "service", serviceId: "s2", ...sel, dragEndMin: 660, windows: [] })).toEqual({ kind: "service", id: "s2" });
    expect(defaultSelection(services, [hourly], { kind: "space", offeringId: "h1" })).toEqual({ kind: "space", id: "h1" });
    expect(defaultSelection(services, [hourly])).toEqual({ kind: "service", id: "s1" });
    expect(defaultSelection([], [nightly, hourly])).toEqual({ kind: "space", id: "n1" });
    expect(defaultSelection([], [])).toBeNull();
  });
  it("ignores a prefilled id that is not in the lists", () => {
    expect(defaultSelection(services, [], { kind: "space", offeringId: "gone" })).toEqual({ kind: "service", id: "s1" });
  });
});

describe("parseSelection", () => {
  it("round-trips the select's option values", () => {
    expect(parseSelection("service:s1")).toEqual({ kind: "service", id: "s1" });
    expect(parseSelection("space:h1")).toEqual({ kind: "space", id: "h1" });
    expect(parseSelection("")).toBeNull();
    expect(parseSelection("other:x")).toBeNull();
  });
});

describe("dragInitial (spec §2 — drag on the week grid)", () => {
  it("any service ⇒ the appointment form with the drag's date, start and length", () => {
    expect(dragInitial(sel, services, [hourly], [])).toEqual({ kind: "service", date: "2026-08-25", startMin: 600, dragEndMin: 660, windows: [] });
  });
  it("no services but an hourly space ⇒ that space with the day prefilled", () => {
    expect(dragInitial(sel, [], [nightly, hourly], [])).toEqual({ kind: "space", offeringId: "h1", date: "2026-08-25" });
  });
  it("nights-only, no services ⇒ nothing to create from a drag", () => {
    expect(dragInitial(sel, [], [nightly], [])).toBeNull();
  });
});

describe("canCreateWalkIn", () => {
  it("true with any service or space, false with neither", () => {
    expect(canCreateWalkIn(services, [])).toBe(true);
    expect(canCreateWalkIn([], [nightly])).toBe(true);
    expect(canCreateWalkIn([], [])).toBe(false);
  });
});
