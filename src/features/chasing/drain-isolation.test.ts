/**
 * Recur-phase isolation (slice 11, final review finding 1): a recur_due RPC
 * failure must not abort the chase phase — runDrain should degrade to
 * chase-only and surface the failure via recurError, never throw. Plain
 * vitest (no local Supabase stack needed): a fake SupabaseClient stub
 * stands in for the DB.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";

// drain.ts imports @/env transitively (via @/lib/email/transport and
// @/lib/org-branding), which parses process.env eagerly at module scope.
// Plain `npm run test` CI does not set the Supabase env vars (only the
// integration job does), so stub them here before the dynamic import runs.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { runDrain } = await import("./drain");

// Minimal fake: `rpc("recur_due")` throws (simulating an RPC error), and
// `.from("chases")` resolves an empty due-scan so the chase phase runs
// cleanly with nothing to send.
function fakeDb(): SupabaseClient {
  const chasesQuery = {
    select: () => chasesQuery,
    lte: () => chasesQuery,
    is: () => chasesQuery,
    order: () => chasesQuery,
    limit: () => Promise.resolve({ data: [], error: null }),
  };
  const stub = {
    rpc: (fn: string) => {
      if (fn === "recur_due") throw new Error("recur_due boom");
      throw new Error(`fakeDb: unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      if (table === "chases") return chasesQuery;
      throw new Error(`fakeDb: unexpected table ${table}`);
    },
  };
  return stub as unknown as SupabaseClient;
}

function fakeTransport(): EmailTransport {
  return {
    async send() {
      throw new Error("fakeTransport: send should not be called in this test");
    },
  };
}

describe("runDrain: recur-phase isolation", () => {
  it("a recur_due RPC failure does not abort the chase phase", async () => {
    const summary = await runDrain({ db: fakeDb(), transport: fakeTransport() });
    expect(summary.recurError).toBeTruthy();
    expect(summary.recurError).toContain("recur_due boom");
    expect(summary.rearmed).toBe(0);
    expect(summary.chasesStarted).toBe(0);
    expect(summary.sent).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(0);
  });
});
