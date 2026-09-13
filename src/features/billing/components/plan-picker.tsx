"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import type { Translator } from "@/i18n/translator";
import { resourceKind } from "@/lib/billing/entitlements";
import type { OrgMode } from "@/features/orgs/mode";
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
import { changePlan, startCheckout } from "../actions";

type T = Translator<"billing.picker">;

/* The ladder, rendered from PLANS — the only place prices and limits live
   (spec §7.3). The rows below read the same limits, so a number changed in
   plans.ts changes this table too. Two rows are prose because they aren't
   limits: the team layer (shipped in #39) and the brand basics every plan
   gets. Nothing here names an unshipped feature. */
const PLAN_ROWS: { label: (t: T, mode: OrgMode) => string; value: (t: T, plan: PlanDef) => string }[] = [
  // People or units, never both: the workspace sells one channel (0073).
  { label: (t, mode) => t(`rows.${resourceKind(mode)}`), value: (_t, p) => String(p.limits.bookableResources) },
  {
    label: (t) => t("rows.reminders"),
    value: (t, p) =>
      p.limits.reminderBookingsPerMonth === null
        ? t("rows.everyBooking")
        : t("rows.firstBookings", { count: p.limits.reminderBookingsPerMonth }),
  },
  { label: (t) => t("rows.brand"), value: (t) => t("rows.included") },
  { label: (t) => t("rows.badge"), value: (t, p) => (p.limits.hideBadge ? t("rows.included") : "—") },
  { label: (t) => t("rows.team"), value: (t, p) => (p.id === "team" ? t("rows.included") : "—") },
];

const COLUMNS: PlanId[] = ["free", ...PAID_PLANS];

/** What the Founder coupon makes Pro cost, derived from the same factor the
    coupon uses (spec §3/§7.12) — monthly only, which is why the ribbon below
    only appears on the monthly tab. */
const FOUNDER_MONTHLY = formatUsd(PLANS.pro.monthly * FOUNDER_PRICE_FACTOR);

const savingPercent = (plan: PaidPlanId) => Math.round(yearlySaving(plan) * 100);

export function PlanPicker({
  currentPlan,
  currentInterval,
  subscribed,
  mode,
  founderEligible,
  skipFounder = false,
}: {
  currentPlan: PlanId;
  /** The interval the org is billed on today, when it is billed at all. A
      column for the current plan on the OTHER interval is a switch, not a
      dead "Current plan" button. */
  currentInterval: Interval | null;
  /** There is a live provider subscription to change. False for an org whose
      paid plan comes from the waitlist or a comp: it has nothing to switch,
      so its buttons buy rather than switch. */
  subscribed: boolean;
  /** The org's effective channel — it decides what the limit row is called. */
  mode: OrgMode;
  founderEligible: boolean;
  /** After `?error=founder_ended`: the checkout forms tell startCheckout not
      to ask for the Founder code again (checkoutInput.founder), or the retry
      would be refused the same way and loop back to the same line. */
  skipFounder?: boolean;
}) {
  const t = useTranslations("billing.picker");
  // Yearly first: it is the cheaper per-month number and the one we want
  // read — except for an org that is already billed, where the tab it is on
  // is the one it wants to see first.
  const [interval, setBillingInterval] = React.useState<Interval>(currentInterval ?? "year");

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <div
          role="group"
          aria-label={t("interval")}
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
              {id === "year" ? t("yearly") : t("monthly")}
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
            currentInterval={currentInterval}
            subscribed={subscribed}
            mode={mode}
            founderEligible={founderEligible}
            skipFounder={skipFounder}
          />
        ))}
      </div>

      {/* What a switch costs, in the two shapes Stripe actually does it: a
          plan change at the same interval prorates onto the next invoice,
          while changing the interval credits the unused time and charges the
          new price today. Said once, under the buttons, rather than in a
          confirmation nobody reads. */}
      {subscribed ? <p className="text-muted-foreground text-xs">{t("switchNote")}</p> : null}
    </section>
  );
}

