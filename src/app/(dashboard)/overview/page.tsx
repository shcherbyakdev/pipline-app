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
import { buildYearHeatmap, type HeatmapDay } from "@/features/scheduling/stats";
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

const HEAT_LEVELS = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

/* Amber = "needs attention", matching the rentals timeline. A pending-only
   day fills solid amber; a day that also has confirmed appointments keeps its
   load fill and gets the amber ring instead (the fill must stay readable).
   Today reuses the brand outline so it can stack with either. */
const PENDING_FILL = "bg-amber-400 dark:bg-amber-500";
const PENDING_RING = "ring-2 ring-amber-500 ring-inset";
const TODAY_OUTLINE = "outline-2 outline-brand-text";

const MAX_AVATARS = 5;

const CELL = "size-[13px] rounded-[3px]";

function YearGrid({
  weeks,
  todayISO,
  summary,
}: {
  weeks: HeatmapDay[][];
  todayISO: string;
  summary: string;
}) {
  const dayFmt = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const monthFmt = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
  // Month label above the column where a new month starts (judged by each
  // column's first in-year day, so the padded first column still reads "Jan").
  const firstDates = weeks.map((week) => week.find((d) => d !== null)?.date ?? "");
  const labels = firstDates.map((date, i) => {
    if (!date) return "";
    const month = date.slice(5, 7);
    return i === 0 || month !== firstDates[i - 1].slice(5, 7)
      ? monthFmt.format(new Date(`${date}T12:00:00Z`))
      : "";
  });
  return (
    // One image to assistive tech — 371 unlabeled cells would be noise; the
    // caption above carries the totals and the tooltips serve pointer users.
    <div role="img" aria-label={summary} className="flex gap-[2px] overflow-x-auto pb-1">
      <div className="text-subtle mt-[16px] mr-1 flex flex-col gap-[2px] text-[10px] leading-[13px]">
        {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => (
          <span key={i} className="h-[13px]">
            {d}
          </span>
        ))}
      </div>
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-[2px]">
          {/* Fixed to the cell width so a 3-letter label can't widen its
              column; the text just paints past the box. */}
          <span className="text-subtle h-[14px] w-[13px] text-[10px] leading-[14px] whitespace-nowrap">
            {labels[i]}
          </span>
          {week.map((day, d) =>
            day === null ? (
              <div key={d} className={CELL} />
            ) : (
              <div
                key={day.date}
                title={[
                  dayFmt.format(new Date(`${day.date}T12:00:00Z`)),
                  `${day.confirmed} ${day.confirmed === 1 ? "appointment" : "appointments"}`,
                  day.pending > 0 ? `${day.pending} pending` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                data-today={day.date === todayISO ? "" : undefined}
                className={cn(
                  CELL,
                  day.pending > 0 && day.confirmed === 0
                    ? PENDING_FILL
                    : HEAT_LEVELS[day.level],
                  day.pending > 0 && day.confirmed > 0 && PENDING_RING,
                  day.date === todayISO && TODAY_OUTLINE,
                )}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

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
