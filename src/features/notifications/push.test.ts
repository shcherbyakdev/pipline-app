import { describe, it, expect, vi } from "vitest";

// push.ts reaches @/env (eager process.env parse) and the admin client;
// neither exists under plain `npm run test`. The sender and the db are
// injected, so the module needs only the three VAPID values to be "on".
vi.mock("@/env", () => ({
  env: { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:test@example.com" },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));

import { sendPush, pushConfigured, type PushSender } from "./push";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = { id: string; endpoint: string; p256dh: string; auth: string };

/** Just enough of supabase-js for sendPush: select by user_id, delete by id. */
function fakeDb(rows: Row[]) {
  const deleted: string[] = [];
  const db = {
    from: (table: string) => {
      if (table !== "push_subscriptions") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: async () => ({ data: rows, error: null }) }),
        delete: () => ({
          eq: async (_col: string, id: string) => {
            deleted.push(id);
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { db, deleted };
}

const payload = { title: "New booking", body: "Anna · Massage · Mon 10:00", url: "/bookings", tag: "b1" };

describe("sendPush", () => {
  it("is on with the three VAPID values", () => {
    expect(pushConfigured()).toBe(true);
  });

  it("sends to every device, drops the gone ones, keeps the flaky ones", async () => {
    const rows: Row[] = [
      { id: "a", endpoint: "https://push/a", p256dh: "k", auth: "s" },
      { id: "b", endpoint: "https://push/b", p256dh: "k", auth: "s" },
      { id: "c", endpoint: "https://push/c", p256dh: "k", auth: "s" },
    ];
    const { db, deleted } = fakeDb(rows);
    const sent: string[] = [];
    const send: PushSender = async (sub) => {
      if (sub.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/c")) throw Object.assign(new Error("timeout"), { statusCode: 500 });
      sent.push(sub.endpoint);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await sendPush("u1", payload, { db, send });
    errors.mockRestore();
    expect(summary).toEqual({ sent: 1, dropped: 1, failed: 1 });
    expect(sent).toEqual(["https://push/a"]);
    expect(deleted).toEqual(["b"]);
  });

  it("passes the payload as JSON with a one-day TTL and the VAPID details", async () => {
    const { db } = fakeDb([{ id: "a", endpoint: "https://push/a", p256dh: "k", auth: "s" }]);
    const calls: Array<{ body: string; ttl: number; subject: string }> = [];
    const send: PushSender = async (_sub, body, opts) => {
      calls.push({ body, ttl: opts.TTL, subject: opts.vapidDetails.subject });
    };
    await sendPush("u1", payload, { db, send });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body)).toEqual(payload);
    expect(calls[0].ttl).toBe(86_400);
    expect(calls[0].subject).toBe("mailto:test@example.com");
  });

  it("a failed read is a zero summary, not a throw", async () => {
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: new Error("down") }) }) }) } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendPush("u1", payload, { db, send: async () => {} })).resolves.toEqual({ sent: 0, dropped: 0, failed: 0 });
    errors.mockRestore();
  });
});
