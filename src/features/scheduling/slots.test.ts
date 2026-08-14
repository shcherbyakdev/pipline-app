import { describe, it, expect } from "vitest";
import { wallTimeToUtc, dateInZone, addDaysISO, computeSlots, type SlotInput } from "./slots";

const TZ = "Europe/Berlin";
// A Monday, well before any test slot.
const T0 = new Date("2027-02-01T00:00:00Z");

function input(over: Partial<SlotInput> = {}): SlotInput {
  return {
    service: {
      durationMin: 60,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minNoticeMin: 0,
      maxPerDay: null,
      bookingWindowDays: 365,
    },
    // Mon–Fri 09:00–17:00 (weekday 0 = Sunday).
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })),
    exceptions: [],
    busy: [],
    timeZone: TZ,
    now: T0,
    fromDate: "2027-02-01",
    days: 1,
    ...over,
  };
}

const iso = (d: Date) => d.toISOString();

describe("wallTimeToUtc", () => {
  it("converts Berlin winter time (UTC+1)", () => {
    expect(iso(wallTimeToUtc("2027-02-01", "09:00", TZ))).toBe("2027-02-01T08:00:00.000Z");
  });
  it("converts Berlin summer time (UTC+2)", () => {
    expect(iso(wallTimeToUtc("2027-07-01", "09:00", TZ))).toBe("2027-07-01T07:00:00.000Z");
  });
  it("handles the spring-forward day (EU DST 2027-03-28)", () => {
    // 09:00 local on the switch day is UTC+2 already.
    expect(iso(wallTimeToUtc("2027-03-28", "09:00", TZ))).toBe("2027-03-28T07:00:00.000Z");
  });
  it("handles the fall-back day (EU DST 2027-10-31)", () => {
    // 09:00 local after the switch is UTC+1 again.
    expect(iso(wallTimeToUtc("2027-10-31", "09:00", TZ))).toBe("2027-10-31T08:00:00.000Z");
  });
  it("passes UTC through untouched", () => {
    expect(iso(wallTimeToUtc("2027-02-01", "09:00", "UTC"))).toBe("2027-02-01T09:00:00.000Z");
  });
});

describe("dateInZone / addDaysISO", () => {
  it("maps a UTC instant to the org-local date", () => {
    // 23:30 UTC is already next-day in Berlin (UTC+1).
    expect(dateInZone(new Date("2027-02-01T23:30:00Z"), TZ)).toBe("2027-02-02");
  });
  it("adds days across a month boundary", () => {
    expect(addDaysISO("2027-02-27", 2)).toBe("2027-03-01");
  });
});

describe("computeSlots", () => {
  it("fills a full open day with duration-stepped slots", () => {
    const slots = computeSlots(input());
    // 09:00–17:00 Berlin winter = 08:00–16:00Z, 60-min slots → 8 slots.
    expect(slots.length).toBe(8);
    expect(iso(slots[0])).toBe("2027-02-01T08:00:00.000Z");
    expect(iso(slots[7])).toBe("2027-02-01T15:00:00.000Z");
  });

  it("returns nothing on a day without rules (Sunday)", () => {
    expect(computeSlots(input({ fromDate: "2027-02-07" }))).toEqual([]);
  });

  it("buffers shrink capacity and pad the step", () => {
    const slots = computeSlots(
      input({ service: { ...input().service, durationMin: 50, bufferBeforeMin: 5, bufferAfterMin: 5 } }),
    );
    // Block = 60 min → 8 blocks; slot starts at window+5min.
    expect(slots.length).toBe(8);
    expect(iso(slots[0])).toBe("2027-02-01T08:05:00.000Z");
  });

  it("min notice hides too-soon slots", () => {
    const slots = computeSlots(
      input({ now: new Date("2027-02-01T09:30:00Z"), service: { ...input().service, minNoticeMin: 120 } }),
    );
    // Earliest allowed start: 11:30Z → first grid slot 12:00Z.
    expect(iso(slots[0])).toBe("2027-02-01T12:00:00.000Z");
  });

  it("booking window caps the horizon", () => {
    const slots = computeSlots(
      input({ fromDate: "2027-02-08", days: 1, service: { ...input().service, bookingWindowDays: 3 } }),
    );
    expect(slots).toEqual([]);
  });

  it("busy intervals block overlapping slots (inflated by buffers)", () => {
    const slots = computeSlots(
      input({
        busy: [{ startsAt: new Date("2027-02-01T10:00:00Z"), endsAt: new Date("2027-02-01T11:00:00Z") }],
      }),
    );
    expect(slots.map(iso)).not.toContain("2027-02-01T10:00:00.000Z");
    expect(slots.length).toBe(7);
  });

  it("a closed exception empties the day", () => {
    const slots = computeSlots(
      input({ exceptions: [{ date: "2027-02-01", closed: true, startTime: null, endTime: null }] }),
    );
    expect(slots).toEqual([]);
  });

  it("an open exception REPLACES the weekday rules", () => {
    const slots = computeSlots(
      input({ exceptions: [{ date: "2027-02-01", closed: false, startTime: "13:00", endTime: "15:00" }] }),
    );
    expect(slots.length).toBe(2);
    expect(iso(slots[0])).toBe("2027-02-01T12:00:00.000Z");
  });

  it("maxPerDay counts existing busy starts on that org-local day", () => {
    const slots = computeSlots(
      input({
        service: { ...input().service, maxPerDay: 2 },
        busy: [
          { startsAt: new Date("2027-02-01T08:00:00Z"), endsAt: new Date("2027-02-01T09:00:00Z") },
          { startsAt: new Date("2027-02-01T09:00:00Z"), endsAt: new Date("2027-02-01T10:00:00Z") },
        ],
      }),
    );
    expect(slots).toEqual([]);
  });

  it("multi-day scan concatenates days in order", () => {
    const slots = computeSlots(input({ days: 3 }));
    // Mon+Tue+Wed × 8.
    expect(slots.length).toBe(24);
    expect(iso(slots[8])).toBe("2027-02-02T08:00:00.000Z");
  });

  it("split-shift rules produce two windows", () => {
    const slots = computeSlots(
      input({
        rules: [
          { weekday: 1, startTime: "09:00", endTime: "12:00" },
          { weekday: 1, startTime: "14:00", endTime: "17:00" },
        ],
      }),
    );
    expect(slots.length).toBe(6);
    expect(slots.map(iso)).not.toContain("2027-02-01T12:00:00.000Z");
  });

  it("slots are timezone-correct across DST inside one scan", () => {
    const slots = computeSlots(input({ fromDate: "2027-03-26", days: 4 })); // Fri..Mon over EU switch
    const friday = slots.filter((s) => dateInZone(s, TZ) === "2027-03-26");
    const monday = slots.filter((s) => dateInZone(s, TZ) === "2027-03-29");
    expect(iso(friday[0])).toBe("2027-03-26T08:00:00.000Z"); // UTC+1
    expect(iso(monday[0])).toBe("2027-03-29T07:00:00.000Z"); // UTC+2
  });
});
