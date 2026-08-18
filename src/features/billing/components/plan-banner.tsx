import Link from "next/link";
import { BILLING_ENABLED } from "@/lib/flags";
import type { Entitlements } from "@/lib/billing/entitlements";
import { getBillingOverview, type BillingOverview } from "../queries";

/** How close to the free reminder cap before we say something. */
const REMINDER_WARN_AT = 24;

type Usage = BillingOverview["usage"];

/* The one nudge in the shell (the spec's sidebar pill was folded into this —
   ruling 2026-08-18). At most one line: staff over the limit first, because
   that one is silent — those people are simply not bookable publicly — while
   the reminder cap is a countdown the provider can watch. */
export function PlanBanner({ ent, usage }: { ent: Entitlements; usage: Usage }) {
  if (!BILLING_ENABLED) return null;
  const hidden = usage.activeStaff - ent.bookableStaff;
  const cap = ent.reminderBookingsPerMonth;

  if (hidden > 0) {
    return (
      <Notice cta="Manage plan">
        Your plan allows {ent.bookableStaff} bookable team member{ent.bookableStaff === 1 ? "" : "s"}; {hidden}{" "}
        {hidden === 1 ? "person isn't" : "people aren't"} bookable publicly.
      </Notice>
    );
  }
  if (cap !== null && usage.bookingsThisMonth >= REMINDER_WARN_AT) {
    return (
      <Notice cta="Upgrade">
        {usage.bookingsThisMonth >= cap
          ? `You've used all ${cap} free reminder bookings this month — bookings made now won't get a reminder until it rolls over.`
          : `You've used ${usage.bookingsThisMonth} of ${cap} free reminder bookings this month.`}
      </Notice>
    );
  }
  return null;
}

function Notice({ children, cta }: { children: React.ReactNode; cta: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm"
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
   (spec §7.10). */
export async function PlanBannerSlot() {
  if (!BILLING_ENABLED) return null;
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
