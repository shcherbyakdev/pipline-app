// resolve.ts imports the Supabase server/admin clients → "@/env" (eager
// parse) — stub the vars before a DYNAMIC import (gates.test.ts idiom).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS } from "./index";

/* Both Supabase client factories are replaced for the whole file so the two
   DEGRADE paths can be exercised without a cookie store (next/headers) or a
   service-role key: each hands back a client whose read resolves to an error,
   which is what a PostgREST schema-cache window — or a deploy where 0044/0045
   have not landed — looks like from here. The stub clients are inlined rather
   than reusing stubClient below: vi.mock is hoisted above it. */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error("dashboard read boom") }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error("admin read boom") }) }) }),
  }),
}));

const { mergeFlags, getOrgFlags, getDashboardFlags, getOrgFlagsAdmin } = await import("./resolve");

describe("mergeFlags", () => {
  it("no rows → the defaults, as a fresh object", () => {
    const flags = mergeFlags([]);
    expect(flags).toEqual(FLAG_DEFAULTS);
    expect(flags).not.toBe(FLAG_DEFAULTS);
  });
  it("a row overrides its flag either way", () => {
    expect(mergeFlags([{ flag: "billing", enabled: true }]).billing).toBe(true);
    expect(mergeFlags([{ flag: "billing", enabled: false }]).billing).toBe(false);
  });
  it("unknown flags are ignored", () => {
    expect(mergeFlags([{ flag: "unicorns", enabled: true }])).toEqual(FLAG_DEFAULTS);
  });
});

/** Minimal chainable stub: from().select().eq() resolves to `result`. */
function stubClient(result: { data: unknown; error: unknown }): SupabaseClient {
  const eq = () => Promise.resolve(result);
  const select = () => ({ eq });
  const from = () => ({ select });
  return { from } as unknown as SupabaseClient;
}

describe("getOrgFlags", () => {
  it("merges the org's rows over the defaults", async () => {
    const client = stubClient({ data: [{ flag: "rentals", enabled: true }], error: null });
    const flags = await getOrgFlags("org-1", client);
    expect(flags).toEqual({ ...FLAG_DEFAULTS, rentals: true });
  });
  it("throws on a read error (callers decide how to degrade)", async () => {
    const client = stubClient({ data: null, error: new Error("boom") });
    await expect(getOrgFlags("org-1", client)).rejects.toThrow("boom");
  });
});

/* The flag-off defaults ARE the pre-branch product, so a failed read degrading
   to them can only reproduce it; throwing would take down every dashboard page
   (getDashboardFlags) or every booking page (getOrgFlagsAdmin) instead.
   Ruling at final review 2026-08-18. */
describe("degrade paths", () => {
  afterEach(() => vi.restoreAllMocks());

  it("getDashboardFlags → a fresh copy of the defaults, logged, not thrown", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const flags = await getDashboardFlags("org-1");
    expect(flags).toEqual(FLAG_DEFAULTS);
    expect(flags).not.toBe(FLAG_DEFAULTS);
    expect(logged).toHaveBeenCalled();
  });

  it("getOrgFlagsAdmin → a fresh copy of the defaults, logged, not thrown", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const flags = await getOrgFlagsAdmin("org-2");
    expect(flags).toEqual(FLAG_DEFAULTS);
    expect(flags).not.toBe(FLAG_DEFAULTS);
    expect(logged).toHaveBeenCalled();
  });
});
