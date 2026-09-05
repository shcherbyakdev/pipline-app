import { describe, it, expect } from "vitest";
import { createGoogleClient, GoogleApiError } from "./calendar";

type Call = { method: string; url: string; auth: string | null; body: unknown };

/** A scripted Google: each entry answers the next request in order. */
function fakeGoogle(script: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      auth: headers.get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = script.shift() ?? { status: 500, body: { error: "script exhausted" } };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

function client(g: ReturnType<typeof fakeGoogle>, tokens = ["tok-1", "tok-2"]) {
  const refreshes: boolean[] = [];
  const c = createGoogleClient({
    apiBase: "https://www.googleapis.com",
    fetchImpl: g.fetchImpl,
    getAccessToken: async (force) => {
      refreshes.push(force);
      return force ? tokens[1] : tokens[0];
    },
  });
  return { c, refreshes };
}

describe("listCalendars", () => {
  it("maps id, name, primary and write access", async () => {
    const g = fakeGoogle([
      {
        status: 200,
        body: {
          items: [
            { id: "me@example.com", summary: "Me", primary: true, accessRole: "owner" },
            { id: "team@group.calendar.google.com", summary: "Team", accessRole: "reader" },
            { id: "room@resource.calendar.google.com", summary: "Room", accessRole: "writer" },
          ],
        },
      },
    ]);
    const { c } = client(g);
    expect(await c.listCalendars()).toEqual([
      { id: "me@example.com", summary: "Me", primary: true, canWrite: true },
      { id: "team@group.calendar.google.com", summary: "Team", primary: false, canWrite: false },
      { id: "room@resource.calendar.google.com", summary: "Room", primary: false, canWrite: true },
    ]);
    expect(g.calls[0].url).toBe("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader");
    expect(g.calls[0].auth).toBe("Bearer tok-1");
  });
});

describe("listEvents", () => {
  it("follows nextPageToken and asks for single instances in the window", async () => {
    const g = fakeGoogle([
      { status: 200, body: { items: [{ id: "a", status: "confirmed", start: { dateTime: "2026-09-06T08:00:00Z" }, end: { dateTime: "2026-09-06T09:00:00Z" } }], nextPageToken: "p2" } },
      { status: 200, body: { items: [{ id: "b", status: "confirmed", start: { date: "2026-09-07" }, end: { date: "2026-09-08" } }] } },
    ]);
    const { c } = client(g);
    const events = await c.listEvents("me@example.com", "2026-09-06T00:00:00Z", "2026-09-10T00:00:00Z");
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    const first = new URL(g.calls[0].url);
    expect(first.pathname).toBe("/calendar/v3/calendars/me%40example.com/events");
    expect(first.searchParams.get("singleEvents")).toBe("true");
    expect(first.searchParams.get("timeMin")).toBe("2026-09-06T00:00:00Z");
    expect(first.searchParams.get("timeMax")).toBe("2026-09-10T00:00:00Z");
    expect(first.searchParams.get("maxResults")).toBe("2500");
    expect(new URL(g.calls[1].url).searchParams.get("pageToken")).toBe("p2");
  });
});

describe("upsertEvent", () => {
  const body = {
    id: "abc123",
    summary: "Anna — Massage",
    start: { dateTime: "2026-09-06T08:00:00Z", timeZone: "Europe/Warsaw" },
    end: { dateTime: "2026-09-06T09:00:00Z", timeZone: "Europe/Warsaw" },
  };

  it("inserts, and on 409 updates the same id with status confirmed", async () => {
    const g = fakeGoogle([{ status: 200, body: { id: "abc123" } }]);
    const { c } = client(g);
    await c.upsertEvent("cal", body);
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]).toMatchObject({ method: "POST", url: "https://www.googleapis.com/calendar/v3/calendars/cal/events" });

    const g2 = fakeGoogle([{ status: 409, body: { error: { code: 409 } } }, { status: 200, body: { id: "abc123" } }]);
    const { c: c2 } = client(g2);
    await c2.upsertEvent("cal", body);
    expect(g2.calls[1]).toMatchObject({ method: "PUT", url: "https://www.googleapis.com/calendar/v3/calendars/cal/events/abc123" });
    expect((g2.calls[1].body as { status: string }).status).toBe("confirmed");
  });

  it("retries once with a fresh token after a 401, then gives up", async () => {
    const g = fakeGoogle([{ status: 401, body: {} }, { status: 200, body: { id: "abc123" } }]);
    const { c, refreshes } = client(g);
    await c.upsertEvent("cal", body);
    expect(refreshes).toEqual([false, true]);
    expect(g.calls.map((x) => x.auth)).toEqual(["Bearer tok-1", "Bearer tok-2"]);

    const g2 = fakeGoogle([{ status: 401, body: {} }, { status: 401, body: {} }]);
    const { c: c2 } = client(g2);
    const err = await c2.upsertEvent("cal", body).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(401);
  });

  it("surfaces other failures with their status", async () => {
    const g = fakeGoogle([{ status: 403, body: { error: { message: "Forbidden" } } }]);
    const { c } = client(g);
    const err = await c.upsertEvent("cal", body).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(403);
    expect((err as GoogleApiError).message).toContain("Forbidden");
  });
});

describe("deleteEvent", () => {
  it("treats 404 and 410 as already gone", async () => {
    const g = fakeGoogle([{ status: 204 }, { status: 404, body: {} }, { status: 410, body: {} }]);
    const { c } = client(g);
    await c.deleteEvent("cal", "e1");
    await c.deleteEvent("cal", "e2");
    await c.deleteEvent("cal", "e3");
    expect(g.calls.map((x) => x.method)).toEqual(["DELETE", "DELETE", "DELETE"]);
    expect(g.calls[0].url).toBe("https://www.googleapis.com/calendar/v3/calendars/cal/events/e1");
  });
});
