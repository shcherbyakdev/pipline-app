import { describe, it, expect, vi } from "vitest";

// sync.ts reaches connections.ts for targetFor, whose siblings reach @/env
// and the admin client; everything is injected here (notify.test idiom).
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));

import { syncBooking, runCalendarSyncDrain, type SyncStore, type PendingRow, type SyncState } from "./sync";
import type { Connection } from "./connections";
import type { SyncBooking } from "./event-body";
import type { GoogleCalendarClient, GoogleEventBody } from "@/lib/google/calendar";
import { GoogleAuthError } from "@/lib/google/oauth";

const shared: Connection = {
  id: "conn-shared", orgId: "org-1", userId: "user-1", staffId: null, accountEmail: "studio@example.com",
  pushCalendarId: "studio@example.com", busyCalendarIds: [], calendars: [], status: "active",
  inviteClients: false, cancelOnDelete: false, rescheduleOnMove: false, watch: null, inboundCheckedAt: null, inboundNotice: null,
};
const anna: Connection = { ...shared, id: "conn-anna", staffId: "staff-anna", accountEmail: "anna@example.com", pushCalendarId: "anna@example.com" };

const booking: SyncBooking = {
  id: "0b42f6d0-1234-4abc-9def-0123456789ab", orgId: "org-1", status: "confirmed", staffId: "staff-anna", rentalUnitId: null,
  startsAt: "2026-09-06T08:00:00Z", endsAt: "2026-09-06T09:00:00Z", clientName: "Kim", clientEmail: null, note: null,
  title: "Massage", timeZone: "Europe/Warsaw",
};
const EVENT_ID = "0b42f6d012344abc9def0123456789ab";

type Call = { conn: string; op: "upsert" | "delete"; calendarId: string; eventId: string; body?: GoogleEventBody; sendUpdates?: string };
function fakeClients(fail?: (c: Call) => Error | undefined) {
  const calls: Call[] = [];
  const clientFor = (conn: string): GoogleCalendarClient => ({
    listCalendars: async () => [],
    listEvents: async () => [],
    watchEvents: async () => ({ id: "ch", resourceId: "res", expiresAt: null }),
    stopChannel: async () => {},
    upsertEvent: async (calendarId, body, sendUpdates) => {
      const c: Call = { conn, op: "upsert", calendarId, eventId: body.id, body, sendUpdates };
      calls.push(c);
      const e = fail?.(c);
      if (e) throw e;
    },
    deleteEvent: async (calendarId, eventId, sendUpdates) => {
      const c: Call = { conn, op: "delete", calendarId, eventId, sendUpdates };
      calls.push(c);
      const e = fail?.(c);
      if (e) throw e;
    },
  });
  return { calls, clientFor };
}

const deps = (connections: Connection[], f = fakeClients()) => ({ connections, clientFor: f.clientFor, appUrl: "https://app.test" });

