import { formatUsd, PLANS, pricePerMonth } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { openPortal } from "../actions";
import type { BillingOverview } from "../queries";

// Deterministic across server/client: fixed locale + UTC (portal-links-panel
// precedent — toLocaleDateString varies by runtime and breaks hydration).
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(iso));

/** Past tense once the period is behind us; "Ends" while a cancellation is
    still running out; "Renews" otherwise. */
function periodLabel(sub: NonNullable<BillingOverview["subscription"]>): string {
  if (sub.status === "expired") return "Ended on";
  return sub.cancelAtPeriodEnd || sub.status === "cancelled" ? "Ends on" : "Renews on";
}

/* What you are on today, and the one door out: the provider's portal, where
   cards, invoices, interval switches and cancellations live (spec §7.6).
   The plan shown is the EFFECTIVE one — a cancelled subscription keeps its
   plan until the period ends, an expired one already reads Free. */
export function CurrentPlan({ overview }: { overview: BillingOverview }) {
  const { entitlements: ent, subscription: sub } = overview;
  const plan = PLANS[ent.plan];
  const price =
    sub && ent.plan !== "free"
      ? `${formatUsd(pricePerMonth(sub.plan, sub.interval))} / month${sub.interval === "year" ? " · billed yearly" : ""}`
      : "No card needed";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{plan.name}</span>
        <span className="text-muted-foreground text-sm">{price}</span>
      </div>
      <p className="text-muted-foreground text-sm">{plan.blurb}</p>

      {/* Both lines when both apply: the warning says what to do, the date
          says by when. */}
      {sub?.status === "past_due" ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          We couldn&rsquo;t charge your card — update it in the billing portal to keep your plan.
        </p>
      ) : null}
      {sub?.currentPeriodEnd ? (
        <p className="text-muted-foreground text-sm">
          {periodLabel(sub)} {formatDate(sub.currentPeriodEnd)}
        </p>
      ) : null}

      {sub ? (
        <form action={openPortal}>
          <Button type="submit" variant="secondary">
            Manage subscription
          </Button>
        </form>
      ) : null}
    </div>
  );
}
