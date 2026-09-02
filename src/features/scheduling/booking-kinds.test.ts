import { describe, it, expect } from "vitest";
import { canCreateWalkIn, defaultSelection, defaultSlotLength, dragInitial, parseSelection, pickerLabel } from "./booking-kinds";

const services = [{ id: "s1" }, { id: "s2" }];
const hourly = { id: "h1", name: "Room", rangeMode: "hours" as const, slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 };
const nightly = { id: "n1", name: "Flat", rangeMode: "nights" as const };
const sel = { date: "2026-08-25", startMin: 600, endMin: 660 };

describe("pickerLabel", () => {
  it("names both, one, or the other", () => {
    expect(pickerLabel(true, true)).toBe("spaces.pickerBoth");
    expect(pickerLabel(true, false)).toBe("appointments.field");
    expect(pickerLabel(false, true)).toBe("spaces.field");
  });
});

describe("defaultSelection", () => {
  it("a prefilled id wins, then the first service, then the first space, then nothing", () => {
    expect(defaultSelection(services, [hourly], { kind: "service", serviceId: "s2", ...sel, dragEndMin: 660, dragged: true, windows: [] })).toEqual({ kind: "service", id: "s2" });
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
    expect(dragInitial(sel, services, [hourly], [])).toEqual({ kind: "service", date: "2026-08-25", startMin: 600, dragEndMin: 660, dragged: true, windows: [] });
  });
  it("a click (dragged: false) carries the flag so the form follows the picked service's length", () => {
    expect(dragInitial({ ...sel, dragged: false }, services, [hourly], [])).toEqual({ kind: "service", date: "2026-08-25", startMin: 600, dragEndMin: 660, dragged: false, windows: [] });
  });
  it("no services but an hourly space ⇒ that space with the day prefilled", () => {
    expect(dragInitial(sel, [], [nightly, hourly], [])).toEqual({ kind: "space", offeringId: "h1", date: "2026-08-25" });
  });
  it("nights-only, no services ⇒ nothing to create from a drag", () => {
    expect(dragInitial(sel, [], [nightly], [])).toBeNull();
  });
  it("a preferred space (the week's space scope) wins over the org's services", () => {
    expect(dragInitial(sel, services, [nightly, hourly], [], "n1")).toEqual({ kind: "space", offeringId: "n1", date: "2026-08-25" });
  });
});

describe("defaultSlotLength", () => {
  it("first service's length, else the first hourly space's minimum, else an hour", () => {
    expect(defaultSlotLength([{ durationMin: 45 }], [hourly])).toBe(45);
    expect(defaultSlotLength([], [nightly, hourly])).toBe(60);
    expect(defaultSlotLength([], [{ ...hourly, minDurationMin: 90 }])).toBe(90);
    expect(defaultSlotLength([], [nightly])).toBe(60);
  });
});

describe("canCreateWalkIn", () => {
  it("true with any service or space, false with neither", () => {
    expect(canCreateWalkIn(services, [])).toBe(true);
    expect(canCreateWalkIn([], [nightly])).toBe(true);
    expect(canCreateWalkIn([], [])).toBe(false);
  });
});
