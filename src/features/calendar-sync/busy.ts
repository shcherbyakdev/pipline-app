import type { GoogleCalendarClient, GoogleEvent } from "@/lib/google/calendar";
import { wallTimeToUtc, type BusyInterval } from "@/features/scheduling/slots";
import { BOOKLO_MARKER } from "./event-body";
import { calendarSyncAllowed, clientFor as productionClientFor, listConnections, type Connection } from "./connections";

/* Busy time from Google (spec 2026-09-05 §2.6): read live for the window
   the slot engine is about to render and merged into its `busy` list.
   Which calendars apply: the person's own connection plus every shared
   one; units (no person) see only the shared ones. Never throws — a
   Google outage must not close the booking page; it just stops blocking. */

/** Pure. Booklo's own events are left out (the booking is already in
    `busy` with its buffers, and a reschedule must be free to overlap its
    old time); cancelled and Free events too. All-day events block the
    whole org-local day(s) — Google's own free/busy does the same. */
export function eventsToBusy(events: GoogleEvent[], timeZone: string): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const e of events) {
    if (e.status === "cancelled" || e.transparency === "transparent") continue;
    if (e.extendedProperties?.private?.[BOOKLO_MARKER]) continue;
    if (e.start.dateTime && e.end.dateTime) {
      out.push({ startsAt: new Date(e.start.dateTime), endsAt: new Date(e.end.dateTime), external: true });
    } else if (e.start.date && e.end.date) {
      // end.date is exclusive (the morning after).
      out.push({ startsAt: wallTimeToUtc(e.start.date, "00:00", timeZone), endsAt: wallTimeToUtc(e.end.date, "00:00", timeZone), external: true });
    }
  }
  return out;
}

export type BusyDeps = {
  connections: Connection[];
  clientFor: (connectionId: string) => GoogleCalendarClient;
  allowed: (orgId: string) => Promise<boolean>;
};

// ponytail: per-instance memo, 60 s, keyed by calendar + window. A busy
// widget stops hammering Google; a serverless instance that has not seen
// the org pays one call. Upgrade to a shared cache if Google quota bites.
const MEMO_TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: Promise<BusyInterval[]> }>();
export function __resetBusyMemo(): void {
  memo.clear();
}

async function calendarBusy(
  client: GoogleCalendarClient,
  connectionId: string,
  calendarId: string,
  fromIso: string,
  toIso: string,
  timeZone: string,
  fresh: boolean,
): Promise<BusyInterval[]> {
  const key = `${connectionId}|${calendarId}|${fromIso}|${toIso}`;
  const hit = memo.get(key);
  if (!fresh && hit && hit.at + MEMO_TTL_MS > Date.now()) return hit.value;
  const value = client
    .listEvents(calendarId, fromIso, toIso)
    .then((events) => eventsToBusy(events, timeZone))
    .catch((error) => {
      console.error(`[calendar] busy read failed for ${calendarId}:`, error instanceof Error ? error.message : error);
      memo.delete(key);
      return [] as BusyInterval[];
    });
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** Busy intervals that apply to one person (`staffId`) or to a unit
    (`null`), for the window. `fresh` bypasses the memo — the public create
    pre-check uses it so the slot being taken is checked against Google
    at that moment. */
export async function externalBusy(
  orgId: string,
  staffId: string | null,
  fromIso: string,
  toIso: string,
  opts: { timeZone: string; fresh?: boolean },
  deps?: BusyDeps,
): Promise<BusyInterval[]> {
  try {
    const connections = deps?.connections ?? (await listConnections(orgId));
    if (connections.length === 0) return [];
    const allowed = deps?.allowed ?? calendarSyncAllowed;
    if (!(await allowed(orgId))) return [];
    const clientFor = deps?.clientFor ?? ((id: string) => productionClientFor(id));
    const applicable = connections.filter(
      (c) => c.status === "active" && c.busyCalendarIds.length > 0 && (c.staffId === null || c.staffId === staffId),
    );
    const lists = await Promise.all(
      applicable.flatMap((c) => {
        const client = clientFor(c.id);
        return c.busyCalendarIds.map((calendarId) => calendarBusy(client, c.id, calendarId, fromIso, toIso, opts.timeZone, opts.fresh ?? false));
      }),
    );
    return lists.flat();
  } catch (error) {
    console.error("[calendar] busy read failed:", error instanceof Error ? error.message : error);
    return [];
  }
}
