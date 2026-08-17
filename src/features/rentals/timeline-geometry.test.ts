import { it, expect } from "vitest";
import { barSpan, turnoverSpan, blackoutSpan, windowDays, timelineDefaultStart } from "./timeline-geometry";

const TZ = "Europe/Berlin";

it("nights: bar spans check-in..checkout inclusive with a half end", () => {
  // check-in 05-03 15:00 CEST (13:00Z) → checkout 05-06 11:00 (09:00Z)
  expect(barSpan({ startsAt: new Date("2027-05-03T13:00:00Z"), endsAt: new Date("2027-05-06T09:00:00Z") }, "nights", TZ, "2027-05-01", 21))
    .toEqual({ colStart: 2, colSpan: 4, halfEnd: true, clippedLeft: false, clippedRight: false });
});
it("days: pickup..return inclusive, full end", () => {
  expect(barSpan({ startsAt: new Date("2027-05-03T07:00:00Z"), endsAt: new Date("2027-05-05T16:00:00Z") }, "days", TZ, "2027-05-01", 21))
    .toEqual({ colStart: 2, colSpan: 3, halfEnd: false, clippedLeft: false, clippedRight: false });
});
it("clips at both edges and returns null when outside", () => {
  expect(barSpan({ startsAt: new Date("2027-04-28T13:00:00Z"), endsAt: new Date("2027-05-03T09:00:00Z") }, "nights", TZ, "2027-05-01", 21))
    .toEqual({ colStart: 0, colSpan: 3, halfEnd: true, clippedLeft: true, clippedRight: false });
  expect(barSpan({ startsAt: new Date("2027-05-20T13:00:00Z"), endsAt: new Date("2027-05-25T09:00:00Z") }, "nights", TZ, "2027-05-01", 21))
    .toEqual({ colStart: 19, colSpan: 2, halfEnd: false, clippedLeft: false, clippedRight: true }); // half end hidden when clipped
  expect(barSpan({ startsAt: new Date("2027-06-01T13:00:00Z"), endsAt: new Date("2027-06-03T09:00:00Z") }, "nights", TZ, "2027-05-01", 21)).toBeNull();
});
it("turnover tail follows the last occupied day", () => {
  const bar = barSpan({ startsAt: new Date("2027-05-03T13:00:00Z"), endsAt: new Date("2027-05-06T09:00:00Z") }, "nights", TZ, "2027-05-01", 21)!;
  expect(turnoverSpan(bar, "nights", 1, 21)).toEqual({ colStart: 5, colSpan: 1 }); // 05-06 is the tail day (checkout day, occupied by turnover)
  const dbar = barSpan({ startsAt: new Date("2027-05-03T07:00:00Z"), endsAt: new Date("2027-05-05T16:00:00Z") }, "days", TZ, "2027-05-01", 21)!;
  expect(turnoverSpan(dbar, "days", 2, 21)).toEqual({ colStart: 5, colSpan: 2 });
  expect(turnoverSpan(bar, "nights", 0, 21)).toBeNull();
});
it("blackoutSpan clips inclusive dates", () => {
  expect(blackoutSpan("2027-04-30", "2027-05-02", "2027-05-01", 21)).toEqual({ colStart: 0, colSpan: 2 });
  expect(blackoutSpan("2027-05-20", "2027-05-30", "2027-05-01", 21)).toEqual({ colStart: 19, colSpan: 2 });
  expect(blackoutSpan("2027-06-01", "2027-06-02", "2027-05-01", 21)).toBeNull();
});
it("windowDays / timelineDefaultStart", () => {
  expect(windowDays("2027-05-01", 3)).toEqual(["2027-05-01", "2027-05-02", "2027-05-03"]);
  expect(timelineDefaultStart("2027-05-10")).toBe("2027-05-08");
});
it("DST: a stay across 2027-10-31 keeps whole-day columns", () => {
  expect(barSpan({ startsAt: new Date("2027-10-30T13:00:00Z"), endsAt: new Date("2027-11-02T10:00:00Z") }, "nights", TZ, "2027-10-25", 21))
    .toEqual({ colStart: 5, colSpan: 4, halfEnd: true, clippedLeft: false, clippedRight: false });
});
