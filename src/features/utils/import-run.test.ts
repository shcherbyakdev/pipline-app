import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runImport } from "./import-run";
import type { ImportRow } from "./import-rows";

/* A thenable query builder: every chained call returns itself, awaiting it
   yields the queued result. Enough to script the already-imported lookup. */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "limit"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => void) => resolve(result);
  return b;
}

function stubClient(lookups: { data: unknown; error: unknown }[]) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from: () => builder(lookups.shift() ?? { data: [], error: null }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return fn === "create_rental_booking_hours_admin" ? { data: `booking-${rpcCalls.length}`, error: null } : { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

const row = (n: number): ImportRow => ({
  row: n, offeringId: "11111111-1111-4111-8111-111111111111", startsAt: "2026-10-05T08:00:00.000Z", durationMin: 60, name: `Client ${n}`, paid: false,
});

describe("runImport (S8) — a failed already-imported lookup is one failed row, not an aborted run", () => {
  it("reports the row as failed with the error and keeps writing the rest", async () => {
    const { client, rpcCalls } = stubClient([
      { data: null, error: { message: "boom", code: "XX000" } },
      { data: [], error: null },
    ]);
    const out = await runImport(client, [row(2), row(3)]);
    expect(out).toEqual([
      { row: 2, status: "failed", reason: expect.stringMatching(/boom/) },
      { row: 3, status: "created", bookingId: "booking-1" },
    ]);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["create_rental_booking_hours_admin"]);
  });
});
