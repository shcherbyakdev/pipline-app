import Link from "next/link";
import type { Entitlements } from "@/lib/billing/entitlements";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { resourceBannerText, resourceMeter } from "../resource-usage";
import { getBillingOverview, type BillingOverview } from "../queries";

/** How close to the free reminder cap before we say something. */
const REMINDER_WARN_AT = 24;

type Usage = BillingOverview["usage"];

/** Where the nudge sends the org: Billing sells the way up while it is on;
    otherwise the waitlist, which grants Pro — so only a Free org is sent
    there, and an org already on Pro (waitlisted, comped) gets the fact
    without a door that leads nowhere. */
export function bannerCta(flags: Pick<Flags, "billing" | "premium_waitlist">, ent: Pick<Entitlements, "plan">, label: string): { href: string; label: string } | null {
  if (flags.billing) return { href: "/billing", label };
  if (flags.premium_waitlist && ent.plan === "free") return { href: "/waitlist", label: "Join the Premium waitlist" };
  return null;
}

/* The nudges in the shell (the spec's sidebar pill was folded into these —
   ruling 2026-08-18). Both can be true at once — hidden resources and a
   nearly-spent reminder quota are different problems with different fixes —
   so both render, hidden resources first: that one is silent, because the
   people and units it names simply aren't bookable publicly. */
export function PlanBanner({ ent, mode, usage, flags }: { ent: Entitlements; mode: OrgMode; usage: Usage; flags: Pick<Flags, "billing" | "premium_waitlist"> }) {
  const { hidden } = resourceMeter(usage, mode, ent);
  const cap = ent.reminderBookingsPerMonth;
  const overResources = hidden > 0;
  const nearQuota = cap !== null && usage.bookingsThisMonth >= REMINDER_WARN_AT;
  if (!overResources && !nearQuota) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {overResources ? <Notice cta={bannerCta(flags, ent, "Manage plan")}>{resourceBannerText(hidden, ent.bookableResources)}</Notice> : null}
      {nearQuota && cap !== null ? (
        <Notice cta={bannerCta(flags, ent, "Upgrade")}>
          {usage.bookingsThisMonth >= cap
            ? `You've used all ${cap} free reminder bookings this month — bookings made now won't get a reminder until it rolls over.`
            : `You've used ${usage.bookingsThisMonth} of ${cap} free reminder bookings this month.`}
        </Notice>
      ) : null}
    </div>
  );
}

function Notice({ children, cta }: { children: React.ReactNode; cta: { href: string; label: string } | null }) {
  return (
    <div
      role="status"
      className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm"
    >
      <span>{children}</span>
      {cta ? (
        <Link href={cta.href} className="text-foreground font-medium underline underline-offset-4">
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

/* What the dashboard layout renders. The read is wrapped because it runs on
   every dashboard page: a billing hiccup may cost the nudge, never the app
   (spec §7.10). No flag check here — the layout already gates this slot on
   plansEnforced(flags) before mounting it, so an unenforced org never reaches
   this read at all (the "run zero queries" guard this used to do lives there now). */
export async function PlanBannerSlot({ flags }: { flags: Pick<Flags, "billing" | "premium_waitlist"> }) {
  const overview = await overviewOrNull();
  if (!overview) return null;
  return <PlanBanner ent={overview.entitlements} mode={overview.mode} usage={overview.usage} flags={flags} />;
}

// Separate from the component: JSX must not be constructed inside a try/catch
// (react-hooks/error-boundaries — a render error wouldn't be caught there
// anyway). Only the await is guarded.
async function overviewOrNull(): Promise<BillingOverview | null> {
  try {
    return await getBillingOverview();
  } catch (error) {
    console.error("[billing] plan banner:", error);
    return null;
  }
}
