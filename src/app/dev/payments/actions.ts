"use server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectPaymentsProvider } from "@/lib/payments/provider";
import { applyPaymentEvents } from "@/features/payments/apply";

const input = z.object({
  session: z.string().min(1),
  outcome: z.enum(["pay", "async", "fail"]),
  back: z.string().min(1),
});

/** The fake Checkout's buttons: the same events a Stripe webhook would carry,
    straight into applyPaymentEvents. Dev-only. */
export async function fakeCheckoutOutcome(formData: FormData): Promise<never> {
  if (env.APP_ENV === "production" || env.PAYMENTS_PROVIDER !== "fake") notFound();
  await requireOrg();
  const { session, outcome, back } = input.parse(Object.fromEntries(formData));
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("booking_payments")
    .select("amount_cents, stripe_account_id")
    .eq("checkout_session_id", session)
    .single();
  if (!row) notFound();
  const base = {
    sessionId: session,
    paymentIntentId: `pi_fake_${session.slice(-8)}`,
    amountCents: row.amount_cents as number,
    accountId: row.stripe_account_id as string | null,
    eventId: `evt_${Date.now()}`,
  };
  const events =
    outcome === "pay"
      ? [{ ...base, type: "checkout.completed" as const, paid: true }]
      : outcome === "async"
        ? [
            { ...base, type: "checkout.completed" as const, paid: false },
            { ...base, type: "checkout.async_succeeded" as const, paid: true },
          ]
        : [{ ...base, type: "checkout.async_failed" as const, paid: false }];
  await applyPaymentEvents(events, { db: admin, provider: selectPaymentsProvider() });
  const target = new URL(back, env.NEXT_PUBLIC_APP_URL);
  redirect(target.origin === new URL(env.NEXT_PUBLIC_APP_URL).origin ? target.toString() : "/");
}
