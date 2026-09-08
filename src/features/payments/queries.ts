import "server-only";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsConfigured, selectPaymentsProvider, type AccountStatus } from "@/lib/payments/provider";
import { parseLegal, type Legal } from "./legal";
import type { Charge, ChargeKind } from "./settlement";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentsPageData = {
  orgId: string; orgName: string; email: string; configured: boolean;
  account: { status: AccountStatus; capabilities: Record<string, string> } | null;
  holdMin: number; legal: Legal;
};

/** The page's one read. Refreshes the cached account status from the
    provider on every load (spec ruling 6: pull, not push); a provider
    failure keeps the cached row. */
export async function getPaymentsPage(): Promise<PaymentsPageData> {
  const { user, org } = await requireOrg();
  const admin = createAdminClient();
  const [{ data: row }, { data: o }] = await Promise.all([
    admin.from("payment_accounts").select("stripe_account_id, status, capabilities").eq("org_id", org.id).maybeSingle(),
    admin.from("orgs").select("payment_hold_min, legal").eq("id", org.id).single(),
  ]);
  let account: PaymentsPageData["account"] = row ? { status: row.status as AccountStatus, capabilities: (row.capabilities ?? {}) as Record<string, string> } : null;
  if (row && paymentsConfigured()) {
    try {
      const fresh = await selectPaymentsProvider().getAccountStatus(row.stripe_account_id);
      await admin.from("payment_accounts").update({ status: fresh.status, capabilities: fresh.capabilities, checked_at: new Date().toISOString() }).eq("org_id", org.id);
      account = fresh;
    } catch (e) { console.error("[payments] account refresh:", e); }
  }
  return { orgId: org.id, orgName: org.name, email: user.email ?? "", configured: paymentsConfigured(), account, holdMin: o?.payment_hold_min ?? 60, legal: parseLegal(o?.legal) };
}

/** S7: what a booking owes on top of its price — the after-session charges
    and the write-off. Read with the admin client (the charges are staff data
    the mail path reaches with no session); `db` lets a webhook hand in the
    client it is already using. */
export async function getBookingSettlement(
  bookingId: string,
  db?: SupabaseClient,
): Promise<{ charges: Charge[]; writtenOffCents: number; writtenOffNote: string | null }> {
  const admin = db ?? createAdminClient();
  const [{ data: rows, error: chargesError }, { data: b, error: bookingError }] = await Promise.all([
    admin
      .from("booking_charges")
      .select("id, kind, label, qty, unit_cents, cents, note")
      .eq("booking_id", bookingId)
      .order("created_at"),
    admin.from("bookings").select("written_off_cents, written_off_note").eq("id", bookingId).maybeSingle(),
  ]);
  // A failed read is not "no charges": the fallbacks keep the page up, but
  // the failure must not be silent.
  if (chargesError) console.error("[payments] settlement charges read:", chargesError);
  if (bookingError) console.error("[payments] settlement write-off read:", bookingError);
  return {
    charges: (rows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind as ChargeKind,
      label: r.label,
      qty: r.qty,
      unitCents: r.unit_cents,
      cents: r.cents,
      note: r.note,
    })),
    writtenOffCents: b?.written_off_cents ?? 0,
    writtenOffNote: b?.written_off_note ?? null,
  };
}

/** Can this org take money online right now? (S7: whether a balance is
    "pay online" or "settle at the venue".) */
export async function hasActivePaymentAccount(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_accounts")
    .select("org_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (error) console.error("[payments] account lookup:", error);
  return Boolean(data);
}
