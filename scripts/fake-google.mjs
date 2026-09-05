#!/usr/bin/env node
/* A stand-in for Google's OAuth + Calendar v3 endpoints, for local QA of the
   Google Calendar integration without a Google Cloud project (spec
   2026-09-05 §6). Point the app at it:

     GOOGLE_CLIENT_ID=fake GOOGLE_CLIENT_SECRET=fake \
     GCAL_TOKEN_KEY=$(openssl rand -base64 32) \
     GOOGLE_OAUTH_BASE=http://localhost:4545 GOOGLE_API_BASE=http://localhost:4545 \
     npm run dev

   Consent auto-approves. Three calendars: the primary (owner), a writable
   "Studio" and a read-only "Holidays". Events live in memory.
   FAKE_REFUSE_REFRESH=1 makes every token refresh answer invalid_grant (the
   revoked-token path). Debug: GET /__events lists everything; POST /__events {calendarId,
   summary, start, end, transparency?} adds a Busy block; DELETE /__events
   clears. Never set the two *_BASE vars in production (env schema refuses). */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4545);
const ACCOUNT = process.env.FAKE_GOOGLE_ACCOUNT ?? "owner@example.com";
const calendars = [
  { id: ACCOUNT, summary: ACCOUNT, primary: true, accessRole: "owner" },
  { id: "studio@group.calendar.google.com", summary: "Studio", accessRole: "writer" },
  { id: "holidays@group.calendar.google.com", summary: "Holidays", accessRole: "reader" },
];
/** calendarId → Map<eventId, event> */
const events = new Map(calendars.map((c) => [c.id, new Map()]));
let tokenSerial = 0;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // ---- debug
  if (path === "/__events") {
    if (req.method === "GET") return json(res, 200, Object.fromEntries([...events].map(([k, v]) => [k, [...v.values()]])));
    if (req.method === "DELETE") { for (const m of events.values()) m.clear(); return json(res, 200, { ok: true }); }
    if (req.method === "POST") {
      const b = JSON.parse(await readBody(req));
      const id = b.id ?? `busy${Date.now()}`;
      const ev = { id, status: "confirmed", summary: b.summary ?? "Busy", transparency: b.transparency,
        start: b.allDay ? { date: b.start } : { dateTime: b.start }, end: b.allDay ? { date: b.end } : { dateTime: b.end } };
      events.get(b.calendarId ?? ACCOUNT)?.set(id, ev);
      log("debug: added", b.calendarId ?? ACCOUNT, id);
      return json(res, 200, ev);
    }
  }

  // ---- OAuth
  if (path === "/o/oauth2/v2/auth") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.searchParams.set("code", "fake-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    log("consent → auto-approve, back to", back.pathname);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (path === "/token" && req.method === "POST") {
    const p = new URLSearchParams(await readBody(req));
    tokenSerial += 1;
    log("token:", p.get("grant_type"));
    if (p.get("grant_type") === "refresh_token" && (p.get("refresh_token") === "revoked" || process.env.FAKE_REFUSE_REFRESH)) {
      return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    }
    return json(res, 200, {
      access_token: `fake-at-${tokenSerial}`,
      ...(p.get("grant_type") === "authorization_code" ? { refresh_token: process.env.FAKE_GOOGLE_REFRESH ?? "fake-rt" } : {}),
      expires_in: 3600,
      token_type: "Bearer",
    });
  }

  // ---- Calendar v3 (bearer required)
  if (!/^Bearer fake-at-/.test(req.headers.authorization ?? "")) return json(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
  if (path === "/calendar/v3/users/me/calendarList") return json(res, 200, { items: calendars });

  const m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (m) {
    const calendarId = decodeURIComponent(m[1]);
    const eventId = m[2] ? decodeURIComponent(m[2]) : null;
    const store = events.get(calendarId);
    if (!store) return json(res, 404, { error: { code: 404, message: "Not Found" } });
    if (req.method === "GET" && !eventId) {
      const min = url.searchParams.get("timeMin"), max = url.searchParams.get("timeMax");
      const items = [...store.values()].filter((e) => {
        const s = e.start.dateTime ?? `${e.start.date}T00:00:00Z`;
        const en = e.end.dateTime ?? `${e.end.date}T00:00:00Z`;
        return (!max || s < max) && (!min || en > min);
      });
      log("list", calendarId, items.length);
      return json(res, 200, { items });
    }
    if (req.method === "POST" && !eventId) {
      const b = JSON.parse(await readBody(req));
      if (store.has(b.id)) { log("insert 409", b.id); return json(res, 409, { error: { code: 409, message: "The requested identifier already exists." } }); }
      store.set(b.id, { status: "confirmed", ...b });
      log("insert", calendarId, b.id, b.summary);
      return json(res, 200, store.get(b.id));
    }
    if (req.method === "PUT" && eventId) {
      const b = JSON.parse(await readBody(req));
      if (!store.has(eventId)) return json(res, 404, { error: { code: 404, message: "Not Found" } });
      store.set(eventId, { ...b, id: eventId });
      log("update", calendarId, eventId, b.summary);
      return json(res, 200, store.get(eventId));
    }
    if (req.method === "DELETE" && eventId) {
      const had = store.has(eventId);
      // Google keeps deleted events as cancelled (a re-insert 409s, an update resurrects).
      if (had) store.set(eventId, { ...store.get(eventId), status: "cancelled" });
      log("delete", calendarId, eventId, had ? "" : "(404)");
      res.writeHead(had ? 204 : 404);
      return res.end();
    }
  }
  json(res, 404, { error: { code: 404, message: `no route ${req.method} ${path}` } });
}).listen(PORT, () => log(`fake Google on http://localhost:${PORT} (account ${ACCOUNT})`));
