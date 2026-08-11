import { describe, it, expect } from "vitest";
import {
  CHASE_OFFSET_DAYS,
  CHASE_MAX_SENDS,
  nextSendAt,
  decide,
  chaseIdempotencyKey,
  type ChaseState,
} from "./cadence";

const T0 = new Date("2026-08-11T09:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const chase = (over: Partial<ChaseState> = {}): ChaseState => ({
  id: "c1",
  createdAt: T0,
  sendsDone: 0,
  nextSendAt: T0,
  stoppedAt: null,
  completedAt: null,
  ...over,
});

describe("nextSendAt", () => {
  it("maps sends_done to created_at + offset", () => {
    expect(nextSendAt(T0, 0)).toEqual(days(0));
    expect(nextSendAt(T0, 1)).toEqual(days(3));
    expect(nextSendAt(T0, 2)).toEqual(days(7));
    expect(nextSendAt(T0, 3)).toEqual(days(14));
  });
  it("returns null at/after the cap", () => {
    expect(nextSendAt(T0, CHASE_MAX_SENDS)).toBeNull();
    expect(nextSendAt(T0, 99)).toBeNull();
  });
});

describe("decide", () => {
  const ctx = (now: Date, hasOutstandingWork = true) => ({ now, hasOutstandingWork });

  it("sends when due, advancing to the NEXT offset", () => {
    expect(decide(chase(), ctx(T0))).toEqual({
      kind: "send",
      sendIndex: 0,
      nextSendAt: days(3),
    });
  });

  it("late tick does not shift the schedule (drain on day 5 → next stays day 7)", () => {
    const c = chase({ sendsDone: 1, nextSendAt: days(3) });
    expect(decide(c, ctx(days(5)))).toEqual({
      kind: "send",
      sendIndex: 1,
      nextSendAt: days(7),
    });
  });

  it("final send sets nextSendAt null (exhausted)", () => {
    const c = chase({ sendsDone: 3, nextSendAt: days(14) });
    expect(decide(c, ctx(days(14)))).toEqual({
      kind: "send",
      sendIndex: 3,
      nextSendAt: null,
    });
  });

  it("not due yet → skip", () => {
    const c = chase({ sendsDone: 1, nextSendAt: days(3) });
    expect(decide(c, ctx(days(2)))).toEqual({ kind: "skip", reason: "not_due" });
  });

  it("no outstanding work → complete, even when due", () => {
    expect(decide(chase(), ctx(T0, false))).toEqual({ kind: "complete" });
  });

  it("stopped or completed → terminal skip, never complete/send", () => {
    expect(decide(chase({ stoppedAt: days(1) }), ctx(days(3)))).toEqual({
      kind: "skip",
      reason: "terminal",
    });
    expect(decide(chase({ completedAt: days(1) }), ctx(days(3), false))).toEqual({
      kind: "skip",
      reason: "terminal",
    });
  });

  it("exhausted (cap reached or nothing scheduled) → skip", () => {
    expect(decide(chase({ sendsDone: 4, nextSendAt: null }), ctx(days(20)))).toEqual({
      kind: "skip",
      reason: "exhausted",
    });
    expect(decide(chase({ nextSendAt: null }), ctx(days(1)))).toEqual({
      kind: "skip",
      reason: "exhausted",
    });
  });

  it("offsets table is the spec's", () => {
    expect([...CHASE_OFFSET_DAYS]).toEqual([0, 3, 7, 14]);
    expect(CHASE_MAX_SENDS).toBe(4);
  });
});

describe("chaseIdempotencyKey", () => {
  it("is stable per (chase, sendIndex)", () => {
    expect(chaseIdempotencyKey("abc", 2)).toBe("chase/abc/send/2");
  });
});
