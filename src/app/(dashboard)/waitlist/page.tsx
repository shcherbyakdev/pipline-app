import { notFound } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon, CrownIcon } from "@hugeicons/core-free-icons";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { getPlanStatus } from "@/features/billing/queries";
import { joinPremiumWaitlist } from "@/features/billing/waitlist-actions";
import { WAITLIST, WAITLIST_PERKS } from "@/features/billing/waitlist-copy";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/shell/page-header";

/* The premium waitlist: the pitch, the one button, the joined state. Live
   only while the org's `premium_waitlist` flag resolves true (lib/flags) —
   the sidebar card, the plan tag and the landing all point here. */
export default async function WaitlistPage({ searchParams }: PageProps<"/waitlist">) {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).premium_waitlist) notFound();
  const { joined, error } = await searchParams;
  const status = await getPlanStatus();
  const justJoined = joined === "1" && status.waitlisted;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageIntro>{WAITLIST.intro}</PageIntro>
      {error === "join" ? (
        <p role="alert" className="text-destructive text-sm">
          {WAITLIST.error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-lg border p-5">
        {status.waitlisted ? (
          <div className="flex flex-col gap-1.5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} className="text-brand-text shrink-0" />
              {WAITLIST.joinedHeading}
            </h2>
            <p role={justJoined ? "status" : undefined} className="text-muted-foreground text-sm">
              {justJoined ? WAITLIST.joinedJustNow : WAITLIST.joinedSub}
            </p>
          </div>
        ) : status.plan !== "free" ? (
          <p className="text-muted-foreground text-sm">{WAITLIST.alreadyPremium}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <HugeiconsIcon icon={CrownIcon} size={20} className="text-brand-text shrink-0" />
                {WAITLIST.heading}
              </h2>
              <p className="text-muted-foreground text-sm">{WAITLIST.sub}</p>
            </div>
            <form action={joinPremiumWaitlist}>
              <Button type="submit" variant="brand">
                {WAITLIST.join}
              </Button>
            </form>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-subtle text-xs font-medium">{WAITLIST.perksHeading}</h3>
          <ul className="flex flex-col gap-1.5">
            {WAITLIST_PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-2 text-sm">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} className="text-brand-text mt-0.5 shrink-0" />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
