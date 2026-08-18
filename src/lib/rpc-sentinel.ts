// Matching the bare sentinels our plpgsql RPCs raise (`raise exception
// 'taken'`, `'staff_unavailable'`, `'last_active_staff'`, …).
//
// PostgREST passes a P0001 message through VERBATIM — verified against the
// local stack, POST /rest/v1/rpc/create_booking with an unknown handle:
//
//   {"code":"P0001","details":null,"hint":null,"message":"not found"}
//
// so the sentinel arrives as the WHOLE message, never wrapped in prose. The
// substring tests this replaces would therefore match nothing extra that is
// ours — but they would also fire on any unrelated Postgres/PostgREST error
// whose text happens to contain the word ("taken" and "started" are ordinary
// English), quietly relabelling a real bug as "that slot was just taken".
// Equality keeps the mapping to exactly what the RPC meant to say.
//
// Its own tiny module, not a const inside an action file: a `"use server"`
// file may only export async functions, so a pure predicate living there could
// not be unit-tested (booking-errors.ts precedent).

export function isRpcSentinel(
  error: { message?: string | null } | null | undefined,
  sentinel: string,
): boolean {
  return error?.message?.trim() === sentinel;
}
