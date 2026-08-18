import { notFound } from "next/navigation";
import { env } from "@/env";
import { formatUsd, isPaidPlan, PLANS, pricePerMonth, FOUNDER_PRICE_FACTOR } from "@/lib/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { isFounderEligible } from "@/features/billing/founder";
import { CheckoutForm } from "@/features/billing/dev/components/checkout-form";
import { requireDevBilling } from "@/features/billing/dev/guard";
import { safeReturnUrl } from "@/features/billing/dev/return-url";

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

/** Where "Cancel" goes: the vetted return URL with the post-purchase markers
    taken off. `startCheckout` bakes `checkout=success&plan=…` into `return`
    so the ACTION can land on it, but abandoning checkout must not — /billing
    would read those and sit on "Activating your plan…" for a purchase that
    never happened. */
function cancelUrl(returnTo: string): string {
  const target = new URL(returnTo);
  target.searchParams.delete("checkout");
  target.searchParams.delete("plan");
  return target.toString();
}

export default async function DevCheckoutPage({ searchParams }: PageProps<"/dev/billing/checkout">) {
  const sp = await searchParams;
  const { org } = await requireDevBilling(one(sp.org));

  const plan = one(sp.plan);
  const interval = one(sp.interval);
  // A checkout without a valid offer is not a checkout — and these come from
  // our own adapter, so anything else is hand-crafted.
  if (!plan || !isPaidPlan(plan) || (interval !== "month" && interval !== "year")) notFound();
  // Vetted here, once: the value goes into the form's hidden `return` field
  // AND into the Cancel anchor, and neither should be handed the raw param.
  const returnTo = safeReturnUrl(one(sp.return));
  const customer = one(sp.customer) ?? undefined;

  // The Founder coupon is 33.3 % off Pro MONTHLY, forever (spec §3) — same
  // rule as startCheckout's, restated here because the emulator has no Stripe
  // to apply a promotion code for it. The promo-code check comes FIRST so an
  // environment without the promo configured (every one, so far) skips the
  // org read entirely — `founderCodeFor` (features/billing/actions.ts) orders
  // it the same way and for the same reason.
  let founder = false;
  if (env.BILLING_FOUNDER_PROMO_CODE && plan === "pro" && interval === "month") {
    const supabase = await createClient();
    const { data: orgRow } = await supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle();
    founder = isFounderEligible(orgRow?.created_at);
  }

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
        cancelTo={cancelUrl(returnTo)}
        customer={customer}
        payLabel={formatUsd(chargedNow)}
        error={one(sp.error) ?? undefined}
      />
    </div>
  );
}
