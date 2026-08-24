import { notFound } from "next/navigation";
import { env } from "@/env";
import { formatUsd, isPaidPlan, PLANS, pricePerMonth, FOUNDER_PRICE_FACTOR } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { isFounderEligible } from "@/features/billing/founder";
import { CheckoutForm } from "@/features/billing/dev/components/checkout-form";
import { requireDevBilling } from "@/features/billing/dev/guard";

/* The fake provider's hosted checkout (plan §7.6). `fake.ts` sends people
   here with the offer in the query string, exactly as a Stripe Checkout
   Session URL carries a session id — so the page trusts nothing but the
   guard: `org` must be the caller's own, `plan`/`interval` must be ones we
   sell, and the price is looked up from PLANS rather than read off the URL. */

/** First value of a search param, or null — searchParams entries may be
    arrays when a key repeats. */
function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Where "Cancel" goes. `fake.ts` carries startCheckout's `cancelUrl` as
    `cancel` (the way a Stripe session carries cancel_url) — that is the
    /billing?checkout=cancelled line. It rides in the query string of a page
    anyone signed in can open, so it is origin-checked before it becomes a
    link (dev/actions.ts#returnUrlWith idiom): a foreign host falls back.

    Without `cancel` (an older link), the fallback is the return URL with the
    post-purchase markers taken off: `startCheckout` bakes
    `checkout=success&plan=…` into `return` so the ACTION can land on it, but
    abandoning checkout must not — /billing would read those and sit on
    "Activating your plan…" for a purchase that never happened. Anything
    unparseable falls back to /billing. */
function cancelUrl(cancelTo: string | null, returnTo: string): string {
  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  if (cancelTo) {
    try {
      const target = new URL(cancelTo, appUrl);
      if (target.origin === appUrl.origin) return target.toString();
    } catch {
      /* fall through to the derived fallback */
    }
  }
  try {
    const target = new URL(returnTo, appUrl);
    if (target.origin !== appUrl.origin) return "/billing";
    target.searchParams.delete("checkout");
    target.searchParams.delete("plan");
    return target.toString();
  } catch {
    return "/billing";
  }
}

export default async function DevCheckoutPage({ searchParams }: PageProps<"/dev/billing/checkout">) {
  const sp = await searchParams;
  const { org } = await requireDevBilling(one(sp.org));

  const plan = one(sp.plan);
  const interval = one(sp.interval);
  // A checkout without a valid offer is not a checkout — and these come from
  // our own adapter, so anything else is hand-crafted.
  if (!plan || !isPaidPlan(plan) || (interval !== "month" && interval !== "year")) notFound();
  const returnTo = one(sp.return) || "/billing";
  const customer = one(sp.customer) ?? undefined;

  // The Founder coupon is 33.3 % off Pro MONTHLY, forever (spec §3) — same
  // rule as startCheckout's, restated here because the emulator has no Stripe
  // to apply a promotion code for it. Both env vars unset (every environment
  // until the promo is configured) → never eligible, so this stays quiet.
  const supabase = await createClient();
  const { data: orgRow } = await supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle();
  const founder = plan === "pro" && interval === "month" && isFounderEligible(orgRow?.created_at);

  const monthly = pricePerMonth(plan, interval) * (founder ? FOUNDER_PRICE_FACTOR : 1);
  // What the card is charged TODAY: a year's plan bills the year up front.
  const chargedNow = interval === "year" ? PLANS[plan].yearly : monthly;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Subscribe to {PLANS[plan].name}</h1>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-muted-foreground text-sm">{org.name}</span>
          <span className="text-sm">
            {formatUsd(monthly)} / month
            {interval === "year" ? ` · billed yearly ${formatUsd(PLANS[plan].yearly)}` : ""}
          </span>
        </div>
        {founder ? (
          <p className="text-sm text-emerald-600">
            Founder price applied — {formatUsd(monthly)}/mo for life.
          </p>
        ) : null}
      </div>

      <CheckoutForm
        org={org.id}
        plan={plan}
        interval={interval}
        returnTo={returnTo}
        cancelTo={cancelUrl(one(sp.cancel), returnTo)}
        customer={customer}
        payLabel={formatUsd(chargedNow)}
        error={one(sp.error) ?? undefined}
      />
    </div>
  );
}
