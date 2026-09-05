import { describe, it, expect, vi } from "vitest";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));

import { eventsToBusy, externalBusy, __resetBusyMemo } from "./busy";
import type { Connection } from "./connections";
import type { GoogleCalendarClient, GoogleEvent } from "@/lib/google/calendar";

const TZ = "Europe/Warsaw";
const ev = (over: Partial<GoogleEvent>): GoogleEvent => ({
  id: "x",
  status: "confirmed",
  start: { dateTime: "2026-09-06T08:00:00Z" },
  end: { dateTime: "2026-09-06T09:00:00Z" },
  ...over,
});

describe("eventsToBusy", () => {
  it("keeps Busy timed events, marked external", () => {
    expect(eventsToBusy([ev({})], TZ)).toEqual([
      { startsAt: new Date("2026-09-06T08:00:00Z"), endsAt: new Date("2026-09-06T09:00:00Z"), external: true },
    ]);
  });

  it("skips cancelled, Free (transparent) and Booklo's own events", () => {
    const list = [
      ev({ id: "c", status: "cancelled" }),
      ev({ id: "f", transparency: "transparent" }),
      ev({ id: "ours", extendedProperties: { private: { bookloBookingId: "b-1" } } }),
      ev({ id: "keep" }),
    ];
    expect(eventsToBusy(list, TZ)).toHaveLength(1);
  });

  it("an all-day event blocks the whole org-local day(s)", () => {
    // Warsaw is UTC+2 in September: 2026-09-07 local = 06T22:00Z → 07T22:00Z.
    expect(eventsToBusy([ev({ start: { date: "2026-09-07" }, end: { date: "2026-09-08" } })], TZ)).toEqual([
      { startsAt: new Date("2026-09-06T22:00:00Z"), endsAt: new Date("2026-09-07T22:00:00Z"), external: true },
    ]);
  });

  it("ignores an event with neither a time nor a date", () => {
    expect(eventsToBusy([ev({ start: {}, end: {} })], TZ)).toEqual([]);
  });
});

const shared: Connection = {
  id: "conn-shared", orgId: "org-1", staffId: null, accountEmail: "s@example.com",
  pushCalendarId: "s@example.com", busyCalendarIds: ["s@example.com", "holidays"], calendars: [], status: "active",
};
const anna: Connection = { ...shared, id: "conn-anna", staffId: "staff-anna", accountEmail: "a@example.com", busyCalendarIds: ["a@example.com"] };

function fakeClients(perCalendar: Record<string, GoogleEvent[]>, throwFor: string[] = []) {
  const listed: string[] = [];
  const clientFor = (conn: string): GoogleCalendarClient => ({
    listCalendars: async () => [],
    listEvents: async (calendarId) => {
      listed.push(`${conn}/${calendarId}`);
      if (throwFor.includes(calendarId)) throw new Error("Google API 500");
      return perCalendar[calendarId] ?? [];
    },
    upsertEvent: async () => {},
    deleteEvent: async () => {},
  });
  return { listed, clientFor };
}

const window = ["2026-09-06T00:00:00Z", "2026-09-10T00:00:00Z"] as const;

describe("externalBusy", () => {
  it("a person's own calendars plus the shared ones; someone else's are not theirs", async () => {
    __resetBusyMemo();
    const f = fakeClients({ "a@example.com": [ev({ id: "a1" })], holidays: [ev({ id: "h1", start: { date: "2026-09-08" }, end: { date: "2026-09-09" } })] });
    const busy = await externalBusy("org-1", "staff-anna", ...window, { timeZone: TZ }, { connections: [shared, anna], clientFor: f.clientFor, allowed: async () => true });
    expect(busy).toHaveLength(2);
    expect(f.listed.sort()).toEqual(["conn-anna/a@example.com", "conn-shared/holidays", "conn-shared/s@example.com"]);

    __resetBusyMemo();
    const g = fakeClients({});
    await externalBusy("org-1", "staff-bob", ...window, { timeZone: TZ }, { connections: [shared, anna], clientFor: g.clientFor, allowed: async () => true });
    expect(g.listed.sort()).toEqual(["conn-shared/holidays", "conn-shared/s@example.com"]);
  });

  it("units (no person) see only the shared calendars", async () => {
    __resetBusyMemo();
    const f = fakeClients({});
    await externalBusy("org-1", null, ...window, { timeZone: TZ }, { connections: [shared, anna], clientFor: f.clientFor, allowed: async () => true });
    expect(f.listed.sort()).toEqual(["conn-shared/holidays", "conn-shared/s@example.com"]);
  });

  it("memoises for a minute per calendar+window; fresh bypasses", async () => {
    __resetBusyMemo();
    const f = fakeClients({});
    const deps = { connections: [anna], clientFor: f.clientFor, allowed: async () => true };
    await externalBusy("org-1", "staff-anna", ...window, { timeZone: TZ }, deps);
    await externalBusy("org-1", "staff-anna", ...window, { timeZone: TZ }, deps);
    expect(f.listed).toHaveLength(1);
    await externalBusy("org-1", "staff-anna", ...window, { timeZone: TZ, fresh: true }, deps);
    expect(f.listed).toHaveLength(2);
  });

  it("never throws: a failing calendar contributes nothing, the others still count; a paused plan or a reconnect-needed row reads nothing", async () => {
    __resetBusyMemo();
    const f = fakeClients({ "s@example.com": [ev({})] }, ["holidays"]);
    const busy = await externalBusy("org-1", null, ...window, { timeZone: TZ }, { connections: [shared], clientFor: f.clientFor, allowed: async () => true });
    expect(busy).toHaveLength(1);

    __resetBusyMemo();
    const g = fakeClients({ "s@example.com": [ev({})] });
    expect(await externalBusy("org-1", null, ...window, { timeZone: TZ }, { connections: [shared], clientFor: g.clientFor, allowed: async () => false })).toEqual([]);
    expect(await externalBusy("org-1", null, ...window, { timeZone: TZ }, { connections: [{ ...shared, status: "needs_reconnect" }], clientFor: g.clientFor, allowed: async () => true })).toEqual([]);
    expect(g.listed).toEqual([]);
  });
});
