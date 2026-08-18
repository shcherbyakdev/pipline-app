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
  // Running out, but not out yet: the date above says when, this says what
  // happens then and that it is reversible. Needs the date to have rendered
  // — "until then" with no "then" above it says nothing.
  const cancelling = sub?.currentPeriodEnd && (sub.cancelAtPeriodEnd || sub.status === "cancelled") ? sub : null;
  // Already out. `ent.plan === "free"` and not just the status: a cancelled
  // subscription whose period is still running also reads "expired-ish" in
  // places, and this line must only appear once the plan really is gone.
  // `sub.plan` (what ENDED), not `ent.plan` (which is Free by now).
  const ended = sub && sub.status === "expired" && ent.plan === "free" ? sub : null;

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
          We couldn&rsquo;t charge your card. Retry the charge or update your card in the billing
          portal — after the retries run out the plan ends.
        </p>
      ) : null}
      {sub?.currentPeriodEnd ? (
        <p className="text-muted-foreground text-sm">
          {periodLabel(sub)} {formatDate(sub.currentPeriodEnd)}
        </p>
      ) : null}
      {cancelling ? (
        <p className="text-muted-foreground text-sm">
          You keep {plan.name} until then. Changed your mind? Resume in the billing portal.
        </p>
      ) : null}
      {ended ? (
        <p className="text-muted-foreground text-sm">
          Your {PLANS[ended.plan].name} plan ended — pick a plan below to resubscribe.
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
