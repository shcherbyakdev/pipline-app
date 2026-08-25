"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatUsd,
  FOUNDER_PRICE_FACTOR,
  isPaidPlan,
  PAID_PLANS,
  PLANS,
  pricePerMonth,
  yearlySaving,
  type Interval,
  type PaidPlanId,
  type PlanDef,
  type PlanId,
} from "@/lib/billing/plans";
import { openPortal, startCheckout } from "../actions";

/* The ladder, rendered from PLANS — the only place prices and limits live
   (spec §7.3). The rows below read the same limits, so a number changed in
   plans.ts changes this table too. Two rows are prose because they aren't
   limits: the team layer (shipped in #39) and the brand basics every plan
   gets. Nothing here names an unshipped feature. */
const PLAN_ROWS: { label: string; value: (plan: PlanDef) => string }[] = [
  { label: "Bookable team members", value: (p) => String(p.limits.bookableResources) },
  {
    label: "Services on your booking page",
    value: (p) => (p.limits.publicServices === null ? "Unlimited" : String(p.limits.publicServices)),
  },
  {
    label: "Reminder emails",
    value: (p) =>
      p.limits.reminderBookingsPerMonth === null
        ? "Every booking"
        : `First ${p.limits.reminderBookingsPerMonth} bookings a month`,
  },
  { label: "Your logo, colours, welcome text", value: () => "Included" },
  { label: "Remove “Powered by Booklo”", value: (p) => (p.limits.hideBadge ? "Included" : "—") },
  {
    label: "Team layer: per-person links, “Anyone available”, colours",
    value: (p) => (p.id === "team" ? "Included" : "—"),
  },
];

const COLUMNS: PlanId[] = ["free", ...PAID_PLANS];

/** What the Founder coupon makes Pro cost, derived from the same factor the
    coupon uses (spec §3/§7.12) — monthly only, which is why the ribbon below
    only appears on the monthly tab. */
const FOUNDER_MONTHLY = formatUsd(PLANS.pro.monthly * FOUNDER_PRICE_FACTOR);

const savingPercent = (plan: PaidPlanId) => Math.round(yearlySaving(plan) * 100);

export function PlanPicker({
  currentPlan,
  founderEligible,
  skipFounder = false,
}: {
  currentPlan: PlanId;
  founderEligible: boolean;
  /** After `?error=founder_ended`: the checkout forms tell startCheckout not
      to ask for the Founder code again (checkoutInput.founder), or the retry
      would be refused the same way and loop back to the same line. */
  skipFounder?: boolean;
}) {
  // Yearly first: it is the cheaper per-month number and the one we want read.
  const [interval, setBillingInterval] = React.useState<Interval>("year");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Plans</h2>
        <div
          role="group"
          aria-label="Billing interval"
          className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5"
        >
          {(["year", "month"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={interval === id}
              onClick={() => setBillingInterval(id)}
              className={cn(
                "focus-visible:ring-ring/50 flex h-7 items-center rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
                interval === id
                  ? "bg-background text-foreground font-medium shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {id === "year" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((id) => (
          <PlanColumn
            key={id}
            plan={PLANS[id]}
            interval={interval}
            currentPlan={currentPlan}
            founderEligible={founderEligible}
            skipFounder={skipFounder}
          />
        ))}
      </div>
    </section>
  );
}

function PlanColumn({
  plan,
  interval,
  currentPlan,
  founderEligible,
  skipFounder,
}: {
  plan: PlanDef;
  interval: Interval;
  currentPlan: PlanId;
  founderEligible: boolean;
  skipFounder: boolean;
}) {
  const current = plan.id === currentPlan;
  const paid = isPaidPlan(plan.id) ? plan.id : null;
  const showFounder = founderEligible && plan.id === "pro" && !current;

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-4", current && "border-primary/50")}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{plan.name}</span>
          {current ? <span className="text-muted-foreground text-xs">Current</span> : null}
        </div>
        <span className="text-2xl font-semibold">
          {paid ? `${formatUsd(pricePerMonth(paid, interval))} / mo` : "Free"}
        </span>
        <span className="text-muted-foreground text-xs">
          {paid
            ? interval === "year"
              ? `billed yearly · ${formatUsd(plan.yearly)} a year · save ${savingPercent(paid)}%`
              : "billed monthly"
            : "no card needed"}
        </span>
        {/* The coupon is 33.3 % off Pro MONTHLY, forever — so the ribbon only
            claims the price on the tab where it would actually apply, and the
            yearly tab says where to find it instead of implying it's included. */}
        {showFounder && interval === "month" ? (
          <span className="border-primary/40 text-primary mt-1 w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium">
            Founder price · {FOUNDER_MONTHLY}/mo for life
          </span>
        ) : null}
        {showFounder && interval === "year" ? (
          <span className="text-muted-foreground mt-1 text-[11px]">
            Founder price ({FOUNDER_MONTHLY}/mo for life) applies to monthly billing.
          </span>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm">{plan.blurb}</p>

      <dl className="flex flex-col gap-1.5 text-xs">
        {PLAN_ROWS.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 text-right font-medium">{row.value(plan)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto pt-1">
        <PlanCta plan={plan} interval={interval} currentPlan={currentPlan} skipFounder={skipFounder} />
      </div>
    </div>
  );
}

function PlanCta({
  plan,
  interval,
  currentPlan,
  skipFounder,
}: {
  plan: PlanDef;
  interval: Interval;
  currentPlan: PlanId;
  skipFounder: boolean;
}) {
  if (plan.id === currentPlan) {
    return (
      <Button type="button" variant="secondary" disabled className="w-full">
        Current plan
      </Button>
    );
  }
  // Free is where everyone starts; leaving a paid plan is a cancellation,
  // which lives in the provider's portal — we build no downgrade screens
  // (spec §7.6).
  if (plan.id === "free") {
    return <p className="text-muted-foreground text-center text-xs">Included in every plan</p>;
  }
  // Any paid → paid move, in EITHER direction, is a change to the
  // subscription this org already pays for: a proration the portal does and
  // checkout cannot. A second checkout would buy a second subscription
  // alongside the first, so the only door here is the portal (startCheckout
  // refuses the same move server-side).
  if (isPaidPlan(currentPlan)) {
    return (
      <form action={openPortal}>
        <PortalButton />
      </form>
    );
  }
  return (
    <form action={startCheckout}>
      <input type="hidden" name="plan" value={plan.id} />
      <input type="hidden" name="interval" value={interval} />
      {skipFounder ? <input type="hidden" name="founder" value="skip" /> : null}
      <CheckoutButton>Upgrade to {plan.name}</CheckoutButton>
    </form>
  );
}

function CheckoutButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Opening checkout…" : children}
    </Button>
  );
}

function PortalButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="w-full">
      {pending ? "Opening portal…" : "Switch in the billing portal"}
    </Button>
  );
}
