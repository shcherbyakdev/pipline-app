import { cookies } from "next/headers";
import type { Entitlements } from "@/lib/billing/entitlements";
import type { Flags } from "@/lib/flags";
import { getTranslations } from "next-intl/server";
import { upgradeHref } from "@/lib/billing/upgrade-path";
import type { OrgMode } from "@/features/orgs/mode";
import { resourceBannerText, resourceMeter } from "../resource-usage";
import { isNoticeDismissed, noticeToken, PLAN_NOTICE_COOKIE } from "../plan-notice";
import { DismissibleNotice } from "./dismissible-notice";
import { getBillingOverview, type BillingOverview } from "../queries";

/** How close to the free reminder cap before we say something. */
const REMINDER_WARN_AT = 24;

type Usage = BillingOverview["usage"];

/** Where the nudge sends the org: Billing sells the way up while it is on;
    otherwise the waitlist, which grants Pro — so only a Free org is sent
    there, and an org already on Pro (waitlisted, comped) gets the fact
    without a door that leads nowhere. */
export function bannerCta(
  flags: Pick<Flags, "billing" | "premium_waitlist">,
  ent: Pick<Entitlements, "plan">,
  label: string,
  waitlistLabel: string,
): { href: string; label: string } | null {
  const href = upgradeHref(flags, ent.plan);
  if (!href) return null;
  return { href, label: href === "/billing" ? label : waitlistLabel };
}

/* The nudges in the shell (the spec's sidebar pill was folded into these —
   ruling 2026-08-18). Both can be true at once — people (or units) missing
   from the page and a nearly-spent reminder quota are different problems
   with different fixes — so both render, the hidden ones first: that one is
   silent, because what it names simply isn't bookable publicly.

   Each is closable, and the dismissal is keyed to what the notice SAYS
   (plan-notice.ts): closing "1 person isn't on your booking page" doesn't
   silence "2 people aren't", and next month's reminder warning is a new
   notice. The month is read in UTC — this is a cookie key, not billing
   maths, and a few hours' drift at a month boundary costs nothing. */
export async function PlanBanner({
  orgId,
  ent,
  mode,
  usage,
  flags,
  dismissed,
}: {
  orgId: string;
  ent: Entitlements;
  mode: OrgMode;
  usage: Usage;
  flags: Pick<Flags, "billing" | "premium_waitlist">;
  dismissed: string | undefined;
}) {
  const [t, te] = await Promise.all([getTranslations("billing"), getTranslations("errors")]);
  const waitlistLabel = te("upgradeLabel.waitlist");
  const { hidden } = resourceMeter(t, usage, mode, ent);
  const cap = ent.reminderBookingsPerMonth;
  const atCap = cap !== null && usage.bookingsThisMonth >= cap;

  const notices: { kind: string; signature: string; text: string; cta: { href: string; label: string } | null }[] = [];
  if (hidden > 0) {
    notices.push({
      kind: "resources",
      signature: String(hidden),
      text: resourceBannerText(t, mode, hidden, ent.bookableResources),
      cta: bannerCta(flags, ent, t("banner.managePlan"), waitlistLabel),
    });
  }
  if (cap !== null && usage.bookingsThisMonth >= REMINDER_WARN_AT) {
    notices.push({
      kind: "reminders",
      signature: `${new Date().toISOString().slice(0, 7)}-${atCap ? "all" : "near"}`,
      text: atCap ? t("banner.remindersUsedAll", { cap }) : t("banner.remindersUsed", { used: usage.bookingsThisMonth, cap }),
      cta: bannerCta(flags, ent, t("banner.upgrade"), waitlistLabel),
    });
  }
  const shown = notices.filter((n) => !isNoticeDismissed(dismissed, noticeToken(orgId, n.kind, n.signature)));
  if (shown.length === 0) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {shown.map((n) => (
        <DismissibleNotice key={n.kind} {...n} />
      ))}
    </div>
  );
}

/* What the dashboard layout renders. The read is wrapped because it runs on
   every dashboard page: a billing hiccup may cost the nudge, never the app
   (spec §7.10). No flag check here — the layout already gates this slot on
   plansEnforced(flags) before mounting it, so an unenforced org never reaches
   this read at all (the "run zero queries" guard this used to do lives there now). */
export async function PlanBannerSlot({ flags }: { flags: Pick<Flags, "billing" | "premium_waitlist"> }) {
  const [overview, jar] = await Promise.all([overviewOrNull(), cookies()]);
  if (!overview) return null;
  return (
    <PlanBanner
      orgId={overview.orgId}
      ent={overview.entitlements}
      mode={overview.mode}
      usage={overview.usage}
      flags={flags}
      dismissed={jar.get(PLAN_NOTICE_COOKIE)?.value}
    />
  );
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
