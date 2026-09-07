import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import type { PaymentEvent, PaymentsProvider } from "@/lib/payments/provider";
import { sendPaymentReceived } from "./confirm-effects";
import { sendSlotLost } from "./refund";

export type ApplySummary = { processed: number; outcomes: string[] };

const ASYNC_GRACE_MS = 60 * 60_000; // P24 settles or fails within the hour (research §B2)

export async function applyPaymentEvents(
  events: PaymentEvent[],
  deps: { db: SupabaseClient; provider: PaymentsProvider; transport?: EmailTransport },
): Promise<ApplySummary> {
  const outcomes: string[] = [];
  for (const e of events) {
    const { data: ledger } = await deps.db
      .from("booking_payments")
      .select("id, booking_id, org_id, status, amount_cents, stripe_account_id")
      .eq("checkout_session_id", e.sessionId)
      .maybeSingle();
    if (!ledger) {
      outcomes.push("unknown");
      continue;
    }
    const stamp = { updated_at: new Date().toISOString() };
    if ((e.type === "checkout.completed" && e.paid) || e.type === "checkout.async_succeeded") {
      // Known lock-order note (Task 1 review): this RPC locks the ledger row
      // then the booking, while a reschedule locks the booking then re-points
      // the ledger via trigger. Postgres detects the cycle, one side aborts,
      // and Stripe retries the webhook — no fix needed, just don't be
      // surprised by a deadlock_detected in the logs.
      const { data: result, error } = await deps.db.rpc("apply_booking_payment", {
        p_session_id: e.sessionId,
        p_payment_intent_id: e.paymentIntentId ?? "",
        p_amount_cents: e.amountCents ?? ledger.amount_cents,
      });
      if (error) throw error; // 500 → the provider retries
      outcomes.push(result as string);
      if (result === "confirmed") {
        await sendPaymentReceived(ledger.booking_id, { db: deps.db, transport: deps.transport });
      }
      if (result === "slot_lost") {
        await sendSlotLost(ledger.id, { db: deps.db, provider: deps.provider, transport: deps.transport });
      }
    } else if (e.type === "checkout.completed") {
      // Async method in flight: keep the hold alive for the settlement window.
      await deps.db
        .from("booking_payments")
        .update({ status: "processing", payment_intent_id: e.paymentIntentId, ...stamp })
        .eq("id", ledger.id)
        .in("status", ["pending", "processing"]);
      const { data: b } = await deps.db
        .from("bookings")
        .select("hold_expires_at, status")
        .eq("id", ledger.booking_id)
        .single();
      if (b?.status === "pending_payment") {
        const floor = Date.now() + ASYNC_GRACE_MS;
        const current = b.hold_expires_at ? new Date(b.hold_expires_at as string).getTime() : 0;
        if (current < floor) {
          await deps.db
            .from("bookings")
            .update({ hold_expires_at: new Date(floor).toISOString() })
            .eq("id", ledger.booking_id)
            .eq("status", "pending_payment");
        }
      }
      outcomes.push("processing");
    } else if (e.type === "checkout.async_failed") {
      await deps.db
        .from("booking_payments")
        .update({ status: "failed", ...stamp })
        .eq("id", ledger.id)
        .in("status", ["pending", "processing"]);
      outcomes.push("failed");
    } else {
      await deps.db
        .from("booking_payments")
        .update({ status: "expired", ...stamp })
        .eq("id", ledger.id)
        .in("status", ["pending", "processing"]);
      outcomes.push("expired");
    }
  }
  return { processed: events.length, outcomes };
}
