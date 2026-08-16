import { describe, it, expect } from "vitest";
import {
  TIME_OPTIONS,
  endOptions,
  parseTimeInput,
  formatTime,
  nextInterval,
  overlapsSiblings,
  hasOverlap,
} from "./time-options";

describe("TIME_OPTIONS", () => {
  it("covers the day in 15-minute steps", () => {
    expect(TIME_OPTIONS).toHaveLength(96);
    expect(TIME_OPTIONS[0]).toBe("00:00");
    expect(TIME_OPTIONS[35]).toBe("08:45");
    expect(TIME_OPTIONS[95]).toBe("23:45");
  });
});

describe("endOptions", () => {
  it("lists only times after start, terminated by 23:59", () => {
    const opts = endOptions("23:30");
    expect(opts).toEqual(["23:45", "23:59"]);
  });
  it("always offers 23:59 even after the last grid step", () => {
    expect(endOptions("23:45")).toEqual(["23:59"]);
  });
});

describe("parseTimeInput", () => {
  const cases: Array<[string, string | null]> = [
    ["9", "09:00"],
    ["17", "17:00"],
    ["9:15", "09:15"],
    ["915", "09:15"],
    ["0915", "09:15"],
    ["1730", "17:30"],
    ["9:15pm", "21:15"],
    ["9:15 PM", "21:15"],
    ["9 pm", "21:00"],
    ["12am", "00:00"],
    ["12:30 am", "00:30"],
    ["12pm", "12:00"],
    ["23:59", "23:59"],
    ["00:00", "00:00"],
    ["24:00", null],
    ["9:70", null],
    ["13pm", null],
    ["0am", null],
    ["", null],
    ["abc", null],
  ];
  for (const [raw, expected] of cases) {
    it(`parses ${JSON.stringify(raw)} → ${expected}`, () => {
      expect(parseTimeInput(raw)).toBe(expected);
    });
  }
});

describe("formatTime", () => {
  it("formats 12h for en-US", () => {
    expect(formatTime("09:00", "en-US")).toBe("9:00 AM");
    expect(formatTime("13:05", "en-US")).toBe("1:05 PM");
  });
  it("formats 24h for de-DE", () => {
    // If these literals differ on your ICU version (zero-padding varies),
    // the binding invariant is: 24h clock, no AM/PM. Verify that, then
    // update the literal to the actual output — note it in your report.
    expect(formatTime("09:00", "de-DE")).toBe("9:00");
    expect(formatTime("13:05", "de-DE")).toBe("13:05");
  });
});

describe("nextInterval", () => {
  it("defaults an empty day to 09:00–17:00", () => {
    expect(nextInterval([])).toEqual({ startTime: "09:00", endTime: "17:00" });
  });
  it("starts 1h after the last end, 4h long", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "13:00" }])).toEqual({
      startTime: "14:00",
      endTime: "18:00",
    });
  });
  it("clamps the end to 23:59", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "20:00" }])).toEqual({
      startTime: "21:00",
      endTime: "23:59",
    });
  });
  it("drops the 1h gap when it would not fit", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "23:00" }])).toEqual({
      startTime: "23:00",
      endTime: "23:59",
    });
  });
  it("returns null when nothing fits (last end past 23:44)", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "23:45" }])).toBeNull();
  });
  it("uses the max end across unsorted intervals", () => {
    expect(
      nextInterval([
        { startTime: "14:00", endTime: "18:00" },
        { startTime: "09:00", endTime: "13:00" },
      ]),
    ).toEqual({ startTime: "19:00", endTime: "23:00" });
  });
});

describe("overlapsSiblings", () => {
  const siblings = [
    { startTime: "09:00", endTime: "13:00" },
    { startTime: "14:00", endTime: "18:00" },
  ];
  it("rejects an overlap", () => {
    expect(overlapsSiblings({ startTime: "12:00", endTime: "14:30" }, siblings)).toBe(true);
  });
  it("allows touching", () => {
    expect(overlapsSiblings({ startTime: "13:00", endTime: "14:00" }, siblings)).toBe(false);
  });
  it("rejects containment", () => {
    expect(overlapsSiblings({ startTime: "10:00", endTime: "11:00" }, siblings)).toBe(true);
  });
});

describe("hasOverlap", () => {
  it("accepts sorted touching intervals", () => {
    expect(
      hasOverlap([
        { startTime: "09:00", endTime: "13:00" },
        { startTime: "13:00", endTime: "17:00" },
      ]),
    ).toBe(false);
  });
  it("catches containment past the immediate neighbor", () => {
    expect(
      hasOverlap([
        { startTime: "09:00", endTime: "18:00" },
        { startTime: "10:00", endTime: "11:00" },
        { startTime: "12:00", endTime: "13:00" },
      ]),
    ).toBe(true);
  });
  it("accepts empty and single", () => {
    expect(hasOverlap([])).toBe(false);
    expect(hasOverlap([{ startTime: "09:00", endTime: "17:00" }])).toBe(false);
  });
});
