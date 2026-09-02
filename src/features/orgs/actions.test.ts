import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* createOrgWithPage (one-step onboarding): the org, its handle and its first
   team member are minted by create_org_with_page. That member used to arrive
   with no hours at all, so a freshly claimed page opened on seven
   "Unavailable" days and offered no slots. */

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  rpcOrg: { id: "org-1" } as Row | null,
  staffRow: { id: "staff-1" } as Row | null,
  insertError: null as null | { message: string },
  inserts: [] as Array<{ table: string; rows: unknown }>,
}));

// actions.ts reaches @/env through the branding-storage import chain; env.ts
// parses real process.env at module load (billing/dev/guard.test.ts idiom).
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54351",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", async () => {
  const { enTranslator } = await import("@/i18n/test-translator");
  return { getLocale: async () => "en", getTranslations: async (ns: "errors") => enTranslator(ns) };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentOrg: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async () => ({ data: state.rpcOrg, error: null }),
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: state.staffRow, error: null }),
        insert: (rows: unknown) => {
          state.inserts.push({ table, rows });
          return Promise.resolve({ error: state.insertError });
        },
      };
      return b;
    },
  }),
}));

import { createOrgWithPage } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}
// Mode left createOrgWithPage (wizard's mode step owns it now); every org
// is created as appointments and gets the seeded week.
const onboarding = () => form({ name: "Anna Studio", handle: "anna-studio", timezone: "Europe/Warsaw" });

const hourRows = () => state.inserts.filter((i) => i.table === "availability_rules");

beforeEach(() => {
  state.rpcOrg = { id: "org-1" };
  state.staffRow = { id: "staff-1" };
  state.insertError = null;
  state.inserts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("createOrgWithPage — a new account is bookable on day one", () => {
  it("gives a new org's first member Mon–Fri 09:00–17:00 and opens the wizard", async () => {
    await expect(createOrgWithPage({}, onboarding())).rejects.toThrow(/^REDIRECT:\/onboarding\?step=mode/);
    expect(hourRows()).toHaveLength(1);
    const rows = hourRows()[0].rows as Array<Row>;
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({
      org_id: "org-1",
      staff_id: "staff-1",
      rental_offering_id: null,
      start_time: "09:00",
      end_time: "17:00",
    });
  });

  it("still lands the owner in the wizard when the seed fails", async () => {
    state.insertError = { message: "boom" };
    await expect(createOrgWithPage({}, onboarding())).rejects.toThrow(/^REDIRECT:\/onboarding\?step=mode/);
  });

  it("does not guess a staff id when the row cannot be read back", async () => {
    state.staffRow = null;
    await expect(createOrgWithPage({}, onboarding())).rejects.toThrow(/^REDIRECT:\/onboarding\?step=mode/);
    expect(hourRows()).toHaveLength(0);
  });
});