describe("syncBooking — the reconcile table", () => {
  it("confirmed with a target and no state → upsert on the person's calendar", async () => {
    const f = fakeClients();
    const out = await syncBooking(booking, null, deps([shared, anna], f));
    expect(out).toEqual({ outcome: "synced", state: { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID } });
    expect(f.calls).toEqual([expect.objectContaining({ conn: "conn-anna", op: "upsert", calendarId: "anna@example.com", eventId: EVENT_ID })]);
    expect(f.calls[0].body?.summary).toBe("Kim — Massage");
  });

  it("a person without their own connection lands on the shared one; a space booking too", async () => {
    const f = fakeClients();
    await syncBooking({ ...booking, staffId: "staff-bob" }, null, deps([shared, anna], f));
    await syncBooking({ ...booking, id: "11111111-1111-4111-8111-111111111111", staffId: null, rentalUnitId: "unit-1" }, null, deps([shared, anna], f));
    expect(f.calls.map((c) => c.conn)).toEqual(["conn-shared", "conn-shared"]);
  });

  it("cancelled with state → delete, nothing left", async () => {
    const f = fakeClients();
    const state: SyncState = { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID };
    const out = await syncBooking({ ...booking, status: "cancelled_by_client" }, state, deps([shared, anna], f));
    expect(out).toEqual({ outcome: "synced", state: null });
    expect(f.calls).toEqual([{ conn: "conn-anna", op: "delete", calendarId: "anna@example.com", eventId: EVENT_ID, sendUpdates: "none" }]);
  });

  it("with invite_clients the client is a guest and Google mails on every write", async () => {
    const f = fakeClients();
    const inviting = { ...anna, inviteClients: true };
    await syncBooking({ ...booking, clientEmail: "kim@example.com" }, null, deps([inviting], f));
    expect(f.calls[0].sendUpdates).toBe("all");
    expect(f.calls[0].body?.attendees).toEqual([{ email: "kim@example.com", displayName: "Kim" }]);
    const state: SyncState = { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID };
    await syncBooking({ ...booking, status: "cancelled_by_client" }, state, deps([inviting], f));
    expect(f.calls[1]).toMatchObject({ op: "delete", sendUpdates: "all" });
  });

  it("pending, declined and rescheduled rows are never events", async () => {
    const f = fakeClients();
    for (const status of ["pending", "declined", "rescheduled"]) {
      expect(await syncBooking({ ...booking, status }, null, deps([shared, anna], f))).toEqual({ outcome: "synced", state: null });
    }
    expect(f.calls).toEqual([]);
  });

  it("state on one calendar, target on another → delete there, upsert here", async () => {
    const f = fakeClients();
    const state: SyncState = { connectionId: "conn-shared", calendarId: "studio@example.com", eventId: EVENT_ID };
    const out = await syncBooking(booking, state, deps([shared, anna], f));
    expect(out.state).toEqual({ connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID });
    expect(f.calls.map((c) => [c.conn, c.op])).toEqual([["conn-shared", "delete"], ["conn-anna", "upsert"]]);
  });

  it("same target as the state → one upsert (an edit), no delete", async () => {
    const f = fakeClients();
    const state: SyncState = { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID };
    await syncBooking(booking, state, deps([shared, anna], f));
    expect(f.calls.map((c) => c.op)).toEqual(["upsert"]);
  });

  it("no connection at all → nothing to do, no calls", async () => {
    const f = fakeClients();
    expect(await syncBooking(booking, null, deps([], f))).toEqual({ outcome: "synced", state: null });
    expect(f.calls).toEqual([]);
  });

  it("a connection with 'Don't add' set is not a target; an existing event there is removed", async () => {
    const f = fakeClients();
    const off = { ...anna, pushCalendarId: null };
    const state: SyncState = { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID };
    const out = await syncBooking(booking, state, deps([off], f));
    expect(out.state).toBeNull();
    expect(f.calls.map((c) => c.op)).toEqual(["delete"]);
  });

  it("a target that needs a reconnect → waiting, untouched", async () => {
    const f = fakeClients();
    const out = await syncBooking(booking, null, deps([{ ...anna, status: "needs_reconnect" }], f));
    expect(out).toEqual({ outcome: "waiting", state: null });
    expect(f.calls).toEqual([]);
  });

  it("state whose connection is gone (disconnected) is dropped, the event stays", async () => {
    const f = fakeClients();
    const state: SyncState = { connectionId: null, calendarId: "old@example.com", eventId: EVENT_ID };
    const out = await syncBooking({ ...booking, status: "cancelled_by_client" }, state, deps([], f));
    expect(out).toEqual({ outcome: "synced", state: null });
    expect(f.calls).toEqual([]);
  });
});

// ---------- the drain over an in-memory store

