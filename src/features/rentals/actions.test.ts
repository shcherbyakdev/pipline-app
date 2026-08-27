import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* createOffering (the "New space" dialog): a space reaches the public page
   only once it has an active unit (lib/booking/public.ts listPublicOfferings),
   and the D9 rule 404s the page until then. So creating a space also creates
   its first unit — through the same plan gate createUnit uses. */

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Row }>,
  unitInsertError: null as null | { message: string },
  hoursInsertError: null as null | { message: string },
}));
const assertCanAddUnit = vi.hoisted(() => vi.fn(async () => null as string | null));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/flags/resolve", () => ({ getDashboardFlags: async () => ({ rentals: true }) }));
vi.mock("@/lib/billing/gates", () => ({ assertCanAddUnit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const result = () =>
        table === "orgs"
          ? { data: { id: "org-1" }, error: null }
          : table === "rental_offerings"
            ? { data: { id: "off-1" }, error: null }
            : table === "availability_rules"
              ? { data: null, error: state.hoursInsertError }
              : { data: null, error: state.unitInsertError };
      const b: Record<string, unknown> = {
        select: () => b,
        limit: () => b,
        maybeSingle: async () => result(),
        single: async () => result(),
        insert: (row: Row) => {
          state.inserts.push({ table, row });
          return b;
        },
        eq: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  }),
}));

import { createOffering } from "./actions";

const space = {
  name: "Room A",
  rangeMode: "nights",
  startTime: "15:00",
  endTime: "11:00",
  minStay: 1,
  maxStay: null,
  turnoverDays: 0,
  minNoticeDays: 0,
};

beforeEach(() => {
  state.inserts = [];
  state.unitInsertError = null;
  state.hoursInsertError = null;
  assertCanAddUnit.mockReset();
  assertCanAddUnit.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("createOffering — a space is bookable the moment it exists", () => {
  it("creates the space's first unit, active and named after the space", async () => {
    expect(await createOffering(space)).toEqual({ ok: true });
    const unit = state.inserts.find((i) => i.table === "rental_units");
    expect(unit?.row).toEqual({
      org_id: "org-1",
      offering_id: "off-1",
      name: "Room A",
      description: null,
      active: true,
    });
    expect(assertCanAddUnit).toHaveBeenCalledTimes(1);
  });

  it("when the plan refuses the unit, the space still exists and the owner is told why", async () => {
    const refusal = "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more.";
    assertCanAddUnit.mockResolvedValue(refusal);
    expect(await createOffering(space)).toEqual({ ok: true, notice: refusal });
    expect(state.inserts.map((i) => i.table)).toEqual(["rental_offerings"]);
  });

  it("when the unit insert fails, the space still exists and the owner is pointed at its page", async () => {
    state.unitInsertError = { message: "boom" };
    expect(await createOffering(space)).toEqual({
      ok: true,
      notice: "Saved the space, but couldn't add its first unit — add one on the space's page.",
    });
    expect(state.inserts.map((i) => i.table)).toEqual(["rental_offerings", "rental_units"]);
  });
});

/* An hourly space has no check-in/check-out times to fall back on: with no
   weekly hours it offers nothing, exactly like a new team member did. */
const hourlySpace = {
  name: "Studio B",
  rangeMode: "hours",
  slotIncrementMin: 30,
  minDurationMin: 60,
  maxDurationMin: 120,
  turnoverMin: 0,
  minNoticeMin: 0,
};

describe("createOffering — an hourly space starts with the default week", () => {
  it("seeds Mon–Fri 09:00–17:00 for the new space", async () => {
    expect(await createOffering(hourlySpace)).toEqual({ ok: true });
    const hours = state.inserts.filter((i) => i.table === "availability_rules");
    expect(hours).toHaveLength(1);
    const rows = hours[0].row as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({
      org_id: "org-1",
      rental_offering_id: "off-1",
      staff_id: null,
      start_time: "09:00",
      end_time: "17:00",
    });
  });

  it("leaves a nightly space alone — check-in and check-out live on the space", async () => {
    await createOffering(space);
    expect(state.inserts.map((i) => i.table)).not.toContain("availability_rules");
  });

  it("when the hours seed fails, the space still exists and the owner is pointed at Availability", async () => {
    state.hoursInsertError = { message: "boom" };
    expect(await createOffering(hourlySpace)).toEqual({
      ok: true,
      notice: "Saved the space, but couldn't set its default hours — set them on Availability.",
    });
  });
});
