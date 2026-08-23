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
