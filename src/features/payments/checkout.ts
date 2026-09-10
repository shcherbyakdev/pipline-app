import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkoutExpiresAt,
  paymentsConfigured,
  selectPaymentsProvider,
  type PaymentsProvider,
} from "@/lib/payments/provider";
import { withUnit } from "@/features/rentals/unit-label";
import { whenLineFor } from "@/features/scheduling/templates";
import { INTL_LOCALES, isLocale, DEFAULT_LOCALE } from "@/i18n/config";
import type { RangeMode } from "@/features/rentals/range";

export type StartCheckoutResult = { url: string } | { error: "nothing_due" | "expired" | "no_account" | "provider" };

type BookingRow = {
  id: string;
  org_id: string;
  status: string;
  hold_expires_at: string | null;
  deposit_cents: number | null;
  currency: string | null;
  client_email: string | null;
  starts_at: string;
  ends_at: string;
  rental_unit_id: string | null;
  rental_offerings: { name: string; range_mode: RangeMode } | null;
  rental_units: { name: string } | null;
  orgs: { timezone: string } | null;
};

/** Create-or-reuse the Checkout session a booking owes right now (S2 ruling 8,
    widened by S7): a live hold pays its deposit, a confirmed booking pays the
    balance the SQL helper reports. Reuses the newest open ledger row OF THAT
    KIND; otherwise inserts one (its id is the provider idempotency key), asks
    the provider, and stores the session. */
export async function startCheckout(
  bookingId: string,
  opts: { successUrl: string; cancelUrl: string; locale: string | null },
  deps: { db?: SupabaseClient; provider?: PaymentsProvider; now?: Date } = {},
): Promise<StartCheckoutResult> {
  const db = deps.db ?? createAdminClient();
  const now = deps.now ?? new Date();
  const { data: b, error } = await db
    .from("bookings")
    .select(
      "id, org_id, status, hold_expires_at, deposit_cents, currency, client_email, starts_at, ends_at, rental_unit_id, rental_offerings(name, range_mode), rental_units(name), orgs(timezone)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !b) return { error: "nothing_due" };
  const row = b as unknown as BookingRow;
  let kind: "deposit" | "balance";
  let amount: number;
  let expiresAt: number;
  if (row.status === "pending_payment") {
    if (!row.hold_expires_at || !row.deposit_cents || !row.currency) return { error: "nothing_due" };
    const hold = new Date(row.hold_expires_at);
    if (hold.getTime() <= now.getTime()) return { error: "expired" };
    kind = "deposit";
    amount = row.deposit_cents;
    expiresAt = checkoutExpiresAt(hold, now);
  } else if (row.status === "confirmed" && row.currency) {
    // S7: a confirmed booking pays its balance — the SQL helper is the
    // amount's only source (spec ruling 5). The link lives a day.
    const { data: due, error: dueErr } = await db.rpc("booking_balance_cents", { p_booking_id: row.id });
    if (dueErr || typeof due !== "number" || due <= 0) return { error: "nothing_due" };
    kind = "balance";
    amount = due;
    expiresAt = Math.floor(now.getTime() / 1000) + 24 * 3600;
  } else {
    return { error: "nothing_due" };
  }
  const { data: acct } = await db
    .from("payment_accounts")
    .select("stripe_account_id")
    .eq("org_id", row.org_id)
    .eq("status", "active")
    .maybeSingle();
  if (!acct) return { error: "no_account" };

  // A session already open (and not about to lapse) is the one to hand back —
  // a refresh must never mint a second one. Keyed by kind AND amount (S7): a
  // deposit request must never be handed the balance session's URL, and a
  // re-ask after a new charge must mint a session for the NEW balance rather
  // than reuse one that would take too little.
  const { data: open } = await db
    .from("booking_payments")
    .select("checkout_url")
    .eq("booking_id", row.id)
    .eq("kind", kind)
    .eq("amount_cents", amount)
    .eq("status", "pending")
    .not("checkout_url", "is", null)
    .gt("checkout_expires_at", new Date(now.getTime() + 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open?.checkout_url) return { url: open.checkout_url };

  const provider = deps.provider ?? selectPaymentsProvider();
  const { data: inserted, error: insErr } = await db
    .from("booking_payments")
    .insert({
      org_id: row.org_id,
      booking_id: row.id,
      kind,
      provider: provider.name,
      amount_cents: amount,
      currency: row.currency,
      status: "pending",
      stripe_account_id: acct.stripe_account_id,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error("[payments] ledger insert:", insErr);
    return { error: "provider" };
  }
  const paymentId = inserted.id as string;
  const locale = opts.locale && isLocale(opts.locale) ? opts.locale : DEFAULT_LOCALE;
  const when = whenLineFor(
    {
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      isRental: true,
      rangeMode: row.rental_offerings?.range_mode ?? null,
    },
    row.orgs?.timezone ?? "UTC",
    INTL_LOCALES[locale],
  );
  try {
    const { sessionId, url } = await provider.createCheckout({
      accountId: acct.stripe_account_id,
      amountCents: amount,
      currency: row.currency,
      // Product names are not translated today — the balance suffix stays English.
      productName: `${withUnit(row.rental_offerings?.name ?? "", row.rental_units?.name ?? null)} — ${when}${kind === "balance" ? " · balance" : ""}`,
      customerEmail: row.client_email,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
      expiresAt,
      locale,
      bookingId: row.id,
      paymentId,
    });
    await db
      .from("booking_payments")
      .update({
        checkout_session_id: sessionId,
        checkout_url: url,
        checkout_expires_at: new Date(expiresAt * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    return { url };
  } catch (e) {
    console.error("[payments] createCheckout:", e);
    await db
      .from("booking_payments")
      .update({
        status: "failed",
        error: e instanceof Error ? e.message.slice(0, 500) : "checkout failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    return { error: "provider" };
  }
}

/** Close every Checkout session still open on a booking and mark its ledger
    row `expired`. Called wherever a hold stops being payable — the drain's
    expiry phase, an admin or client cancel, "Mark as paid" — so a tab left
    open on the old session cannot take money for a slot that is gone.
    Best effort by contract: every caller runs it AFTER its own row is
    committed, so this never throws — it logs and moves on. A COMPLETED
    session is deliberately untouched: that one is the webhook's business
    (it revives the hold or refunds it). */
export async function expireOpenCheckouts(
  bookingId: string,
  deps: { db?: SupabaseClient; provider?: PaymentsProvider } = {},
): Promise<void> {
  const db = deps.db ?? createAdminClient();
  const provider = deps.provider ?? (paymentsConfigured() ? selectPaymentsProvider() : undefined);
  const { data: open, error } = await db
    .from("booking_payments")
    .select("id, checkout_session_id, stripe_account_id")
    .eq("booking_id", bookingId)
    .in("status", ["pending", "processing"]);
  if (error) {
    console.error("[payments] expireOpenCheckouts: ledger read failed:", error);
    return;
  }
  for (const p of open ?? []) {
    try {
      if (provider && p.checkout_session_id && p.stripe_account_id) {
        await provider.expireCheckout(p.stripe_account_id, p.checkout_session_id);
      }
    } catch (e) {
      console.error("[payments] expiring checkout session failed:", e);
    }
    const { error: markError } = await db
      .from("booking_payments")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (markError) console.error("[payments] expireOpenCheckouts: row update failed:", markError);
  }
}
