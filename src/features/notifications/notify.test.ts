import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundEmail } from "@/lib/email/transport";

// The seam's production defaults (admin client, Resend/SMTP transport, the
// real push sender) all reach @/env; every dependency is injected here, so
// the modules only need to load.
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("not used"); } }));
vi.mock("@/lib/email/transport", () => ({ selectTransport: () => { throw new Error("not used"); } }));

import { notifyMembers, pushUrlFor } from "./notify";
import type { PushPayload } from "./push";

type Member = { user_id: string; notification_prefs: unknown; email?: string | null };

/** org_members + orgs + auth.admin.getUserById, nothing more. */
function fakeDb(members: Member[], locale = "en") {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "org_members") {
            return Promise.resolve({ data: members.map(({ user_id, notification_prefs }) => ({ user_id, notification_prefs })), error: null });
          }
          if (table === "orgs") return { maybeSingle: async () => ({ data: { name: "Studio", locale }, error: null }) };
          throw new Error(`unexpected table ${table}`);
        },
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { email: members.find((m) => m.user_id === id)?.email ?? null } },
          error: null,
        }),
      },
    },
  } as unknown as SupabaseClient;
}

function harness(members: Member[], opts: { locale?: string; pushThrows?: boolean } = {}) {
  const emails: OutboundEmail[] = [];
  const pushes: Array<{ userId: string; payload: PushPayload }> = [];
  return {
    emails,
    pushes,
    deps: {
      db: fakeDb(members, opts.locale),
      transport: { send: async (m: OutboundEmail) => { emails.push(m); return { id: "x" }; } },
      push: async (userId: string, payload: PushPayload) => {
        if (opts.pushThrows) throw new Error("push down");
        pushes.push({ userId, payload });
      },
    },
  };
}

const base = { orgId: "org1", serviceName: "Massage", clientName: "Anna", clientEmail: "anna@example.com", whenLine: "Mon 10:00", idempotencyKey: "b1:provider-new" };

describe("notifyMembers", () => {
  it("email off + push on → one push, no email", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: { newBooking: { email: false, push: true } } }]);
    await notifyMembers({ ...base, event: "newBooking" }, h.deps);
    expect(h.emails).toEqual([]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toEqual({
      userId: "u1",
      payload: { title: "New booking", body: "Anna · Massage · Mon 10:00", url: "/bookings", tag: "b1:provider-new" },
    });
  });

  it("defaults (null prefs) → both channels; the mail is the provider template with reply-to the client", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }]);
    await notifyMembers({ ...base, event: "newBooking" }, h.deps);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("owner@example.com");
    expect(h.emails[0].subject).toBe("New booking — Massage, Mon 10:00");
    expect(h.emails[0].replyTo).toBe("anna@example.com");
    expect(h.emails[0].idempotencyKey).toBe("b1:provider-new");
    expect(h.pushes).toHaveLength(1);
  });

  it("a request reads as a request on both channels and lands in the inbox", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }]);
    await notifyMembers({ ...base, event: "newRequest", idempotencyKey: "b1:provider-new" }, h.deps);
    expect(h.emails[0].subject).toBe("New booking request — Massage, Mon 10:00");
    expect(h.pushes[0].payload.title).toBe("New booking request");
    expect(h.pushes[0].payload.url).toBe("/overview");
    expect(pushUrlFor("cancelled")).toBe("/bookings");
  });

  it("the org's language, not English, when the org is Ukrainian", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }], { locale: "uk" });
    await notifyMembers({ ...base, event: "cancelled", idempotencyKey: "b1:provider-cancelled" }, h.deps);
    expect(h.pushes[0].payload.title).toBe("Скасовано клієнтом");
    expect(h.emails[0].subject.startsWith("Скасовано клієнтом")).toBe(true);
  });

  it("a throwing push channel does not stop the email, and the promise resolves", async () => {
    const h = harness([{ user_id: "u1", email: "owner@example.com", notification_prefs: null }], { pushThrows: true });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyMembers({ ...base, event: "rescheduled", oldWhenLine: "Sun 10:00", idempotencyKey: "b2:provider-rescheduled" }, h.deps)).resolves.toBeUndefined();
    errors.mockRestore();
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toBe("Rescheduled by client — Massage, Mon 10:00");
  });

  it("a member without an address gets push only; two members get distinct dedupe keys", async () => {
    const h = harness([
      { user_id: "u1", email: "owner@example.com", notification_prefs: null },
      { user_id: "u2", email: null, notification_prefs: null },
    ]);
    await notifyMembers({ ...base, event: "newBooking" }, h.deps);
    expect(h.emails.map((e) => e.idempotencyKey)).toEqual(["b1:provider-new:u1"]);
    expect(h.pushes.map((p) => p.userId)).toEqual(["u1", "u2"]);
  });

  it("a failed members read is logged, never thrown", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error("down") }) }) }) } as unknown as SupabaseClient;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyMembers({ ...base, event: "newBooking" }, { db, transport: { send: async () => ({ id: "x" }) }, push: async () => {} })).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
