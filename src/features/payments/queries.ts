import "server-only";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentsConfigured, selectPaymentsProvider, type AccountStatus } from "@/lib/payments/provider";
import { parseLegal, type Legal } from "./legal";

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