function PlanColumn({
  plan,
  interval,
  currentPlan,
  currentInterval,
  subscribed,
  mode,
  founderEligible,
  skipFounder,
}: {
  plan: PlanDef;
  interval: Interval;
  currentPlan: PlanId;
  currentInterval: Interval | null;
  subscribed: boolean;
  mode: OrgMode;
  founderEligible: boolean;
  skipFounder: boolean;
}) {
  const t = useTranslations("billing.picker");
  const tb = useTranslations("billing");
  const current = plan.id === currentPlan;
  const paid = isPaidPlan(plan.id) ? plan.id : null;
  const showFounder = founderEligible && plan.id === "pro" && !current;

  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border p-4", current && "border-primary/50")}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{plan.name}</span>
          {current ? <span className="text-muted-foreground text-xs">{t("current")}</span> : null}
        </div>
        <span className="text-2xl font-semibold">
          {paid ? t("perMo", { price: formatUsd(pricePerMonth(paid, interval)) }) : t("freePrice")}
        </span>
        <span className="text-muted-foreground text-xs">
          {paid
            ? interval === "year"
              ? t("billedYearly", { yearly: formatUsd(plan.yearly), percent: savingPercent(paid) })
              : t("billedMonthly")
            : t("noCard")}
        </span>
        {/* The coupon is 33.3 % off Pro MONTHLY, forever — so the ribbon only
            claims the price on the tab where it would actually apply, and the
            yearly tab says where to find it instead of implying it's included. */}
        {showFounder && interval === "month" ? (
          <span className="border-primary/40 text-primary mt-1 w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium">
            {t("founderRibbon", { price: FOUNDER_MONTHLY })}
          </span>
        ) : null}
        {showFounder && interval === "year" ? (
          <span className="text-muted-foreground mt-1 text-[11px]">{t("founderYearlyNote", { price: FOUNDER_MONTHLY })}</span>
        ) : null}
      </div>

      <p className="text-muted-foreground text-sm">{tb(`plans.${plan.id}.blurb`)}</p>

      <dl className="flex flex-col gap-1.5 text-xs">
        {PLAN_ROWS.map((row, i) => (
          <div key={i} className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{row.label(t, mode)}</dt>
            <dd className="shrink-0 text-right font-medium">{row.value(t, plan)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto pt-1">
        <PlanCta
          plan={plan}
          interval={interval}
          currentPlan={currentPlan}
          currentInterval={currentInterval}
          subscribed={subscribed}
          skipFounder={skipFounder}
        />
      </div>
    </div>
  );
}

function PlanCta({
  plan,
  interval,
  currentPlan,
  currentInterval,
  subscribed,
  skipFounder,
}: {
  plan: PlanDef;
  interval: Interval;
  currentPlan: PlanId;
  currentInterval: Interval | null;
  subscribed: boolean;
  skipFounder: boolean;
}) {
  const t = useTranslations("billing.picker");
  // The plan AND the interval have to match for this to be what the org is
  // on: same plan, other tab, is the interval switch.
  const sameInterval = !subscribed || interval === currentInterval;
  if (plan.id === currentPlan && sameInterval) {
    return (
      <Button type="button" variant="secondary" disabled className="w-full">
        {t("currentPlan")}
      </Button>
    );
  }
  // Free is where everyone starts; leaving a paid plan is a cancellation,
  // which lives on the plan card above.
  if (plan.id === "free") {
    return <p className="text-muted-foreground text-center text-xs">{t("includedEverywhere")}</p>;
  }
  // A live subscription is CHANGED, never bought again: in either direction,
  // and across intervals, it is one proration on what the org already pays
  // for. A second checkout would buy a second subscription alongside the
  // first — startCheckout refuses the same move server-side.
  //
  // `subscribed`, not `isPaidPlan(currentPlan)`: an org on Pro through the
  // waitlist or a comp has no provider subscription to change, and offering
  // it a switch would only be refused.
  if (subscribed) {
    return (
      <form action={changePlan}>
        <input type="hidden" name="plan" value={plan.id} />
        <input type="hidden" name="interval" value={interval} />
        <SwitchButton>
          {plan.id === currentPlan
            ? t(interval === "year" ? "switchToYearly" : "switchToMonthly")
            : t("switchTo", { plan: plan.name })}
        </SwitchButton>
      </form>
    );
  }
  return (
    <form action={startCheckout}>
      <input type="hidden" name="plan" value={plan.id} />
      <input type="hidden" name="interval" value={interval} />
      {skipFounder ? <input type="hidden" name="founder" value="skip" /> : null}
      <CheckoutButton>{t("upgradeTo", { plan: plan.name })}</CheckoutButton>
    </form>
  );
}

function CheckoutButton({ children }: { children: React.ReactNode }) {
  const t = useTranslations("billing.picker");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t("openingCheckout") : children}
    </Button>
  );
}

function SwitchButton({ children }: { children: React.ReactNode }) {
  const t = useTranslations("billing.picker");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="w-full">
      {pending ? t("switching") : children}
    </Button>
  );
}
