import { describe, it, expect } from "vitest";
import { enTranslator } from "@/i18n/test-translator";
import {
  laneLayout,
  stayInterval,
  occupiedRange,
  detectConflicts,
  conflictSummary,
  labelDensity,
  continuationLabels,
  stayPhase,
  stayLengthLabel,
  stayInWindow,
  hourlyByDay,
  monthBands,
  windowLabel,
  parseDays,
  shiftDays,
  timelineStart,
} from "./timeline-layout";
import { windowDays } from "./timeline-geometry";

const TZ = "Europe/Berlin";
const W = "2027-05-01"; // window start (a Saturday)
// CEST: 15:00 local = 13:00Z, 11:00 local = 09:00Z
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+02:00`);
const stay = (id: string, from: string, to: string, name = id) => ({
  id, clientName: name, startsAt: at(from, "15:00"), endsAt: at(to, "11:00"),
});
const dayStay = (id: string, from: string, to: string, name = id) => ({
  id, clientName: name, startsAt: at(from, "09:00"), endsAt: at(to, "18:00"),
});
const hourly = (id: string, date: string, from: string, to: string, name = id) => ({
  id, clientName: name, startsAt: at(date, from), endsAt: at(date, to),
});

describe("stayInterval (half-open column intervals; nights hand over mid-cell)", () => {
  it("nights: check-in afternoon to check-out morning", () => {
    expect(stayInterval(stay("a", "2027-05-03", "2027-05-06"), "nights", TZ, W)).toEqual({ from: 2.5, to: 5.5 });
  });
  it("days: whole cells, return day included", () => {
    expect(stayInterval(dayStay("a", "2027-05-03", "2027-05-05"), "days", TZ, W)).toEqual({ from: 2, to: 5 });
  });
  it("hours: the fraction of the day", () => {
    expect(stayInterval(hourly("a", "2027-05-03", "12:00", "18:00"), "hours", TZ, W)).toEqual({ from: 2.5, to: 2.75 });
  });
  it("a stay before the window has negative columns — the layout does not care", () => {
    expect(stayInterval(stay("a", "2027-04-28", "2027-05-02"), "nights", TZ, W)).toEqual({ from: -2.5, to: 1.5 });
  });
});

describe("laneLayout (greedy sub-rows for whatever overlaps)", () => {
  it("nothing overlapping ⇒ one row", () => {
    const { rows, rowCount } = laneLayout([
      { id: "a", from: 0.5, to: 2.5 },
      { id: "b", from: 2.5, to: 4.5 }, // back-to-back nights share the cell, not the row
      { id: "c", from: 6, to: 8 },
    ]);
    expect([...rows.entries()]).toEqual([["a", 0], ["b", 0], ["c", 0]]);
    expect(rowCount).toBe(1);
  });
  it("overlaps stack, earliest first, lowest free row wins", () => {
    const { rows, rowCount } = laneLayout([
      { id: "late", from: 3, to: 5 },
      { id: "a", from: 0.5, to: 4 },
      { id: "b", from: 1, to: 2 },
      { id: "c", from: 4.5, to: 6 },
    ]);
    expect(rows.get("a")).toBe(0);
    expect(rows.get("b")).toBe(1);
    expect(rows.get("late")).toBe(1); // b ended at 2, so row 1 is free again
    expect(rows.get("c")).toBe(0);
    expect(rowCount).toBe(2);
  });
  it("empty lane ⇒ one empty row", () => {
    expect(laneLayout([])).toEqual({ rows: new Map(), rowCount: 1 });
  });
});

describe("occupiedRange (inclusive org-local dates a stay holds)", () => {
  it("nights end the day before checkout; days include the return; hours are their date", () => {
    expect(occupiedRange(stay("a", "2027-05-03", "2027-05-06"), "nights", TZ)).toEqual({ start: "2027-05-03", end: "2027-05-05" });
    expect(occupiedRange(dayStay("a", "2027-05-03", "2027-05-05"), "days", TZ)).toEqual({ start: "2027-05-03", end: "2027-05-05" });
    expect(occupiedRange(hourly("a", "2027-05-03", "12:00", "18:00"), "hours", TZ)).toEqual({ start: "2027-05-03", end: "2027-05-03" });
  });
});

describe("detectConflicts (what the DB guard cannot refuse after the fact)", () => {
  const bo = (id: string, startDate: string, endDate: string, reason: string | null = null) => ({ id, startDate, endDate, reason });

  it("back-to-back nights are not a conflict", () => {
    const m = detectConflicts([stay("a", "2027-05-03", "2027-05-06"), stay("b", "2027-05-06", "2027-05-08")], [], "nights", 0, TZ);
    expect(m.size).toBe(0);
  });
  it("a blackout over an occupied day flags the stay, naming the blackout", () => {
    const m = detectConflicts([stay("a", "2027-05-03", "2027-05-06", "Anna")], [bo("x", "2027-05-05", "2027-05-07", "Painting")], "nights", 0, TZ);
    expect(m.get("a")).toEqual([{ kind: "blackout", blackoutId: "x", startDate: "2027-05-05", endDate: "2027-05-07", reason: "Painting" }]);
  });
  it("a blackout that only touches the checkout day (nights) is not a conflict", () => {
    const m = detectConflicts([stay("a", "2027-05-03", "2027-05-06")], [bo("x", "2027-05-06", "2027-05-06")], "nights", 0, TZ);
    expect(m.size).toBe(0);
  });
  it("a turnover tail running into the next check-in flags the LATER stay, naming the earlier guest", () => {
    // a checks out 05-06 (tail = 05-06..05-07 with turnover 2); b checks in 05-07
    const m = detectConflicts([stay("a", "2027-05-03", "2027-05-06", "Anna"), stay("b", "2027-05-07", "2027-05-09", "Ben")], [], "nights", 2, TZ);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toEqual([{ kind: "turnover", withId: "a", withName: "Anna" }]);
    // with turnover 1 the tail is just 05-06 — b is clear
    expect(detectConflicts([stay("a", "2027-05-03", "2027-05-06"), stay("b", "2027-05-07", "2027-05-09")], [], "nights", 1, TZ).size).toBe(0);
  });
  it("days: the tail starts after the return day", () => {
    const m = detectConflicts([dayStay("a", "2027-05-03", "2027-05-05", "Anna"), dayStay("b", "2027-05-06", "2027-05-06", "Ben")], [], "days", 1, TZ);
    expect(m.get("b")).toEqual([{ kind: "turnover", withId: "a", withName: "Anna" }]);
  });
  it("two stays holding the same day are an overlap on both", () => {
    const m = detectConflicts([stay("a", "2027-05-03", "2027-05-06", "Anna"), stay("b", "2027-05-05", "2027-05-08", "Ben")], [], "nights", 0, TZ);
    expect(m.get("a")).toEqual([{ kind: "overlap", withId: "b", withName: "Ben" }]);
    expect(m.get("b")).toEqual([{ kind: "overlap", withId: "a", withName: "Anna" }]);
  });
  it("hours: overlap is by clock time, adjacency is fine, a blackout day flags", () => {
    const m = detectConflicts(
      [hourly("a", "2027-05-03", "10:00", "12:00", "Anna"), hourly("b", "2027-05-03", "11:00", "13:00", "Ben"), hourly("c", "2027-05-03", "13:00", "14:00", "Cy")],
      [bo("x", "2027-05-03", "2027-05-03", "Closed")],
      "hours", 0, TZ,
    );
    expect(m.get("a")).toEqual([{ kind: "overlap", withId: "b", withName: "Ben" }, { kind: "blackout", blackoutId: "x", startDate: "2027-05-03", endDate: "2027-05-03", reason: "Closed" }]);
    expect(m.get("c")).toEqual([{ kind: "blackout", blackoutId: "x", startDate: "2027-05-03", endDate: "2027-05-03", reason: "Closed" }]);
  });
  it("conflictSummary counts stays with any conflict and points at the earliest", () => {
    const m = detectConflicts([stay("b", "2027-05-10", "2027-05-12"), stay("a", "2027-05-03", "2027-05-06")], [bo("x", "2027-05-04", "2027-05-04"), bo("y", "2027-05-11", "2027-05-11")], "nights", 0, TZ);
    expect(conflictSummary(m, [stay("b", "2027-05-10", "2027-05-12"), stay("a", "2027-05-03", "2027-05-06")])).toEqual({ count: 2, firstId: "a" });
    expect(conflictSummary(new Map(), [])).toEqual({ count: 0, firstId: null });
  });
});

describe("labelDensity (what fits in the bar)", () => {
  it("wide ⇒ name + length, medium ⇒ name, narrow ⇒ initials", () => {
    expect(labelDensity(200)).toBe("full");
    expect(labelDensity(160)).toBe("full");
    expect(labelDensity(159)).toBe("name");
    expect(labelDensity(48)).toBe("name");
    expect(labelDensity(47)).toBe("initials");
  });
});

describe("continuationLabels (a bar the window cuts says where it goes)", () => {
  it("names the real check-in / check-out beyond the edge", () => {
    const b = stay("a", "2027-04-20", "2027-06-15");
    expect(continuationLabels(b, TZ, { clippedLeft: true, clippedRight: true }, "en-GB")).toEqual({ left: "20 Apr", right: "15 Jun" });
    expect(continuationLabels(b, TZ, { clippedLeft: false, clippedRight: false }, "en-GB")).toEqual({ left: null, right: null });
  });
});

describe("stayPhase", () => {
  const b = stay("a", "2027-05-03", "2027-05-06");
  it("past / current / upcoming by the clock", () => {
    expect(stayPhase(b, at("2027-05-06", "12:00"))).toBe("past");
    expect(stayPhase(b, at("2027-05-04", "12:00"))).toBe("current");
    expect(stayPhase(b, at("2027-05-01", "12:00"))).toBe("upcoming");
  });
});

describe("stayLengthLabel", () => {
  it("nights, days, hours", () => {
    expect(stayLengthLabel(stay("a", "2027-05-03", "2027-05-04"), "nights", TZ, enTranslator("public.units"))).toBe("1 night");
    expect(stayLengthLabel(stay("a", "2027-05-03", "2027-05-06"), "nights", TZ, enTranslator("public.units"))).toBe("3 nights");
    expect(stayLengthLabel(dayStay("a", "2027-05-03", "2027-05-03"), "days", TZ, enTranslator("public.units"))).toBe("1 day");
    expect(stayLengthLabel(dayStay("a", "2027-05-03", "2027-05-05"), "days", TZ, enTranslator("public.units"))).toBe("3 days");
    expect(stayLengthLabel(hourly("a", "2027-05-03", "10:00", "11:30"), "hours", TZ, enTranslator("public.units"))).toBe("1 h 30 min");
  });
});

describe("hourlyByDay (chips per window column, in start order)", () => {
  it("groups by org-local day index, drops bookings outside the window", () => {
    const m = hourlyByDay(
      [hourly("late", "2027-05-03", "14:00", "15:00"), hourly("early", "2027-05-03", "09:00", "10:00"), hourly("out", "2027-06-03", "09:00", "10:00"), hourly("b", "2027-05-10", "09:00", "10:00")],
      TZ, W, 28,
    );
    expect([...m.keys()]).toEqual([2, 9]);
    expect(m.get(2)!.map((b) => b.id)).toEqual(["early", "late"]);
  });
});

describe("monthBands (the reference's month strip over the day columns)", () => {
  it("one band per month with its span", () => {
    expect(monthBands(windowDays("2027-04-26", 14), "en-GB")).toEqual([
      { label: "April 2027", colStart: 0, colSpan: 5 },
      { label: "May 2027", colStart: 5, colSpan: 9 },
    ]);
    expect(monthBands(windowDays("2027-05-01", 14), "en-GB")).toEqual([{ label: "May 2027", colStart: 0, colSpan: 14 }]);
  });
});

describe("windowLabel", () => {
  it("day-month – day-month year; the year twice only across a year boundary", () => {
    expect(windowLabel("2027-05-01", 28, "en-GB")).toBe("1 May – 28 May 2027");
    expect(windowLabel("2027-12-20", 28, "en-GB")).toBe("20 Dec 2027 – 16 Jan 2028");
  });
});

describe("stayInWindow (what the banner may count: only what the chart draws)", () => {
  it("nights/days: a bar or a turnover tail inside the window; hours: the day itself", () => {
    // checked out the day before the window, turnover 2 ⇒ the tail's second day is in
    expect(stayInWindow(stay("a", "2027-04-27", "2027-04-30"), "nights", TZ, 2, W, 28)).toBe(true);
    // checked out two days before with turnover 1 ⇒ nothing drawn
    expect(stayInWindow(stay("a", "2027-04-27", "2027-04-29"), "nights", TZ, 1, W, 28)).toBe(false);
    expect(stayInWindow(stay("a", "2027-05-03", "2027-05-06"), "nights", TZ, 0, W, 28)).toBe(true);
    expect(stayInWindow(dayStay("a", "2027-06-01", "2027-06-02"), "days", TZ, 0, W, 28)).toBe(false);
    expect(stayInWindow(hourly("a", "2027-05-03", "10:00", "11:00"), "hours", TZ, 0, W, 28)).toBe(true);
    expect(stayInWindow(hourly("a", "2027-04-30", "10:00", "11:00"), "hours", TZ, 0, W, 28)).toBe(false);
  });
  it("conflictSummary breaks a start-time tie by id, so Show is deterministic", () => {
    const m = new Map([["b", []], ["a", []]]) as Map<string, never[]>;
    expect(conflictSummary(m, [stay("b", "2027-05-03", "2027-05-06"), stay("a", "2027-05-03", "2027-05-06")]).firstId).toBe("a");
  });
});

describe("zoom", () => {
  it("parseDays accepts the three zooms and defaults to four weeks", () => {
    expect(parseDays("14")).toBe(14);
    expect(parseDays("28")).toBe(28);
    expect(parseDays("56")).toBe(56);
    expect(parseDays("21")).toBe(28);
    expect(parseDays(undefined)).toBe(28);
  });
  it("arrows shift by half a window; the window opens a little before today", () => {
    expect(shiftDays(14)).toBe(7);
    expect(shiftDays(28)).toBe(14);
    expect(timelineStart("2027-05-10", 14)).toBe("2027-05-08");
    expect(timelineStart("2027-05-10", 28)).toBe("2027-05-03");
    expect(timelineStart("2027-05-10", 56)).toBe("2027-05-03");
  });
});

// ---------- v3: density, free units, drag maths

import {
  headerDensity,
  showsDayNumber,
  takenColumns,
  freeUnitsPerDay,
  dragDelta,
  movedRange,
  movedInstant,
  moveConflict,
  chipDensity,
} from "./timeline-layout";

describe("headerDensity (what a day cell can say at a column width)", () => {
  it("weekday+number from 44px, number from 24px, only Mondays and today below", () => {
    expect(headerDensity(60)).toBe("weekday");
    expect(headerDensity(44)).toBe("weekday");
    expect(headerDensity(30)).toBe("number");
    expect(headerDensity(16)).toBe("sparse");
  });
  it("sparse shows Mondays and today, nothing else", () => {
    // 2027-05-03 is a Monday
    expect(showsDayNumber("2027-05-03", "sparse", null)).toBe(true);
    expect(showsDayNumber("2027-05-04", "sparse", null)).toBe(false);
    expect(showsDayNumber("2027-05-04", "sparse", "2027-05-04")).toBe(true);
    expect(showsDayNumber("2027-05-04", "number", null)).toBe(true);
  });
});

describe("takenColumns / freeUnitsPerDay (the hotel board's free-rooms row)", () => {
  it("nights: occupied nights plus the turnover tail; blackouts too; clamped to the window", () => {
    const taken = takenColumns(
      [stay("a", "2027-05-02", "2027-05-04")],
      [{ startDate: "2027-04-30", endDate: "2027-05-01" }],
      "nights",
      1,
      TZ,
      W,
      7,
    );
    // blackout on 1 May (col 0); nights 2,3 May (cols 1,2); tail on checkout day 4 May (col 3)
    expect([...taken].sort()).toEqual([0, 1, 2, 3]);
  });
  it("days: the return day is held and the tail follows it", () => {
    const taken = takenColumns([dayStay("a", "2027-05-02", "2027-05-03")], [], "days", 1, TZ, W, 7);
    expect([...taken].sort()).toEqual([1, 2, 3]);
  });
  it("free units per day is the units nobody holds", () => {
    const free = freeUnitsPerDay([new Set([0, 1]), new Set([1]), new Set()], 3);
    expect(free).toEqual([2, 1, 3]);
  });
});

describe("dragDelta (pixels to whole days and rows)", () => {
  it("rounds to the nearest column and lane", () => {
    expect(dragDelta(-45, 10, 40, 36)).toEqual({ days: -1, rows: 0 });
    expect(dragDelta(61, 50, 40, 36)).toEqual({ days: 2, rows: 1 });
    expect(dragDelta(0, 0, 0, 36)).toEqual({ days: 0, rows: 0 });
  });
});

describe("movedRange (where a bar lands after a move or an edge drag)", () => {
  const b = stay("a", "2027-05-02", "2027-05-04");
  it("move shifts both ends", () => {
    expect(movedRange(b, "nights", TZ, 2, "move")).toEqual({ startDate: "2027-05-04", endDate: "2027-05-06" });
  });
  it("edge drags keep at least one night / one day", () => {
    expect(movedRange(b, "nights", TZ, 1, "start")).toEqual({ startDate: "2027-05-03", endDate: "2027-05-04" });
    expect(movedRange(b, "nights", TZ, 2, "start")).toBeNull();
    expect(movedRange(b, "nights", TZ, -1, "end")).toEqual({ startDate: "2027-05-02", endDate: "2027-05-03" });
    expect(movedRange(b, "nights", TZ, -2, "end")).toBeNull();
    const d = dayStay("d", "2027-05-02", "2027-05-02");
    expect(movedRange(d, "days", TZ, 0, "end")).toEqual({ startDate: "2027-05-02", endDate: "2027-05-02" });
    expect(movedRange(d, "days", TZ, -1, "end")).toBeNull();
  });
  it("hours: the same wall time on the new day", () => {
    const h = hourly("h", "2027-05-02", "10:00", "12:00");
    expect(movedInstant(h, TZ, 3).toISOString()).toBe(at("2027-05-05", "10:00").toISOString());
  });
});

describe("moveConflict (live validation while dragging: the same rules as detectConflicts)", () => {
  const others = [stay("x", "2027-05-05", "2027-05-08", "X")];
  const cand = (from: string, to: string) => ({ startsAt: at(from, "15:00"), endsAt: at(to, "11:00") });
  it("a free run is fine; touching X's nights is hard; landing on X's turnover tail is a turnover clash", () => {
    expect(moveConflict(cand("2027-05-01", "2027-05-03"), others, [], "nights", 1, TZ)).toBeNull();
    expect(moveConflict(cand("2027-05-04", "2027-05-06"), others, [], "nights", 1, TZ)).toBe("hard");
    expect(moveConflict(cand("2027-05-08", "2027-05-10"), others, [], "nights", 1, TZ)).toBe("turnover");
  });
  it("the candidate's own tail running into a later check-in counts too", () => {
    expect(moveConflict(cand("2027-05-02", "2027-05-05"), others, [], "nights", 1, TZ)).toBe("turnover");
  });
  it("a blackout under the candidate is hard", () => {
    const bl = [{ id: "b", startDate: "2027-05-02", endDate: "2027-05-02", reason: "paint" }] as const;
    expect(moveConflict(cand("2027-05-01", "2027-05-03"), [], bl, "nights", 0, TZ)).toBe("hard");
  });
});

describe("chipDensity (what an hourly chip can hold)", () => {
  it("time + name from 96px, time from 56px, the hour from 28px, nothing below", () => {
    expect(chipDensity(120)).toBe("full");
    expect(chipDensity(60)).toBe("time");
    expect(chipDensity(30)).toBe("hour");
    expect(chipDensity(20)).toBe("none");
  });
});
