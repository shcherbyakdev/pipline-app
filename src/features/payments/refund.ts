import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport, type EmailTransport } from "@/lib/email/transport";
import { selectPaymentsProvider, type PaymentsProvider } from "@/lib/payments/provider";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { formatMoney } from "@/lib/money";
import { withUnit } from "@/features/rentals/unit-label";
import { bookingLifecycleKey, slotLostEmail, whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

export type Deps = { db?: SupabaseClient; provider?: PaymentsProvider; transport?: EmailTransport };

/** Refund one PAID ledger row in full; records the outcome on the row.
    Returns false when the provider refused (row → refund_failed + error). */
export async function refundLedgerRow(ledgerId: string, reason: string, deps: Deps = {}): Promise<boolean> {
  const db = deps.db ?? createAdminClient();
  const provider = deps.provider ?? selectPaymentsProvider();
  const { data: row, error: readError } = await db
    .from("booking_payments")
    .select("id, booking_id, status, amount_cents, refunded_cents, payment_intent_id, stripe_account_id")
    .eq("id", ledgerId)
    .maybeSingle();
  // The contract is "never throws on a provider refusal", and a database that
  // cannot even read the row is the same answer to every caller: nothing was
  // refunded. Say so loudly in the log, quietly in the return.
  if (readError) {
    console.error("[payments] refund: ledger row read failed:", readError);
    return false;
  }
  if (!row || row.status !== "paid" || !row.payment_intent_id || !row.stripe_account_id) return false;
  const amount = row.amount_cents - row.refunded_cents;
  if (amount <= 0) return true;
  try {
    const { refundId } = await provider.refund(
      row.stripe_account_id,
      row.payment_intent_id,
      amount,
      `${row.id}:${reason}`,
    );
    const { error: markError } = await db
      .from("booking_payments")
      .update({
        status: "refunded",
        refund_id: refundId,
        refunded_cents: row.refunded_cents + amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    // Same story as the bump below: the money already left the connected
    // account, so the row must say exactly that and the caller must hear
    // "needs a human" rather than "refunded".
    if (markError) {
      console.error("[payments] refunded at provider; ledger row update failed:", markError);
      await db
        .from("booking_payments")
        .update({
          status: "refund_failed",
          error: `refunded at provider (${refundId}); row update failed: ${markError.message}`.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return false;
    }
    // bump_booking_refunded clamps at the booking's paid_cents, so a
    // slot_lost refund (which the booking never counted as paid) is a no-op
    // rather than an error. Anything that DOES come back is a real write
    // failure: the money already left the connected account, so say exactly
    // that on the row and report the row as needing a human.
    const { error: bumpError } = await db.rpc("bump_booking_refunded", {
      p_booking_id: row.booking_id,
      p_cents: amount,
    });
    if (bumpError) {
      console.error("[payments] refunded at provider; booking bump failed:", bumpError);
      await db
        .from("booking_payments")
        .update({
          status: "refund_failed",
          error: `refunded at provider (${refundId}); booking bump failed: ${bumpError.message}`.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[payments] refund failed:", e);
    await db
      .from("booking_payments")
      .update({
        status: "refund_failed",
        error: e instanceof Error ? e.message.slice(0, 500) : "refund failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return false;
  }
}

/** A payment landed on a booking whose slot is gone: refund + tell the client. */
export async function sendSlotLost(ledgerId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? createAdminClient();
  await refundLedgerRow(ledgerId, "slot-lost", deps);
  const { data } = await db
    .from("booking_payments")
    .select(
      "amount_cents, currency, bookings(id, client_email, locale, starts_at, ends_at, rental_unit_id, org_id, rental_offerings(name, range_mode), rental_units(name), orgs(name, timezone, locale))",
    )
    .eq("id", ledgerId)
    .maybeSingle();
  const b = (
    data as unknown as {
      amount_cents: number;
      currency: string;
      bookings: {
        id: string;
        client_email: string | null;
        locale: string | null;
        starts_at: string;
        ends_at: string;
        rental_unit_id: string | null;
        org_id: string;
        rental_offerings: { name: string; range_mode: RangeMode } | null;
        rental_units: { name: string } | null;
        orgs: { name: string; timezone: string; locale: string };
      };
    } | null
  )?.bookings;
  if (!b?.client_email || !data) return;
  try {
    const client = await emailTranslators(b.locale ?? b.orgs.locale);
    const msg = slotLostEmail(client.t, {
      orgName: b.orgs.name,
      serviceName: withUnit(b.rental_offerings?.name ?? "", b.rental_units?.name ?? null),
      whenLine: whenLineFor(
        {
          startsAt: new Date(b.starts_at),
          endsAt: new Date(b.ends_at),
          isRental: true,
          rangeMode: b.rental_offerings?.range_mode ?? null,
        },
        b.orgs.timezone,
        client.intlLocale,
      ),
      amount: formatMoney(data.amount_cents, data.currency),
      badgeUrl: await emailBadgeUrl(b.org_id),
    });
    await (deps.transport ?? selectTransport()).send({
      to: b.client_email,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      idempotencyKey: bookingLifecycleKey(b.id, "slot-lost"),
    });
  } catch (e) {
    console.error("[payments] slot-lost mail failed:", e);
  }
}

/** Refund everything paid on a booking (spec ruling 3: full refunds in S2).
    Never throws: each row's outcome is recorded on the row itself, and
    `failed` says "at least one needs a human in Stripe". */
export async function refundBooking(
  bookingId: string,
  reason: string,
  deps: Deps = {},
): Promise<{ refundedCents: number; failed: boolean }> {
  const db = deps.db ?? createAdminClient();
  const { data: rows, error } = await db
    .from("booking_payments")
    .select("id, amount_cents, refunded_cents")
    .eq("booking_id", bookingId)
    .eq("status", "paid");
  if (error) {
    console.error("[payments] refundBooking: ledger read failed:", error);
    return { refundedCents: 0, failed: true };
  }
  let refundedCents = 0;
  let failed = false;
  for (const row of rows ?? []) {
    if (await refundLedgerRow(row.id, reason, deps)) refundedCents += row.amount_cents - row.refunded_cents;
    else failed = true;
  }
  return { refundedCents, failed };
}
