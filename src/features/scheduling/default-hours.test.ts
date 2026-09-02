import { describe, it, expect } from "vitest";
import {
  DEFAULT_END_TIME,
  DEFAULT_START_TIME,
  defaultHourRows,
  seedDefaultHours,
} from "./default-hours";
import { nextInterval } from "./time-options";

/* The week a bookable owner starts with. Before this, a new account's every
   day read "Unavailable" until the owner clicked "+" on each of them, so a
   freshly claimed booking page offered no slots at all. */

const STAFF = { staffId: "11111111-1111-4111-8111-111111111111" };
const SPACE = { rentalOfferingId: "22222222-2222-4222-8222-222222222222" };

describe("defaultHourRows", () => {
  it("opens Monday to Friday, 09:00–17:00", () => {
    const rows = defaultHourRows("org-1", STAFF);
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => [r.start_time, r.end_time])).toEqual(
      Array.from({ length: 5 }, () => ["09:00", "17:00"]),
    );
  });

  it("leaves the weekend closed — Saturday and Sunday get no row", () => {
    const weekdays = defaultHourRows("org-1", STAFF).map((r) => r.weekday);
    expect(weekdays).not.toContain(0);
    expect(weekdays).not.toContain(6);
  });

  it("uses the same window the '+' button gives an empty day", () => {
    expect(nextInterval([])).toEqual({ startTime: DEFAULT_START_TIME, endTime: DEFAULT_END_TIME });
  });

  it("keys every row to a staff owner, leaving the space column null", () => {
    const rows = defaultHourRows("org-1", STAFF);
    expect(rows.every((r) => r.staff_id === STAFF.staffId && r.rental_offering_id === null)).toBe(true);
    expect(rows.every((r) => r.org_id === "org-1")).toBe(true);
  });

  it("keys every row to a space owner, leaving the staff column null (0056's XOR)", () => {
    const rows = defaultHourRows("org-1", SPACE);
    expect(rows.every((r) => r.rental_offering_id === SPACE.rentalOfferingId && r.staff_id === null)).toBe(true);
  });
});

type SeedError = { message: string; code?: string };
function fakeClient(error: SeedError | null = null) {
  const calls: Array<{ table: string; rows: unknown }> = [];
  const client = {
    from: (table: string) => ({
      insert: async (rows: unknown) => {
        calls.push({ table, rows });
        return { error };
      },
    }),
  };
  return { calls, client: client as unknown as Parameters<typeof seedDefaultHours>[0] };
}

describe("seedDefaultHours", () => {
  it("writes the whole week in one insert (all five rows land or none do)", async () => {
    const { calls, client } = fakeClient();
    expect(await seedDefaultHours(client, "org-1", STAFF)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("availability_rules");
    expect(calls[0].rows).toEqual(defaultHourRows("org-1", STAFF));
  });

  it("hands the insert error back — code included, so callers can map 23P01", async () => {
    const { client } = fakeClient({ message: "conflicting key value", code: "23P01" });
    expect(await seedDefaultHours(client, "org-1", SPACE)).toMatchObject({ code: "23P01" });
  });
});
