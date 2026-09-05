import { describe, it, expect, vi } from "vitest";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));

import { classifyInbound, pollConnection, pollSince, type InboundDeps } from "./inbound";
import type { Connection } from "./connections";
import type { SyncBooking } from "./event-body";
import type { SyncState } from "./sync";
import type { GoogleCalendarClient, GoogleEvent } from "@/lib/google/calendar";

const conn: Connection = {
  id: "conn-1", orgId: "org-1", userId: "user-1", staffId: "staff-1", accountEmail: "me@example.com", pushCalendarId: "me@example.com",
  busyCalendarIds: [], calendars: [], status: "active", inviteClients: true, cancelOnDelete: true, rescheduleOnMove: true,
  watch: null, inboundCheckedAt: null, inboundNotice: null,
};
const booking: SyncBooking = {
  id: "0b42f6d0-1234-4abc-9def-0123456789ab", orgId: "org-1", status: "confirmed", staffId: "staff-1", rentalUnitId: null,
  startsAt: "2026-09-10T08:00:00Z", endsAt: "2026-09-10T09:00:00Z", clientName: "Kim", clientEmail: "kim@example.com", note: null,
  title: "Massage", timeZone: "Europe/Warsaw",
};
const EVENT_ID = "0b42f6d012344abc9def0123456789ab";
const state: SyncState = { connectionId: "conn-1", calendarId: "me@example.com", eventId: EVENT_ID };
const ev = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id: EVENT_ID, status: "confirmed",
  start: { dateTime: "2026-09-10T08:00:00Z" }, end: { dateTime: "2026-09-10T09:00:00Z" },
  extendedProperties: { private: { bookloBookingId: booking.id } }, ...over,
});

describe("classifyInbound", () => {
  it("ignores events that are not ours, not the current mirror, or whose booking is not live", () => {
    expect(classifyInbound(ev({ extendedProperties: undefined }), booking, state, conn).kind).toBe("ignore");
    expect(classifyInbound(ev(), null, state, conn).kind).toBe("ignore");
    expect(classifyInbound(ev(), booking, { ...state, eventId: "other" }, conn).kind).toBe("ignore");
    expect(classifyInbound(ev(), booking, { ...state, connectionId: "conn-2" }, conn).kind).toBe("ignore");
    expect(classifyInbound(ev({ status: "cancelled" }), { ...booking, status: "rescheduled" }, state, conn).kind).toBe("ignore");
    expect(classifyInbound(ev(), booking, state, conn)).toEqual({ kind: "ignore", reason: "unchanged" });
  });

  it("a deleted or self-declined event cancels — only with the switch on", () => {
    expect(classifyInbound(ev({ status: "cancelled" }), booking, state, conn)).toEqual({ kind: "cancel" });
    expect(classifyInbound(ev({ attendees: [{ email: "me@example.com", self: true, responseStatus: "declined" }] }), booking, state, conn)).toEqual({ kind: "cancel" });
    expect(classifyInbound(ev({ status: "cancelled" }), booking, state, { ...conn, cancelOnDelete: false }).kind).toBe("ignore");
  });

  it("a moved start reschedules an appointment; a moved stay snaps back; the switch gates both", () => {
    const moved = ev({ start: { dateTime: "2026-09-10T10:00:00Z" }, end: { dateTime: "2026-09-10T11:00:00Z" } });
    expect(classifyInbound(moved, booking, state, conn)).toEqual({ kind: "reschedule", startsAt: new Date("2026-09-10T10:00:00Z") });
    expect(classifyInbound(moved, { ...booking, staffId: null, rentalUnitId: "unit-1" }, state, conn)).toEqual({ kind: "snapBack", notice: "spaces" });
    expect(classifyInbound(moved, booking, state, { ...conn, rescheduleOnMove: false }).kind).toBe("ignore");
    // A sub-minute drift is not a move.
    expect(classifyInbound(ev({ start: { dateTime: "2026-09-10T08:00:30Z" } }), booking, state, conn).kind).toBe("ignore");
  });
});

describe("pollSince", () => {
  it("starts an hour back on the first poll, five minutes before the last check after", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(pollSince(conn, now)).toEqual(new Date("2026-09-10T10:55:00Z"));
    expect(pollSince({ ...conn, inboundCheckedAt: new Date("2026-09-10T11:50:00Z") }, now)).toEqual(new Date("2026-09-10T11:45:00Z"));
  });
});

