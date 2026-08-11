import { describe, it, expect } from "vitest";
import { rearmDue, decideRearm, stageDueState } from "./core";

// value_date is a calendar date (YYYY-MM-DD); the core parses it as UTC
// midnight. All fake clocks below are UTC instants.
const at = (iso: string) => new Date(iso);

describe("rearmDue", () => {
  it("is due exactly lead-days before expiry", () => {
    // expiry 2026-10-01, lead 30 → window opens 2026-09-01T00:00:00Z
    expect(rearmDue("2026-10-01", 30, at("2026-09-01T00:00:00Z"))).toBe(true);
  });
  it("is not due one ms before the window opens", () => {
    expect(rearmDue("2026-10-01", 30, at("2026-08-31T23:59:59.999Z"))).toBe(false);
  });
  it("stays due after the expiry has passed (lapse is still outstanding work)", () => {
    expect(rearmDue("2026-10-01", 30, at("2026-11-15T12:00:00Z"))).toBe(true);
  });
  it("handles a 1-day lead", () => {
    expect(rearmDue("2026-10-01", 1, at("2026-09-30T00:00:00Z"))).toBe(true);
    expect(rearmDue("2026-10-01", 1, at("2026-09-29T23:59:59Z"))).toBe(false);
  });
});

describe("decideRearm", () => {
  const candidate = { unitStageId: "us-1", valueDate: "2026-10-01", recurLeadDays: 30 };
  it("re-arms inside the window, dueAt = the certificate's expiry midnight UTC", () => {
    const d = decideRearm(candidate, { now: at("2026-09-15T08:00:00Z") });
    expect(d).toEqual({ kind: "rearm", dueAt: at("2026-10-01T00:00:00Z") });
  });
  it("skips outside the window", () => {
    const d = decideRearm(candidate, { now: at("2026-07-01T00:00:00Z") });
    expect(d).toEqual({ kind: "skip", reason: "not_due" });
  });
});

describe("stageDueState", () => {
  it("none when never re-armed (due_at null)", () => {
    expect(stageDueState(null, "pending", at("2026-10-01T00:00:00Z"))).toEqual({ kind: "none" });
  });
  it("none when the stage is done again (due_at may still be set)", () => {
    expect(stageDueState("2026-10-01T00:00:00Z", "done", at("2026-11-01T00:00:00Z"))).toEqual({ kind: "none" });
  });
  it("due before the expiry passes", () => {
    const s = stageDueState("2026-10-01T00:00:00Z", "pending", at("2026-09-20T00:00:00Z"));
    expect(s).toEqual({ kind: "due", dueAt: at("2026-10-01T00:00:00Z") });
  });
  it("lapsed with whole days elapsed after the expiry", () => {
    const s = stageDueState("2026-10-01T00:00:00Z", "pending", at("2026-10-04T12:00:00Z"));
    expect(s).toEqual({ kind: "lapsed", days: 3 });
  });
});
