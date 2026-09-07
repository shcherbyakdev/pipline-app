import { notFound } from "next/navigation";
import { env } from "@/env";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { fakeCheckoutOutcome } from "../actions";

/* The fake payments provider's hosted checkout (spec §Provider seam).
   `fake.ts` sends people here with the session, the ledger row and the two
   return URLs in the query string, exactly as a Stripe Checkout Session URL
   carries a session id — so the page trusts nothing but the guard and reads
   the amount off the ledger row rather than off the URL.

   The three buttons are the three outcomes a real Connect webhook delivers:
   card (paid at once), P24/BLIK (completed unpaid, then async_succeeded) and
   a failed async settlement.

   `.light` (globals.css) opts the subtree out of the `dark:` variants, and
   there is no app chrome: a hosted checkout looks like the payment
   processor, not like the app you left (the /dev/billing layout's rule,
   inline here — one page does not need a layout of its own). */

/** First value of a search param, or null — entries may be arrays. */
function one(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** A return URL is client input: it only becomes a link (or a form field the
    action redirects to) when it points back at this app. */
function sameOrigin(candidate: string | null, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
    const target = new URL(candidate, appUrl);
    return target.origin === appUrl.origin ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}

export default async function DevPaymentsCheckoutPage({ searchParams }: PageProps<"/dev/payments/checkout">) {
  if (env.APP_ENV === "production" || env.PAYMENTS_PROVIDER !== "fake") notFound();
  const sp = await searchParams;
  const paymentId = one(sp.payment);
  if (!paymentId) notFound();

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("booking_payments")
    .select("amount_cents, currency, checkout_session_id")
    .eq("id", paymentId)
    .maybeSingle();
  const session = row?.checkout_session_id ?? one(sp.session);
  if (!row || !session) notFound();

  const returnTo = sameOrigin(one(sp.return), "/");
  const cancelTo = sameOrigin(one(sp.cancel), returnTo);
  const amount = formatMoney(row.amount_cents as number, row.currency as string);

  const buttons: Array<{ outcome: string; label: string; back: string; hint: string }> = [
    { outcome: "pay", label: `Pay ${amount}`, back: returnTo, hint: "Card — paid the moment the session completes." },
    { outcome: "async", label: "Pay by P24 (settles)", back: returnTo, hint: "Completed unpaid, then async_succeeded an instant later." },
    { outcome: "fail", label: "Payment fails", back: cancelTo, hint: "The async method never settles; the hold runs out." },
  ];

  return (
    <div className="light bg-background text-foreground flex min-h-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-semibold">Booklo dev payments — emulator, no real charges.</p>
          <p className="text-muted-foreground text-xs">
            Each button posts the events a Stripe Connect webhook would carry for that outcome.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Deposit</h1>
          <p className="text-muted-foreground text-sm">
            {amount} · <span className="font-mono text-xs">{session}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {buttons.map((b) => (
            <form key={b.outcome} action={fakeCheckoutOutcome} className="flex flex-col gap-1">
              <input type="hidden" name="session" value={session} />
              <input type="hidden" name="outcome" value={b.outcome} />
              <input type="hidden" name="back" value={b.back} />
              <Button type="submit" variant={b.outcome === "pay" ? "default" : "outline"}>
                {b.label}
              </Button>
              <span className="text-muted-foreground text-xs">{b.hint}</span>
            </form>
          ))}
        </div>

        {/* Plain anchor: leaving the emulator is a full navigation. */}
        <a href={cancelTo} className="text-muted-foreground text-sm underline underline-offset-4">
          Back
        </a>
      </div>
    </div>
  );
}
