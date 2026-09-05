import { describe, it, expect, vi } from "vitest";

// reminders.ts resolves the "With {staff}" line through @/lib/booking/public,
// which pulls in the admin Supabase client and with it @/env's eager parse of
// process.env — none of which plain `npm run test` provides (only the
// integration job does). decideReminder is pure; keep this file free of that
// import graph.
vi.mock("@/lib/booking/public", () => ({
  resolveClientStaffName: async () => null,
}));

import { decideReminder, REMINDER_LEAD_MS } from "./reminders";

const T0 = new Date("2027-02-10T12:00:00Z");
const hours = (n: number) => n * 60 * 60 * 1000;

describe("decideReminder", () => {
  it("waits while the booking is further out than the lead window", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + REMINDER_LEAD_MS + hours(1)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("wait");
  });

  it("sends inside the lead window for an early-created booking", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + hours(2)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("send");
  });

  it("suppresses when the booking was created inside the lead window", () => {
    // Booked 3h before start: the confirmation email IS the reminder.
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + hours(2)), createdAt: new Date(T0.getTime() - hours(1)) },
        T0,
      ),
    ).toBe("suppress");
  });

  it("suppresses once the booking has started", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() - hours(1)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("suppress");
  });

  it("suppresses when the org is over its free reminder quota", () => {
    const now = new Date("2026-08-18T10:00:00Z");
    const booking = { startsAt: new Date("2026-08-19T09:00:00Z"), createdAt: new Date("2026-08-10T00:00:00Z") };
    expect(decideReminder(booking, now)).toBe("send");
    expect(decideReminder(booking, now, { overQuota: true })).toBe("suppress");
  });
});

describe("decideReminder with an org's own policy (spec 2026-09-05)", () => {
  it("a 2h lead waits at 3h out and sends at 1h out", () => {
    const early = new Date(T0.getTime() - hours(48));
    expect(decideReminder({ startsAt: new Date(T0.getTime() + hours(3)), createdAt: early }, T0, { leadMs: hours(2) })).toBe("wait");
    expect(decideReminder({ startsAt: new Date(T0.getTime() + hours(1)), createdAt: early }, T0, { leadMs: hours(2) })).toBe("send");
  });

  it("the booked-inside-the-window rule follows the effective lead", () => {
    // Booked 5h before a 2h-lead reminder: outside the window → still a real reminder.
    expect(
      decideReminder({ startsAt: new Date(T0.getTime() + hours(1)), createdAt: new Date(T0.getTime() - hours(4)) }, T0, { leadMs: hours(2) }),
    ).toBe("send");
    // Booked 30 minutes before: the confirmation just arrived.
    expect(
      decideReminder({ startsAt: new Date(T0.getTime() + hours(1)), createdAt: new Date(T0.getTime() - hours(0.5)) }, T0, { leadMs: hours(2) }),
    ).toBe("suppress");
  });

  it("reminders switched off suppress (stamped, never rescanned)", () => {
    const booking = { startsAt: new Date(T0.getTime() + hours(2)), createdAt: new Date(T0.getTime() - hours(48)) };
    expect(decideReminder(booking, T0, { disabled: true })).toBe("suppress");
  });

  it("a row not yet due is left alone even while reminders are off or the quota is spent", () => {
    // 40h out on a 24h lead: inside the 48h query window, outside this org's lead.
    const booking = { startsAt: new Date(T0.getTime() + hours(40)), createdAt: new Date(T0.getTime() - hours(48)) };
    expect(decideReminder(booking, T0, { disabled: true, leadMs: hours(24) })).toBe("wait");
    expect(decideReminder(booking, T0, { overQuota: true, leadMs: hours(24) })).toBe("wait");
  });
});

