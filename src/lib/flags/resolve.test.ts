// resolve.ts imports the Supabase server/admin clients → "@/env" (eager
// parse) — stub the vars before a DYNAMIC import (gates.test.ts idiom).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS } from "./index";
const { mergeFlags, getOrgFlags } = await import("./resolve");

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
