import { describe, it, expect } from "vitest";
import { staysByLane } from "./timeline-layout";
import type { AdminBooking } from "@/features/scheduling/queries";

const b = (id: string, unit: string) => ({ id, rentalUnitId: unit } as unknown as AdminBooking);

describe("staysByLane (S6)", () => {
  it("puts a booking on its primary lane and on every placement lane", () => {
    const m = staysByLane([b("w", "whole"), b("a", "roomA")], [
      { bookingId: "w", unitId: "roomA", kind: "component" },
      { bookingId: "w", unitId: "roomB", kind: "component" },
      { bookingId: "a", unitId: "lamp1", kind: "equipment" },
    ]);
    expect(m.get("whole")!.map((x) => x.id)).toEqual(["w"]);
    expect(m.get("roomA")!.map((x) => x.id).sort()).toEqual(["a", "w"]);
    expect(m.get("roomB")!.map((x) => x.id)).toEqual(["w"]);
    expect(m.get("lamp1")!.map((x) => x.id)).toEqual(["a"]);
  });
  it("ignores placements whose booking is not in the feed", () => {
    expect(staysByLane([], [{ bookingId: "x", unitId: "u", kind: "component" }]).size).toBe(0);
  });
});