describe("runReminderDrain reads each org's policy", () => {
  type Row = {
    id: string; org_id: string; client_email: string | null; starts_at: string; ends_at: string; created_at: string;
    reminder_attempts: number; rental_unit_id: null; locale: null; services: { name: string }; rental_offerings: null;
    rental_units: null; orgs: { name: string; timezone: string; locale: string; notification_prefs: unknown }; staff: null;
  };
  const row = (id: string, org: string, startsInH: number, prefs: unknown): Row => ({
    id, org_id: org, client_email: `${id}@example.com`,
    starts_at: new Date(T0.getTime() + hours(startsInH)).toISOString(),
    ends_at: new Date(T0.getTime() + hours(startsInH + 1)).toISOString(),
    created_at: new Date(T0.getTime() - hours(72)).toISOString(),
    reminder_attempts: 0, rental_unit_id: null, locale: null, services: { name: "Massage" }, rental_offerings: null,
    rental_units: null, orgs: { name: "Studio", timezone: "UTC", locale: "en", notification_prefs: prefs }, staff: null,
  });

  /** A bookings table that answers the drain's one select and records claims. */
  function fakeDb(rows: Row[]) {
    const claimed: string[] = [];
    const stamped: string[] = [];
    const chain = (rowsOut: unknown) => {
      const q = { data: rowsOut, error: null } as { data: unknown; error: null };
      const self: Record<string, unknown> = {};
      for (const m of ["eq", "is", "lt", "gt", "lte", "order", "limit", "select"]) self[m] = () => self;
      self.then = (res: (v: typeof q) => unknown) => res(q);
      return self;
    };
    const db = {
      from: () => ({
        select: () => chain(rows),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            if (patch.reminder_sent_at) { claimed.push(id); stamped.push(id); }
            const ok = { data: [{ id }], error: null };
            const q: Record<string, unknown> = {};
            for (const m of ["is", "eq", "select"]) q[m] = () => q;
            q.then = (res: (v: typeof ok) => unknown) => res(ok);
            return q;
          },
        }),
      }),
    };
    return { db: db as never, claimed, stamped };
  }

  it("a short-lead org's far-out booking is left alone while a long-lead org's is sent; reminders off is stamped", async () => {
    const { runReminderDrain } = await import("./reminders");
    const rows = [
      row("a", "orgA", 40, { reminder: { enabled: true, leadHours: 1 } }),
      row("b", "orgB", 40, { reminder: { enabled: true, leadHours: 48 } }),
      row("c", "orgC", 20, { reminder: { enabled: false, leadHours: 24 } }),
    ];
    const { db, claimed } = fakeDb(rows);
    const sent: string[] = [];
    const summary = await runReminderDrain({
      db,
      transport: { send: async (m) => { sent.push(m.to); return { id: "x" }; } },
      now: T0,
    });
    expect(sent).toEqual(["b@example.com"]);
    expect(claimed.sort()).toEqual(["b", "c"]);
    expect(summary).toEqual({ sent: 1, skipped: 1, failed: 0 });
  });

  it("the quota is only asked for rows that would otherwise send", async () => {
    const { runReminderDrain } = await import("./reminders");
    const rows = [
      row("w", "orgA", 40, { reminder: { enabled: true, leadHours: 24 } }), // wait
      row("s", "orgA", 20, { reminder: { enabled: true, leadHours: 24 } }), // send
      row("o", "orgB", 20, { reminder: { enabled: false, leadHours: 24 } }), // off → suppress, no quota read
    ];
    const { db } = fakeDb(rows);
    const asked: string[] = [];
    await runReminderDrain({
      db,
      transport: { send: async () => ({ id: "x" }) },
      now: T0,
      quotaExceeded: async (orgId) => { asked.push(orgId); return false; },
    });
    expect(asked).toEqual(["orgA"]);
  });

  it("without the custom-reminders perk every org is a 24h org", async () => {
    const { runReminderDrain } = await import("./reminders");
    const rows = [row("b", "orgB", 40, { reminder: { enabled: true, leadHours: 48 } })];
    const { db } = fakeDb(rows);
    const sent: string[] = [];
    await runReminderDrain({
      db,
      transport: { send: async (m) => { sent.push(m.to); return { id: "x" }; } },
      now: T0,
      customRemindersAllowed: async () => false,
    });
    expect(sent).toEqual([]);
  });
});
