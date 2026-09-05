/* Google Calendar v3 over fetch (spec 2026-09-05 §4). Four calls; no SDK.
   The access token comes from a callback so the caller owns refresh and
   persistence (features/calendar-sync/connections.ts): one 401 → ask for a
   fresh token once → retry once. Everything else surfaces as
   GoogleApiError with the HTTP status; the sync decides what to do. */

export type CalendarInfo = { id: string; summary: string; primary: boolean; canWrite: boolean };

export type GoogleEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  /** "opaque" (default, Busy) or "transparent" (Free). */
  transparency?: "opaque" | "transparent";
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export type GoogleEventBody = {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties?: { private?: Record<string, string> };
  reminders?: { useDefault: boolean };
};

export class GoogleApiError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message ?? `Google API ${status}`);
    this.name = "GoogleApiError";
  }
}

export type GoogleCalendarClient = {
  listCalendars(): Promise<CalendarInfo[]>;
  listEvents(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<GoogleEvent[]>;
  /** Insert; if the id already exists (409 — also after a delete, Google
      keeps the id as cancelled) update it in full with status confirmed. */
  upsertEvent(calendarId: string, event: GoogleEventBody): Promise<void>;
  /** 404 / 410 count as done. */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
};

export type GoogleClientDeps = {
  /** https://www.googleapis.com, or the local fake. */
  apiBase: string;
  /** `forceRefresh` = the previous token was refused. */
  getAccessToken: (forceRefresh: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
};

type RawCalendar = { id: string; summary?: string; primary?: boolean; accessRole?: string };

export function createGoogleClient(deps: GoogleClientDeps): GoogleCalendarClient {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function call(method: string, path: string, params?: Record<string, string>, body?: unknown): Promise<Response> {
    const url = new URL(`/calendar/v3/${path}`, deps.apiBase);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const attempt = async (force: boolean) =>
      fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${await deps.getAccessToken(force)}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    let res = await attempt(false);
    if (res.status === 401) res = await attempt(true);
    return res;
  }

  async function fail(res: Response): Promise<never> {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new GoogleApiError(res.status, json?.error?.message ? `Google API ${res.status}: ${json.error.message}` : undefined);
  }

  const cal = (id: string) => `calendars/${encodeURIComponent(id)}`;

  return {
    async listCalendars() {
      const res = await call("GET", "users/me/calendarList", { minAccessRole: "reader" });
      if (!res.ok) await fail(res);
      const json = (await res.json()) as { items?: RawCalendar[] };
      return (json.items ?? []).map((c) => ({
        id: c.id,
        summary: c.summary ?? c.id,
        primary: c.primary === true,
        canWrite: c.accessRole === "owner" || c.accessRole === "writer",
      }));
    },

    async listEvents(calendarId, timeMinIso, timeMaxIso) {
      const items: GoogleEvent[] = [];
      let pageToken: string | undefined;
      do {
        const res = await call("GET", `${cal(calendarId)}/events`, {
          singleEvents: "true",
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          maxResults: "2500",
          fields: "items(id,status,transparency,start,end,extendedProperties),nextPageToken",
          ...(pageToken ? { pageToken } : {}),
        });
        if (!res.ok) await fail(res);
        const json = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
        items.push(...(json.items ?? []));
        pageToken = json.nextPageToken;
      } while (pageToken);
      return items;
    },

    async upsertEvent(calendarId, event) {
      const inserted = await call("POST", `${cal(calendarId)}/events`, undefined, event);
      if (inserted.ok) return;
      if (inserted.status !== 409) await fail(inserted);
      const updated = await call("PUT", `${cal(calendarId)}/events/${encodeURIComponent(event.id)}`, undefined, {
        ...event,
        status: "confirmed",
      });
      if (!updated.ok) await fail(updated);
    },

    async deleteEvent(calendarId, eventId) {
      const res = await call("DELETE", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
      if (res.ok || res.status === 404 || res.status === 410) return;
      await fail(res);
    },
  };
}
