import { FAKE_ACTIONS, type FakeRow } from "@/lib/billing/fake-emulator";
import { PLANS } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fakePortalAction, fakeReset, fakeUpdateCard } from "../actions";

/* The fake provider's customer portal: one button per subscription lifecycle
   event Stripe can produce, so every branch of the projection can be walked
   without a Stripe account. Each button posts the matching `FAKE_ACTIONS`
   entry; the action turns it into the `BillingEvent[]` the webhook would have
   delivered. Nothing here writes the row directly. */

const DONE_MESSAGES: Record<string, string> = {
  cancel_at_period_end: "Cancellation scheduled — the plan runs to the end of the current period.",
  resume: "Cancellation cleared — the subscription keeps renewing.",
  cancel_now: "Subscription ended immediately.",
  switch_pro: "Switched to Pro.",
  switch_team: "Switched to Team.",
  switch_month: "Switched to monthly billing.",
  switch_year: "Switched to yearly billing.",
  fail_renewal: "Renewal charge failed — the subscription is past_due.",
  recover: "Retry succeeded — the subscription is active again.",
  advance_period: "Jumped to the end of the period.",
  card_updated: "Card updated.",
  reset: "Subscription cleared — this org is back on Free.",
};

const ERROR_MESSAGES: Record<string, string> = {
  card_declined: "That card was rejected — nothing changed.",
  invalid: "Those card details don't look right.",
  no_subscription: "There is no subscription to change any more.",
  // Both the unknown-action and the not-allowed-right-now cases: from the
  // portal's side they are the same answer — the action did not run and the
  // subscription is untouched.
  bad_action: "That action isn't available for the current subscription state.",
};

/** The confirmation line for `?done=`; null for a missing or unknown code.
    Exported because the page renders it above the panel AND on the no-row
    branch — "Reset to Free" lands there, and losing the confirmation is
    exactly the moment you want it. */
export function portalDoneMessage(code: string | null | undefined): string | null {
  return code && code in DONE_MESSAGES ? DONE_MESSAGES[code] : null;
}

/* Fixed locale + UTC, the current-plan.tsx idiom: toLocaleString varies by
   runtime and would mismatch between server render and hydration. The time
   is shown, not just the date — "advance period" moves it, and seeing it move
   is the point. */
const formatInstant = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(iso))} UTC`;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export function PortalPanel({
  row, returnTo, done, error,
}: {
  row: FakeRow;
  returnTo: string;
  done?: string;
  error?: string;
}) {
  // An expired subscription is over: Stripe's portal offers nothing but a new
  // purchase, and the emulator must not let a dead row be switched or renewed
  // back to life (several `enabledWhen` predicates only guard the plan or the
  // interval, not the status). Reset stays — it is the way back to a clean
  // slate — and buying again happens on /billing, not here.
  const ended = row.status === "expired";
  const doneMessage = portalDoneMessage(done);
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Subscription</h1>
        <p className="text-muted-foreground text-sm">
          Every button below emits the provider event Booklo&rsquo;s webhook would have received.
        </p>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}
      {doneMessage ? (
        <p role="status" className="text-sm text-emerald-600">
          {doneMessage}
        </p>
      ) : null}

      <dl className="flex flex-col gap-1.5 rounded-lg border p-4">
        <Row label="Plan" value={PLANS[row.plan].name} />
        <Row label="Interval" value={row.interval} />
        <Row label="Status" value={row.status} />
        <Row label="Cancels at period end" value={row.cancelAtPeriodEnd ? "yes" : "no"} />
        <Row label="Seats" value={String(row.seats)} />
        <Row label="Period end" value={row.currentPeriodEnd ? formatInstant(row.currentPeriodEnd) : "—"} />
        <Row label="Customer" value={row.providerCustomerId} />
        <Row label="Subscription" value={row.providerSubscriptionId} />
      </dl>

      {ended ? (
        <p className="text-muted-foreground text-sm">
          This subscription has ended — buy a plan again from Billing, or reset this org to Free below.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Lifecycle events</h2>
        {FAKE_ACTIONS.map((entry) => (
          <form key={entry.id} action={fakePortalAction} className="flex flex-col gap-1">
            <input type="hidden" name="action" value={entry.id} />
            <input type="hidden" name="return" value={returnTo} />
            <Button type="submit" variant="outline" disabled={ended || !entry.enabledWhen(row)}>
              {entry.label}
            </Button>
            <p className="text-muted-foreground text-xs">{entry.hint}</p>
          </form>
        ))}
      </div>

      <form action={fakeUpdateCard} className="flex flex-col gap-3 rounded-lg border p-4">
        <input type="hidden" name="return" value={returnTo} />
        <h2 className="text-sm font-semibold">Update card</h2>
        <p className="text-muted-foreground text-xs">
          Attaches a new card. Emits nothing — attaching a card is not a subscription change; only the
          decline cards are rejected.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="portal-number">Card number</Label>
          <Input
            id="portal-number" name="number" inputMode="numeric" autoComplete="off"
            placeholder="4242 4242 4242 4242" required disabled={ended}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="portal-exp">Expiry</Label>
            <Input id="portal-exp" name="exp" autoComplete="off" placeholder="MM/YY" defaultValue="12/34" required disabled={ended} />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="portal-cvc">CVC</Label>
            <Input id="portal-cvc" name="cvc" inputMode="numeric" autoComplete="off" placeholder="123" defaultValue="123" required disabled={ended} />
          </div>
        </div>
        <Button type="submit" variant="secondary" disabled={ended}>
          Update card
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <form action={fakeReset} className="flex flex-col gap-1">
          <input type="hidden" name="return" value={returnTo} />
          <Button type="submit" variant="destructive">
            Reset to Free
          </Button>
          <p className="text-muted-foreground text-xs">
            Drops this org&rsquo;s cached subscription. The event log is kept.
          </p>
        </form>
        {/* Plain anchor: `returnTo` may be an absolute URL back into the app,
            and leaving the emulator should be a full navigation. */}
        <a href={returnTo} className="text-muted-foreground text-sm underline underline-offset-4">
          Back to Booklo
        </a>
      </div>
    </div>
  );
}