function fakeDeps(events: GoogleEvent[], rows: Record<string, { booking: SyncBooking; state: SyncState }>, applyOk = { cancel: true, reschedule: true }) {
  const calls: string[] = [];
  const client: GoogleCalendarClient = {
    listCalendars: async () => [],
    listEvents: async (_c, _a, _b, opts) => { calls.push(`list updatedMin=${opts?.updatedMin} showDeleted=${opts?.showDeleted}`); return events; },
    upsertEvent: async () => {}, deleteEvent: async () => {},
    watchEvents: async () => ({ id: "ch", resourceId: "res", expiresAt: null }), stopChannel: async () => {},
  };
  const deps: InboundDeps = {
    client,
    store: {
      loadBookingWithState: async (id) => rows[id] ?? null,
      requeue: async (id) => { calls.push(`requeue ${id}`); },
      markChecked: async (id, at, notice) => { calls.push(`checked ${id} ${at.toISOString()} notice=${notice}`); },
    },
    apply: {
      cancel: async (b) => { calls.push(`cancel ${b.id}`); return applyOk.cancel ? { ok: true } : { ok: false, reason: "failed" }; },
      reschedule: async (b, at) => { calls.push(`reschedule ${b.id} ${at.toISOString()}`); return applyOk.reschedule ? { ok: true } : { ok: false, reason: "slotTaken" }; },
    },
    notify: async (_c, notice) => { calls.push(`notify ${notice}`); },
    now: new Date("2026-09-10T12:00:00Z"),
  };
  return { deps, calls };
}

describe("pollConnection", () => {
  it("does nothing when both switches are off, and never lists", async () => {
    const f = fakeDeps([ev({ status: "cancelled" })], { [booking.id]: { booking, state } });
    const s = await pollConnection({ ...conn, cancelOnDelete: false, rescheduleOnMove: false }, f.deps);
    expect(s).toEqual({ seen: 0, cancelled: 0, rescheduled: 0, snappedBack: 0 });
    expect(f.calls).toEqual([]);
  });

  it("lists since the cursor with deleted events, cancels a deleted mirror, reschedules a moved one, marks the check", async () => {
    const other: SyncBooking = { ...booking, id: "22222222-2222-4222-8222-222222222222", startsAt: "2026-09-11T08:00:00Z", endsAt: "2026-09-11T09:00:00Z" };
    const otherState: SyncState = { connectionId: "conn-1", calendarId: "me@example.com", eventId: "22222222222242228222222222222222" };
    const f = fakeDeps(
      [
        ev({ status: "cancelled" }),
        { id: "22222222222242228222222222222222", status: "confirmed", start: { dateTime: "2026-09-11T10:00:00Z" }, end: { dateTime: "2026-09-11T11:00:00Z" }, extendedProperties: { private: { bookloBookingId: other.id } } },
        { id: "someone-elses", status: "confirmed", start: { dateTime: "2026-09-11T10:00:00Z" }, end: {} },
      ],
      { [booking.id]: { booking, state }, [other.id]: { booking: other, state: otherState } },
    );
    const s = await pollConnection({ ...conn, inboundCheckedAt: new Date("2026-09-10T11:50:00Z") }, f.deps);
    expect(s).toEqual({ seen: 2, cancelled: 1, rescheduled: 1, snappedBack: 0 });
    expect(f.calls).toEqual([
      "list updatedMin=2026-09-10T11:45:00.000Z showDeleted=true",
      `cancel ${booking.id}`,
      `reschedule ${other.id} 2026-09-11T10:00:00.000Z`,
      "checked conn-1 2026-09-10T12:00:00.000Z notice=null",
    ]);
  });

  it("a refused move re-queues the booking, notifies, and leaves the notice on the connection", async () => {
    const moved = ev({ start: { dateTime: "2026-09-10T10:00:00Z" }, end: { dateTime: "2026-09-10T11:00:00Z" } });
    const f = fakeDeps([moved], { [booking.id]: { booking, state } }, { cancel: true, reschedule: false });
    const s = await pollConnection(conn, f.deps);
    expect(s.snappedBack).toBe(1);
    expect(f.calls.slice(1)).toEqual([
      `reschedule ${booking.id} 2026-09-10T10:00:00.000Z`,
      `requeue ${booking.id}`,
      "notify slotTaken:Kim",
      "checked conn-1 2026-09-10T12:00:00.000Z notice=slotTaken:Kim",
    ]);
  });

  it("a throwing apply does not stop the rest of the batch", async () => {
    const f = fakeDeps([ev({ status: "cancelled" }), ev({ status: "cancelled" })], { [booking.id]: { booking, state } });
    f.deps.apply.cancel = async () => { throw new Error("db down"); };
    const s = await pollConnection(conn, f.deps);
    expect(s.seen).toBe(2);
    expect(f.calls.at(-1)).toContain("checked conn-1");
  });
});
