import { describe, it, expect } from "vitest";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  MEMBER_EVENTS,
  parseMemberPrefs,
  parseOrgPrefs,
  reminderPolicy,
  setMemberChannel,
} from "./prefs";

const H = 3_600_000;

describe("member prefs", () => {
  it("null and garbage parse to everything on", () => {
    for (const event of MEMBER_EVENTS) expect(parseMemberPrefs(null)[event]).toEqual({ email: true, push: true });
    expect(parseMemberPrefs({ newBooking: "yes" }).cancelled.push).toBe(true);
    expect(parseMemberPrefs("nope").newRequest.email).toBe(true);
  });

  it("a partial object keeps defaults for what it omits", () => {
    const p = parseMemberPrefs({ cancelled: { email: false, push: true } });
    expect(p.cancelled.email).toBe(false);
    expect(p.newBooking.email).toBe(true);
  });

  it("a half-written event keeps the other channel's default", () => {
    expect(parseMemberPrefs({ newBooking: { email: false } }).newBooking).toEqual({ email: false, push: true });
  });

  it("setMemberChannel flips one switch and leaves the rest", () => {
    const next = setMemberChannel(parseMemberPrefs(null), "rescheduled", "push", false);
    expect(next.rescheduled).toEqual({ email: true, push: false });
    expect(next.newBooking).toEqual({ email: true, push: true });
  });
});

describe("org prefs + reminder policy", () => {
  it("defaults to a 24h reminder", () => {
    expect(parseOrgPrefs(null)).toEqual({ reminder: { enabled: true, leadHours: DEFAULT_REMINDER_LEAD_HOURS } });
  });

  it("rejects a lead outside the fixed set", () => {
    expect(parseOrgPrefs({ reminder: { enabled: true, leadHours: 5 } }).reminder.leadHours).toBe(24);
  });

  it("pins the lead to 24h when custom reminders are not allowed", () => {
    const prefs = parseOrgPrefs({ reminder: { enabled: true, leadHours: 2 } });
    expect(reminderPolicy(prefs, true)).toEqual({ enabled: true, leadMs: 2 * H });
    expect(reminderPolicy(prefs, false)).toEqual({ enabled: true, leadMs: 24 * H });
  });

  it("disabled survives the pin", () => {
    const prefs = parseOrgPrefs({ reminder: { enabled: false, leadHours: 48 } });
    expect(reminderPolicy(prefs, false)).toEqual({ enabled: false, leadMs: 24 * H });
  });
});
