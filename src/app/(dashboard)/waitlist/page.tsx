import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CrownIcon } from "@hugeicons/core-free-icons";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { PLANS } from "@/lib/billing/plans";
import { resourceKind } from "@/lib/billing/entitlements";
import { effectiveMode, modeOf, type OrgMode } from "@/features/orgs/mode";
import { getPlanStatus } from "@/features/billing/queries";
import { joinPremiumWaitlist } from "@/features/billing/waitlist-actions";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/shell/page-header";

/** What joining unlocks — Pro's limits, said in the customer's words. The
    numbers read from PLANS so they can never drift from the gate, and the
    first perk names the workspace's own channel: people, or units. */
const perksFor = (mode: OrgMode) =>
  [
    [resourceKind(mode), { count: PLANS.pro.limits.bookableResources }],
    ["reminders", { free: PLANS.free.limits.reminderBookingsPerMonth ?? 0 }],
    ["badge", {}],
  ] as const;

/* The premium waitlist: the pitch, the one button, the joined state. Live
   only while the org's `premium_waitlist` flag resolves true (lib/flags) —
   the sidebar card, the plan tag and the landing all point here. */
export default async function WaitlistPage({ searchParams }: PageProps<"/waitlist">) {
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  if (!flags.premium_waitlist) notFound();
  const [{ joined, error }, status, t] = await Promise.all([searchParams, getPlanStatus(), getTranslations("billing.waitlist")]);
  const justJoined = joined === "1" && status.waitlisted;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageIntro>{t("intro")}</PageIntro>
      {error === "join" ? (
        <p role="alert" className="text-destructive text-sm">
          {t("error")}
        </p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-lg border p-5">
        {status.waitlisted ? (
          <div className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="text-brand-text shrink-0" />
              {t("joinedHeading")}
            </h2>
            <p role={justJoined ? "status" : undefined} className="text-muted-foreground text-sm">
              {justJoined ? t("joinedJustNow") : t("joinedSub")}
            </p>
          </div>
        ) : status.plan !== "free" ? (
          <p className="text-muted-foreground text-sm">{t("alreadyPremium")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <HugeiconsIcon icon={CrownIcon} size={20} className="text-brand-text shrink-0" />
                {t("heading")}
              </h2>
              <p className="text-muted-foreground text-sm">{t("sub")}</p>
            </div>
            <form action={joinPremiumWaitlist}>
              <Button type="submit" variant="brand">
                {t("join")}
              </Button>
            </form>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-subtle text-xs font-medium">{t("perksHeading")}</h3>
          <ul className="flex flex-col gap-1.5">
            {perksFor(effectiveMode(flags, modeOf(org))).map(([key, values]) => (
              <li key={key} className="flex items-start gap-2 text-sm">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-brand-text mt-0.5 shrink-0" />
                <span>{t(`perks.${key}`, values)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
