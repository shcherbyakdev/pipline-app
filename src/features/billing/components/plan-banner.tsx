import Link from "next/link";
import type { Entitlements } from "@/lib/billing/entitlements";
import { getBillingOverview, type BillingOverview } from "../queries";

/** How close to the free reminder cap before we say something. */
const REMINDER_WARN_AT = 24;

type Usage = BillingOverview["usage"];

/* The nudges in the shell (the spec's sidebar pill was folded into these —
   ruling 2026-08-18). Both can be true at once — an over-limit roster and a
   nearly-spent reminder quota are different problems with different fixes —
   so both render, staff first: that one is silent, because the people it
   names simply aren't bookable publicly. */
export function PlanBanner({ ent, usage }: { ent: Entitlements; usage: Usage }) {
  const hidden = usage.activeStaff - ent.bookableResources;
  const cap = ent.reminderBookingsPerMonth;
  const overStaff = hidden > 0;
  const nearQuota = cap !== null && usage.bookingsThisMonth >= REMINDER_WARN_AT;
  if (!overStaff && !nearQuota) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {overStaff ? (
        <Notice cta="Manage plan">
          Your plan allows {ent.bookableResources} bookable team member{ent.bookableResources === 1 ? "" : "s"}; {hidden}{" "}
          {hidden === 1 ? "person isn't" : "people aren't"} bookable publicly.
        </Notice>
      ) : null}
      {nearQuota && cap !== null ? (
        <Notice cta="Upgrade">
          {usage.bookingsThisMonth >= cap
            ? `You've used all ${cap} free reminder bookings this month — bookings made now won't get a reminder until it rolls over.`
            : `You've used ${usage.bookingsThisMonth} of ${cap} free reminder bookings this month.`}
        </Notice>
      ) : null}
    </div>
  );
}

function Notice({ children, cta }: { children: React.ReactNode; cta: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm"
    >
      <span>{children}</span>
      <Link href="/billing" className="text-foreground font-medium underline underline-offset-4">
        {cta}
      </Link>
    </div>
  );
}

/* What the dashboard layout renders. The read is wrapped because it runs on
   every dashboard page: a billing hiccup may cost the nudge, never the app
   (spec §7.10). No flag check here — the layout already gates this slot on
   `flags.billing` before mounting it, so a flag-off org never reaches this
   read at all (the "run zero queries" guard this used to do lives there now). */
export async function PlanBannerSlot() {
  const overview = await overviewOrNull();
  if (!overview) return null;
  return <PlanBanner ent={overview.entitlements} usage={overview.usage} />;
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
