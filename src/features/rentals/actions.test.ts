import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* createOffering (the "New space" dialog): a space reaches the public page
   only once it has an active unit (lib/booking/public.ts listPublicOfferings),
   and the D9 rule 404s the page until then. A space is its own unit until
   split, so the two are made — and refused — together: the plan gate
   createUnit uses runs BEFORE the space is saved, and a unit insert that
   fails takes the space back out. deleteUnit keeps the last one. */

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Row }>,
  updates: [] as Array<{ table: string; row: Row }>,
  deletes: [] as string[],
  units: [] as Array<{ id: string }>,
  unitInsertError: null as null | { message: string },
  hoursInsertError: null as null | { message: string },
}));
const assertCanAddUnit = vi.hoisted(() => vi.fn(async () => null as Refused | null));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The action's copy comes from messages/en.json (i18n Wave 3); the
// expectations below quote the English so a reworded notice is noticed.
vi.mock("next-intl/server", async () => {
  const { translatorFor } = await import("@/i18n/test-translator");
  return { getTranslations: async (namespace: never) => translatorFor("en", namespace) };
});
vi.mock("@/lib/flags/resolve", () => ({ getDashboardFlags: async () => ({ rentals: true }) }));
vi.mock("@/lib/billing/gates", () => ({ assertCanAddUnit }));
import type { Refused } from "@/lib/billing/gates";
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
              : { data: state.units, error: state.unitInsertError };
      const b: Record<string, unknown> = {
        select: () => b,
        limit: () => b,
        maybeSingle: async () => result(),
        single: async () => result(),
        insert: (row: Row) => {
          state.inserts.push({ table, row });
          return b;
        },
        update: (row: Row) => {
          state.updates.push({ table, row });
          return b;
        },
        delete: () => {
          state.deletes.push(table);
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

import { createOffering, updateOffering, deleteUnit } from "./actions";

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
  state.updates = [];
  state.deletes = [];
  state.units = [];
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

  it("when the plan refuses the unit, it refuses the space with it — nothing is saved", async () => {
    const refusal: Refused = {
      ok: false,
      error: "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more.",
      upgrade: { href: "/billing", label: "Open Billing" },
    };
    assertCanAddUnit.mockResolvedValue(refusal);
    // The refusal is the result, door included — the same as createUnit's.
    expect(await createOffering(space)).toEqual(refusal);
    expect(state.inserts).toEqual([]);
  });

  it("when the unit insert fails, the space is taken back out", async () => {
    state.unitInsertError = { message: "boom" };
    const result = await createOffering(space);
    expect(result.ok).toBe(false);
    expect(state.inserts.map((i) => i.table)).toEqual(["rental_offerings", "rental_units"]);
    expect(state.deletes).toEqual(["rental_offerings"]);
  });
});

describe("deleteUnit — a space keeps its last unit", () => {
  const input = { id: "11111111-1111-4111-8111-111111111111", offeringId: "22222222-2222-4222-8222-222222222222" };

  it("refuses to delete the only unit and says to delete the space instead", async () => {
    state.units = [{ id: "unit-1" }];
    expect(await deleteUnit(input)).toEqual({
      ok: false,
      error: "That's the space's last unit — to remove it, delete the space.",
    });
    expect(state.deletes).toEqual([]);
  });

  it("deletes one of several", async () => {
    state.units = [{ id: "unit-1" }, { id: "unit-2" }];
    expect(await deleteUnit(input)).toEqual({ ok: true });
    expect(state.deletes).toEqual(["rental_units"]);
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

/* A single-unit space never shows its unit (the space IS the unit), so the
   unit's name must follow the space's — otherwise a rename leaves mail
   reading "Apartment · Flat". A multi-unit space's units are the owner's. */
describe("updateOffering — a single-unit space renames its unit with itself", () => {
  const edit = { id: "00000000-0000-4000-8000-000000000001", ...space, name: "Apartment" };

  it("renames the sole unit to the space's new name", async () => {
    state.units = [{ id: "unit-1" }];
    expect(await updateOffering(edit)).toEqual({ ok: true });
    expect(state.updates.filter((u) => u.table === "rental_units")).toEqual([
      { table: "rental_units", row: { name: "Apartment" } },
    ]);
  });

  it("leaves a multi-unit space's units alone", async () => {
    state.units = [{ id: "unit-1" }, { id: "unit-2" }];
    expect(await updateOffering(edit)).toEqual({ ok: true });
    expect(state.updates.filter((u) => u.table === "rental_units")).toEqual([]);
  });
});
