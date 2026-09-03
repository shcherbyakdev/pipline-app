import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* applyDefaultHours — the one-click way out of a week with no hours at all
   (the editor shows the button only when every day is "Unavailable"). It is
   the same insert the org/space creation paths run, reached from the UI. */

const state = vi.hoisted(() => ({
  orgId: "org-1" as string | null,
  offeringFound: true,
  insertError: null as null | { message: string; code?: string },
  inserts: [] as Array<{ table: string; rows: unknown }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The action resolves its copy through next-intl's request-scoped
// getTranslations; under Vitest there is no request, so hand it the shipped
// English (integration-setup.ts idiom).
vi.mock("next-intl/server", async () => {
  const { translatorFor } = await import("@/i18n/test-translator");
  return {
    getLocale: async () => "en",
    getTranslations: async (ns: string) => translatorFor("en", ns as never),
  };
});
vi.mock("@/lib/billing/gates", () => ({ assertCanAddService: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        limit: () => b,
        maybeSingle: async () =>
          table === "orgs"
            ? { data: state.orgId ? { id: state.orgId } : null, error: null }
            : { data: state.offeringFound ? { id: "off-1" } : null, error: null },
        insert: (rows: unknown) => {
          state.inserts.push({ table, rows });
          return Promise.resolve({ error: state.insertError });
        },
      };
      return b;
    },
  }),
}));

import { applyDefaultHours } from "./actions";
import { enTranslator } from "@/i18n/test-translator";

const tErrors = enTranslator("errors");
const GENERIC_WRITE_ERROR = tErrors("generic");
const OVERLAP_ERROR = tErrors("availability.overlap");

const STAFF_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.orgId = "org-1";
  state.offeringFound = true;
  state.insertError = null;
  state.inserts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("applyDefaultHours", () => {
  it("fills a team member's empty week with Mon–Fri 09:00–17:00", async () => {
    expect(await applyDefaultHours({ staffId: STAFF_ID })).toEqual({ ok: true });
    const rows = state.inserts.find((i) => i.table === "availability_rules")?.rows as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      org_id: "org-1",
      staff_id: STAFF_ID,
      rental_offering_id: null,
      weekday: 1,
      start_time: "09:00",
      end_time: "17:00",
    });
  });

  it("fills an hourly space's week the same way", async () => {
    expect(await applyDefaultHours({ rentalOfferingId: SPACE_ID })).toEqual({ ok: true });
    const rows = state.inserts.find((i) => i.table === "availability_rules")?.rows as Array<
      Record<string, unknown>
    >;
    expect(rows[0]).toMatchObject({ rental_offering_id: SPACE_ID, staff_id: null });
  });

  it("refuses an input naming both owners", async () => {
    expect(await applyDefaultHours({ staffId: STAFF_ID, rentalOfferingId: SPACE_ID })).toEqual({
      ok: false,
      error: GENERIC_WRITE_ERROR,
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses an input naming no owner", async () => {
    expect(await applyDefaultHours({})).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a space that is not this org's", async () => {
    state.offeringFound = false;
    expect(await applyDefaultHours({ rentalOfferingId: SPACE_ID })).toEqual({
      ok: false,
      error: GENERIC_WRITE_ERROR,
    });
    expect(state.inserts).toHaveLength(0);
  });

  it("maps the overlap constraint to the shared copy (hours arrived between render and click)", async () => {
    state.insertError = { message: "conflicting key value", code: "23P01" };
    expect(await applyDefaultHours({ staffId: STAFF_ID })).toEqual({ ok: false, error: OVERLAP_ERROR });
  });
});
