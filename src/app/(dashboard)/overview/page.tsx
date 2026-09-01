import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  Clock01Icon,
  Globe02Icon,
  UserMultipleIcon,
} from "@hugeicons/core-free-icons";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listPendingRequests, listStatsBookings } from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { buildYearHeatmap } from "@/features/scheduling/stats";
import { CELL, HEAT_LEVELS, PENDING_FILL, PENDING_RING, TODAY_OUTLINE } from "./heatmap-cells";
import { YearGrid } from "./year-grid";
import { RequestsInbox } from "@/features/scheduling/components/requests-inbox";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { cn } from "@/lib/utils";

/* The right rail's "Go to" list mirrors the sidebar's day-to-day rows, so it
   only holds routes every org has — no flag/mode filtering needed here. */
const GO_TO = [
  { href: "/bookings", label: "Bookings", icon: Calendar03Icon },
  { href: "/clients", label: "Clients", icon: UserMultipleIcon },
  { href: "/availability", label: "Availability", icon: Clock01Icon },
  { href: "/booking-page", label: "Booking page", icon: Globe02Icon },
] as const;

const MAX_AVATARS = 5;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const settings = await getSchedulingSettings();
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

  const [requests, rows, staff] = await Promise.all([
    listPendingRequests(),
    listStatsBookings(
      wallTimeToUtc(`${year}-01-01`, "00:00", timeZone).toISOString(),
      wallTimeToUtc(`${year + 1}-01-01`, "00:00", timeZone).toISOString(),
    ),
    listActiveStaff(),
  ]);
  const { weeks, confirmedTotal, pendingTotal } = buildYearHeatmap(rows, year, now, timeZone);
  const summary = `${confirmedTotal} ${confirmedTotal === 1 ? "appointment" : "appointments"}${
    pendingTotal > 0 ? ` · ${pendingTotal} pending` : ""
  } in ${year}`;
  const yearNavClass = cn(buttonVariants({ variant: "ghost", size: "icon-xs" }));

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-12 p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-10">
        <section className="flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium">Activity</h2>
              <p className="text-muted-foreground mt-0.5 text-[13px]">{summary}</p>
            </div>
            <nav aria-label="Year" className="flex items-center gap-0.5">
              {year > minYear ? (
                <Link
                  href={`/overview?year=${year - 1}`}
                  aria-label={`Show ${year - 1}`}
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
                  aria-label={`Show ${year + 1}`}
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
            <YearGrid weeks={weeks} todayISO={todayISO} summary={summary} />
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
              Less
              {HEAT_LEVELS.map((c) => (
                <span key={c} aria-hidden className={cn(CELL, c)} />
              ))}
              More
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn(CELL, PENDING_FILL)} />
              <span aria-hidden className={cn(CELL, HEAT_LEVELS[2], PENDING_RING)} />
              pending request
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn(CELL, "bg-muted", TODAY_OUTLINE)} />
              today
            </span>
          </div>
        </section>

        {/* User ruling 2026-09-01: the year glance leads the page; requests
            follow. Renders nothing when there are none. */}
        <RequestsInbox requests={requests} timeZone={timeZone} />
      </div>

      <aside className="hidden w-44 shrink-0 flex-col gap-8 pt-1 lg:flex">
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-medium text-muted-foreground">Members</h2>
          <Link
            href="/team"
            className="focus-visible:ring-ring/30 flex w-fit items-center rounded-full outline-none focus-visible:ring-3"
            aria-label={`Team members (${staff.length})`}
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
            {staff.length > MAX_AVATARS ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                +{staff.length - MAX_AVATARS}
              </span>
            ) : null}
          </Link>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[13px] font-medium text-muted-foreground">
            Go to
          </h2>
          {GO_TO.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className="hover:bg-accent focus-visible:ring-ring/30 ease-strong -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-[5px] text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-3"
            >
              <HugeiconsIcon icon={icon} size={14} className="text-subtle shrink-0" />
              {label}
            </Link>
          ))}
        </section>
      </aside>
    </div>
  );
}
