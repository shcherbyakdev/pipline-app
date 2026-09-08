import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOKING_COLUMNS, toAdminBooking, type AdminBooking, type BookingRow } from "./queries";

/* S4 daily action list (spec 2026-09-08). ONE loader for two callers: the
   Overview page (user client under RLS) and the morning-digest drain phase
   (admin client). The org filter is always explicit so the two paths cannot
   diverge (spec ruling 9). Read errors throw: the page has its error
   boundary, the drain its per-org try. */

export const HOLDS_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BALANCES_WINDOW_DAYS = 30;
export const LIST_CAP = 50;

export type BalanceDue = AdminBooking & { balanceCents: number };
export type DailyList = { requests: AdminBooking[]; holds: AdminBooking[]; balances: BalanceDue[] };

export async function loadDailyList(
  db: SupabaseClient,
  orgId: string,
  fallbackTitle: string,
  now: Date = new Date(),
): Promise<DailyList> {
  const nowIso = now.toISOString();
  const [requests, holds, balances] = await Promise.all([
    db
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .gt("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(LIST_CAP),
    db
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending_payment")
      .lte("hold_expires_at", new Date(now.getTime() + HOLDS_WINDOW_MS).toISOString())
      .order("hold_expires_at", { ascending: true })
      .limit(LIST_CAP),
    loadBalances(db, orgId, fallbackTitle, now),
  ]);
  if (requests.error) throw requests.error;
  if (holds.error) throw holds.error;
  const rows = (data: unknown) => ((data ?? []) as unknown as BookingRow[]).map((b) => toAdminBooking(b, fallbackTitle));
  return { requests: rows(requests.data), holds: rows(holds.data), balances };
}

/* The balance is SQL's (0082 booking_balance_cents via list_balances_due,
   spec ruling 10): ids + amounts come back, then one select maps them to
   AdminBooking through the caller's own client, keeping the RPC's order. */
async function loadBalances(db: SupabaseClient, orgId: string, fallbackTitle: string, now: Date): Promise<BalanceDue[]> {
  const since = new Date(now.getTime() - BALANCES_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: due, error } = await db.rpc("list_balances_due", { p_org_id: orgId, p_since: since, p_limit: LIST_CAP });
  if (error) throw error;
  const order = ((due ?? []) as Array<{ id: string; balance_cents: number }>);
  if (order.length === 0) return [];
  const { data, error: rowsError } = await db
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("org_id", orgId)
    .in("id", order.map((r) => r.id));
  if (rowsError) throw rowsError;
  const byId = new Map(((data ?? []) as unknown as BookingRow[]).map((b) => [b.id, toAdminBooking(b, fallbackTitle)]));
  // An id the RPC named but the select didn't return (row deleted between
  // the two calls) is skipped, not an error.
  return order.flatMap((r) => {
    const booking = byId.get(r.id);
    return booking ? [{ ...booking, balanceCents: r.balance_cents }] : [];
  });
}
