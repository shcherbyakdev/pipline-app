import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_REMINDER_LEAD_HOURS,
  MEMBER_EVENTS,
  REMINDER_LEAD_HOURS,
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

describe("lead set parity with the migration", () => {
  it("REMINDER_LEAD_HOURS equals the CHECK inside update_org_notification_prefs (0075)", () => {
    // handle.test.ts idiom: the SQL is the enforcement, the TS list the UI;
    // adding an option is both, on purpose.
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0075_notifications.sql"), "utf8");
    const hit = /leadHours'\)::numeric not in \(([^)]+)\)/.exec(sql);
    expect(hit, "leadHours CHECK not found").not.toBeNull();
    const inSql = hit![1].split(",").map((n) => Number(n.trim())).sort((a, b) => a - b);
    expect(inSql).toEqual([...REMINDER_LEAD_HOURS].sort((a, b) => a - b));
  });
});
