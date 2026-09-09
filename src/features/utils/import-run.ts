// S8 migration kit: write parsed rows through the admin hours RPC as
// service_role (0085 admits that caller), one row per call, and report per
// row. Not atomic on purpose — a studio fixes the two rows that failed and
// re-runs the file; rows already imported collide on the booking_units
// EXCLUDE and come back as `skipped`, so a re-run is safe.
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { isRpcSentinel } from "@/lib/rpc-sentinel";
import type { ImportRow } from "./import-rows";

export type ImportResult = {
  row: number;
  status: "created" | "skipped" | "failed";
  bookingId?: string;
  /** Skipped/failed: why. Created: present only when the paid mark did not land. */
  reason?: string;
};

type RpcError = { message?: string; code?: string };

// The RPC's own "no unit survives" sentinel, the EXCLUDE (23P01) and a lost
// deadlock race (40P01) all mean the slot is held — most often by the very
// booking this row imported last time.
const isTaken = (e: RpcError) => isRpcSentinel(e, "taken") || e.code === "23P01" || e.code === "40P01";

export async function runImport(admin: SupabaseClient, rows: ImportRow[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const r of rows) {
    const { data, error } = await admin.rpc("create_rental_booking_hours_admin", {
      p_offering_id: r.offeringId,
      p_unit_id: null,
      p_starts_at: r.startsAt,
      p_duration_min: r.durationMin,
      p_name: r.name,
      p_email: r.email ?? null,
      p_note: r.note ?? null,
      // The manage token is never handed out for an imported booking; the
      // hash is still required by the row.
      p_token_hash: generateAccessToken().tokenHash,
    });
    if (error) {
      out.push(
        isTaken(error)
          ? { row: r.row, status: "skipped", reason: "Conflicts with an existing booking (already imported?)." }
          : { row: r.row, status: "failed", reason: describe(error) },
      );
      continue;
    }
    const bookingId = data as string;
    if (!r.paid) {
      out.push({ row: r.row, status: "created", bookingId });
      continue;
    }
    const paid = await admin.rpc("mark_booking_paid", { p_booking_id: bookingId });
    // nothing_due: an unpriced space has nothing to settle — still a clean import.
    if (paid.error && !isRpcSentinel(paid.error, "nothing_due")) {
      out.push({ row: r.row, status: "created", bookingId, reason: `Created, but marking paid failed: ${describe(paid.error)}` });
      continue;
    }
    out.push({ row: r.row, status: "created", bookingId });
  }
  return out;
}

/** The RPCs raise `not found` for every setup refusal (outside hours, off
    the grid, inactive space) — name the likely cause instead of echoing it. */
function describe(e: RpcError): string {
  if (isRpcSentinel(e, "not found")) return "Refused by the space's setup (outside opening hours, off the duration grid, or inactive).";
  return e.message ? `${e.code ? `${e.code}: ` : ""}${e.message}` : "Unknown error.";
}
