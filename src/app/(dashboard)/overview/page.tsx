import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Clock01Icon,
  Globe02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listStatsBookings } from "@/features/scheduling/queries";
import { loadDailyList } from "@/features/scheduling/daily-list";
import { DailyList } from "@/features/scheduling/components/daily-list";
import { hasActivePaymentAccount } from "@/features/payments/queries";
import { createClient } from "@/lib/supabase/server";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { buildYearHeatmap } from "@/features/scheduling/stats";
import { CELL, HEAT_LEVELS, PENDING_FILL, PENDING_RING, TODAY_OUTLINE } from "./heatmap-cells";
import { YearGrid } from "./year-grid";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { INTL_LOCALES } from "@/i18n/config";
import { railLinkClass } from "@/components/shell/rail";
import { cn } from "@/lib/utils";

/* The right rail's "Go to" list mirrors the sidebar's day-to-day rows, so it
   only holds routes every org has — no flag/mode filtering needed here. The
   words are the sidebar's own (shell.nav.*). */
const GO_TO = [
  { href: "/bookings", labelKey: "bookings", icon: Calendar03Icon },
  { href: "/clients", labelKey: "clients", icon: UserMultipleIcon },
  { href: "/availability", labelKey: "availability", icon: Clock01Icon },
  { href: "/booking-page", labelKey: "bookingPage", icon: Globe02Icon },
] as const;

const MAX_AVATARS = 5;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [t, tShell, locale, settings] = await Promise.all([
    getTranslations("overview"),
    getTranslations("shell"),
    getLocale(),
    getSchedulingSettings(),
  ]);
  const timeZone = settings?.timezone ?? "UTC";
  const now = new Date();
  const todayISO = dateInZone(now, timeZone);
  const currentYear = Number(todayISO.slice(0, 4));
  // Bookings can sit one year ahead; anything far back is a typo, not data.
  const minYear = currentYear - 5;
  const maxYear = currentYear + 1;
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested)
    ? Math.min(Math.max(requested, minYear), maxYear)
    : currentYear;

  const orgId = settings?.orgId ?? null;
  const fallbackTitle = (await getTranslations("bookings"))("fallbackTitle");
  const [list, canCollectOnline, rows, staff] = await Promise.all([
    orgId
      ? loadDailyList(await createClient(), orgId, fallbackTitle, now)
      : Promise.resolve({ requests: [], holds: [], balances: [] }),
    orgId ? hasActivePaymentAccount(orgId) : Promise.resolve(false),
    listStatsBookings(
      wallTimeToUtc(`${year}-01-01`, "00:00", timeZone).toISOString(),
      wallTimeToUtc(`${year + 1}-01-01`, "00:00", timeZone).toISOString(),
    ),
    listActiveStaff(),
  ]);
  const { weeks, confirmedTotal, pendingTotal } = buildYearHeatmap(rows, year, now, timeZone);
  const summary = t("summary", { count: confirmedTotal, pending: pendingTotal, year });
  const yearNavClass = cn(buttonVariants({ variant: "ghost", size: "icon-xs" }));
  const overflow = staff.length > MAX_AVATARS ? `+${staff.length - MAX_AVATARS}` : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-12 p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-10">
        {/* The year glance leads the page, on a busy day as on a quiet one
            (2026-09-10): it is the one section that is always there, so the
            page's shape stops depending on how the day is going. Amends S4
            ruling 4 back to the 2026-09-01 order. */}
        <section className="flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">{t("activity")}</h2>
              <p className="text-muted-foreground mt-0.5 text-[13px]">{summary}</p>
            </div>
            <nav aria-label={t("year")} className="flex items-center gap-0.5">
              {year > minYear ? (
                <Link
                  href={`/overview?year=${year - 1}`}
                  aria-label={t("showYear", { year: year - 1 })}
                  className={yearNavClass}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <span aria-hidden className={cn(yearNavClass, "pointer-events-none opacity-40")}>
                  <ChevronLeft className="size-3.5" />
                </span>
              )}
              <span className="min-w-10 text-center text-[13px] font-medium tabular-nums">
                {year}
              </span>
              {year < maxYear ? (
                <Link
                  href={`/overview?year=${year + 1}`}
                  aria-label={t("showYear", { year: year + 1 })}
                  className={yearNavClass}
                >
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <span aria-hidden className={cn(yearNavClass, "pointer-events-none opacity-40")}>
                  <ChevronRight className="size-3.5" />
                </span>
              )}
            </nav>
          </div>
          <div className="mt-4">
            <YearGrid weeks={weeks} todayISO={todayISO} summary={summary} intlLocale={INTL_LOCALES[locale]} />
            {/* On narrow screens the year overflows sideways; start the view
                centered on today instead of January. Classic inline script so
                it runs before paint settles — no client component needed. */}
            <script
              dangerouslySetInnerHTML={{
                __html: `(()=>{var c=document.currentScript.parentElement.querySelector('[role="img"]');if(!c||c.scrollWidth<=c.clientWidth)return;var t=c.querySelector('[data-today]');if(t)c.scrollLeft=t.getBoundingClientRect().left-c.getBoundingClientRect().left-c.clientWidth/2;})()`,
              }}
            />
          </div>
          <div className="text-subtle mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1">
              {t("less")}
              {HEAT_LEVELS.map((c) => (
                <span key={c} aria-hidden className={cn(CELL, c)} />
              ))}
              {t("more")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn(CELL, PENDING_FILL)} />
              <span aria-hidden className={cn(CELL, HEAT_LEVELS[2], PENDING_RING)} />
              {t("legendPending")}
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn(CELL, "bg-muted", TODAY_OUTLINE)} />
              {t("legendToday")}
            </span>
          </div>
        </section>

        {/* Then what needs doing: requests, holds expiring, balances due.
            Nothing at all when every section is empty (S4 ruling 4's own
            rule: an empty box every day is worse than silence). */}
        <DailyList list={list} timeZone={timeZone} canCollectOnline={canCollectOnline} />
      </div>

      <aside className="hidden w-44 shrink-0 flex-col gap-8 pt-1 lg:flex">
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-medium text-muted-foreground">{t("members")}</h2>
          <Link
            href="/team"
            className="focus-visible:ring-ring/30 flex w-fit items-center rounded-full outline-none focus-visible:ring-3"
            aria-label={t("teamMembers", { count: staff.length })}
          >
            {staff.slice(0, MAX_AVATARS).map((s) => (
              <span
                key={s.id}
                style={{ backgroundColor: s.color }}
                className="ring-card -ml-1.5 flex size-[22px] items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 first:ml-0"
              >
                {s.name.charAt(0).toUpperCase()}
              </span>
            ))}
            {overflow ? <span className="ml-1.5 text-xs text-muted-foreground">{overflow}</span> : null}
          </Link>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[13px] font-medium text-muted-foreground">
            {t("goTo")}
          </h2>
          {GO_TO.map(({ href, labelKey, icon }) => (
            <Link
              key={href}
              href={href}
              className={railLinkClass}
            >
              <HugeiconsIcon icon={icon} size={14} className="text-subtle shrink-0" />
              {tShell(`nav.${labelKey}`)}
            </Link>
          ))}
        </section>
      </aside>
    </div>
  );
}