function memoryStore(rows: PendingRow[], bookings: SyncBooking[]) {
  const states = new Map<string, SyncState>();
  const failures: Array<{ id: string; attempts: number; error: string; queuedAt: string }> = [];
  const deleted: string[] = [];
  const store: SyncStore = {
    loadPending: async () => rows,
    loadBookings: async (ids) => bookings.filter((b) => ids.includes(b.id)),
    saveState: async (id, state) => { states.set(id, state); },
    deleteState: async (id) => { deleted.push(id); },
    recordFailure: async (id, attempts, error, queuedAt) => { failures.push({ id, attempts, error, queuedAt }); },
  };
  return { store, states, failures, deleted };
}

const row = (id: string, over: Partial<PendingRow> = {}): PendingRow => ({
  bookingId: id, orgId: "org-1", attempts: 0,
  state: null, queuedAt: "2026-09-05T10:00:00Z", ...over,
});

describe("runCalendarSyncDrain", () => {
  it("syncs each pending row, saves state, deletes rows that own nothing", async () => {
    const f = fakeClients();
    const gone = { ...booking, id: "22222222-2222-4222-8222-222222222222", status: "cancelled_by_client" };
    const m = memoryStore(
      [row(booking.id), row(gone.id, { state: { connectionId: "conn-anna", calendarId: "anna@example.com", eventId: "2222" } })],
      [booking, gone],
    );
    const summary = await runCalendarSyncDrain({}, { store: m.store, connectionsFor: async () => [anna], clientFor: f.clientFor, allowed: async () => true, appUrl: "https://app.test" });
    expect(summary).toEqual({ synced: 2, failed: 0, skipped: 0 });
    expect(m.states.get(booking.id)).toEqual({ connectionId: "conn-anna", calendarId: "anna@example.com", eventId: EVENT_ID });
    expect(m.deleted).toEqual([gone.id]);
  });

  it("a paused plan leaves every row untouched", async () => {
    const f = fakeClients();
    const m = memoryStore([row(booking.id)], [booking]);
    const summary = await runCalendarSyncDrain({}, { store: m.store, connectionsFor: async () => [anna], clientFor: f.clientFor, allowed: async () => false, appUrl: "https://app.test" });
    expect(summary).toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(f.calls).toEqual([]);
    expect(m.failures).toEqual([]);
  });

  it("a Google failure is recorded with the attempt count; one bad row does not stop the next", async () => {
    const f = fakeClients((c) => (c.eventId === EVENT_ID ? new Error("Google API 500") : undefined));
    const other = { ...booking, id: "33333333-3333-4333-8333-333333333333" };
    const m = memoryStore([row(booking.id, { attempts: 2 }), row(other.id)], [booking, other]);
    const summary = await runCalendarSyncDrain({}, { store: m.store, connectionsFor: async () => [anna], clientFor: f.clientFor, allowed: async () => true, appUrl: "https://app.test" });
    expect(summary).toEqual({ synced: 1, failed: 1, skipped: 0 });
    expect(m.failures).toEqual([{ id: booking.id, attempts: 3, error: "Google API 500", queuedAt: "2026-09-05T10:00:00Z" }]);
    expect(m.states.has(other.id)).toBe(true);
  });

  it("a dead refresh token (invalid_grant) is not a failure: the row waits for the reconnect", async () => {
    const f = fakeClients(() => new GoogleAuthError("invalid_grant"));
    const m = memoryStore([row(booking.id)], [booking]);
    const summary = await runCalendarSyncDrain({}, { store: m.store, connectionsFor: async () => [anna], clientFor: f.clientFor, allowed: async () => true, appUrl: "https://app.test" });
    expect(summary).toEqual({ synced: 0, failed: 0, skipped: 1 });
    expect(m.failures).toEqual([]);
  });

  it("a row whose booking vanished is dropped", async () => {
    const f = fakeClients();
    const m = memoryStore([row("44444444-4444-4444-8444-444444444444")], []);
    await runCalendarSyncDrain({}, { store: m.store, connectionsFor: async () => [anna], clientFor: f.clientFor, allowed: async () => true, appUrl: "https://app.test" });
    expect(m.deleted).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });
});
