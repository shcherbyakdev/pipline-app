import { describe, it, expect } from "vitest";
import {
  timeToMin, minToTime, zonedParts, mondayOf, hourRange, snap15,
  closedIntervals, serviceAccent,
} from "./calendar-geometry";

describe("calendar-geometry", () => {
  it("timeToMin/minToTime round-trip", () => {
    expect(timeToMin("09:30")).toBe(570);
    expect(minToTime(570)).toBe("09:30");
    expect(minToTime(65)).toBe("01:05");
  });

  it("zonedParts gives local date and minutes-since-midnight", () => {
    const p = zonedParts(new Date("2027-05-04T12:30:00Z"), "Europe/Berlin"); // UTC+2 in May
    expect(p).toEqual({ date: "2027-05-04", minutes: 14 * 60 + 30 });
  });

  it("mondayOf returns the Monday of the date's week", () => {
    expect(mondayOf("2027-05-06")).toBe("2027-05-03"); // Thu → Mon
    expect(mondayOf("2027-05-03")).toBe("2027-05-03"); // Mon → itself
    expect(mondayOf("2027-05-09")).toBe("2027-05-03"); // Sun → preceding Mon
  });

  it("hourRange pads the union by 1h and clamps", () => {
    expect(hourRange([[{ startTime: "09:00", endTime: "17:00" }], []]))
      .toEqual({ startHour: 8, endHour: 18 });
    expect(hourRange([[{ startTime: "00:30", endTime: "23:45" }]]))
      .toEqual({ startHour: 0, endHour: 24 });
  });

  it("hourRange falls back to 8–18 when nothing is open", () => {
    expect(hourRange([[], []])).toEqual({ startHour: 8, endHour: 18 });
  });

  it("hourRange widens the start for an early booking outside open hours", () => {
    // Window is 9–17; a booking starting at 06:30 must pull startHour down.
    expect(
      hourRange([[{ startTime: "09:00", endTime: "17:00" }]], [{ startMin: 390, endMin: 450 }]),
    ).toEqual({ startHour: 5, endHour: 18 });
  });

  it("hourRange widens the end for a late booking outside open hours", () => {
    // Window is 9–17; a booking ending at 21:15 must push endHour up.
    expect(
      hourRange([[{ startTime: "09:00", endTime: "17:00" }]], [{ startMin: 1200, endMin: 1275 }]),
    ).toEqual({ startHour: 8, endHour: 23 });
  });

  it("hourRange is determined by bookings alone when there are no windows", () => {
    expect(hourRange([[], []], [{ startMin: 600, endMin: 660 }])).toEqual({
      startHour: 9,
      endHour: 12,
    });
  });

  it("hourRange clamps to 0/24 even when booking spans overshoot", () => {
    expect(hourRange([[]], [{ startMin: 10, endMin: 1430 }])).toEqual({
      startHour: 0,
      endHour: 24,
    });
  });

  it("snap15 floors to the grid", () => {
    expect(snap15(547)).toBe(540);
    expect(snap15(540)).toBe(540);
  });

  it("closedIntervals is the complement of windows within the range", () => {
    expect(closedIntervals([{ startTime: "09:00", endTime: "12:00" }], 8, 14)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 720, endMin: 840 },
    ]);
    expect(closedIntervals([], 8, 10)).toEqual([{ startMin: 480, endMin: 600 }]);
  });

  it("serviceAccent is stable and hsl-formatted", () => {
    const a = serviceAccent("3f8b1c2e-0000-4000-8000-000000000001");
    expect(a).toBe(serviceAccent("3f8b1c2e-0000-4000-8000-000000000001"));
    expect(a).toMatch(/^hsl\(/);
  });
});
