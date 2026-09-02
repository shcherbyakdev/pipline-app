import { getLocale, getTranslations } from "next-intl/server";
import { INTL_LOCALES } from "@/i18n/config";
import { formatUsd, PLANS, pricePerMonth } from "@/lib/billing/plans";
import { isOverrideActive } from "@/lib/billing/overrides";
import { Button } from "@/components/ui/button";
import { openPortal } from "../actions";
import type { BillingOverview } from "../queries";

/** Past tense once the period is behind us; "Ends" while a cancellation is
    still running out; "Renews" otherwise. */
function periodKey(sub: NonNullable<BillingOverview["subscription"]>) {
  if (sub.status === "expired") return "current.endedOn" as const;
  return sub.cancelAtPeriodEnd || sub.status === "cancelled" ? ("current.endsOn" as const) : ("current.renewsOn" as const);
}

/* What you are on today, and the one door out: the provider's portal, where
   cards, invoices, interval switches and cancellations live (spec §7.6).
   The plan shown is the EFFECTIVE one — a cancelled subscription keeps its
   plan until the period ends, an expired one already reads Free. */
export async function CurrentPlan({ overview }: { overview: BillingOverview }) {
  const [t, locale] = await Promise.all([getTranslations("billing"), getLocale()]);
  // Pinned locale + UTC (portal-links-panel precedent): the date must not
  // depend on the runtime's locale or zone.
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(INTL_LOCALES[locale as keyof typeof INTL_LOCALES], { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
      .format(new Date(iso));
  const { entitlements: ent, subscription: sub, override } = overview;
  const plan = PLANS[ent.plan];
  // A live comp (granted in /utils) is what the org is on; the provider row,
  // if any, is dormant underneath it and still manageable in the portal.
  const comped = isOverrideActive(override, new Date());
  const price = comped
    ? t("current.complimentary")
    : sub && ent.plan !== "free"
      ? t(sub.interval === "year" ? "current.perMonthYearly" : "current.perMonth", {
          price: formatUsd(pricePerMonth(sub.plan, sub.interval)),
        })
      : t("current.noCard");

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{plan.name}</span>
        <span className="text-muted-foreground text-sm">{price}</span>
      </div>
      <p className="text-muted-foreground text-sm">{t(`plans.${ent.plan}.blurb`)}</p>

      {comped ? (
        <p className="text-muted-foreground text-sm">
          {override.expiresAt ? t("current.until", { date: formatDate(override.expiresAt) }) : t("current.noExpiry")}
        </p>
      ) : (
        <>
          {sub?.status === "past_due" ? (
            <p className="text-sm text-amber-600 dark:text-amber-500">{t("current.pastDue")}</p>
          ) : null}
          {sub?.currentPeriodEnd ? (
            <p className="text-muted-foreground text-sm">{t(periodKey(sub), { date: formatDate(sub.currentPeriodEnd) })}</p>
          ) : null}
        </>
      )}

      {sub ? (
        <form action={openPortal}>
          <Button type="submit" variant="secondary">
            {t("current.manage")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
