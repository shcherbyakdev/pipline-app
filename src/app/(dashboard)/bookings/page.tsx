import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
} from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listOfferings, listTimelineData } from "@/features/rentals/queries";
import { TIMELINE_DAYS, timelineDefaultStart } from "@/features/rentals/timeline-geometry";
import { Timeline } from "@/features/rentals/components/timeline";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A well-shaped date param (DATE_RE) can still be calendrically invalid
// (e.g. "2027-13-45") — `new Date(...)` on it yields NaN, which would blow
// up downstream date maths with a 500. Anything that doesn't parse falls
// back to the caller's default.
function validDate(param: string | undefined, fallback: string): string {
  return param !== undefined &&
    DATE_RE.test(param) &&
    !Number.isNaN(new Date(`${param}T12:00:00Z`).getTime())
    ? param
    : fallback;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; from?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";

  if (params.view === "timeline") {
    const fromDate = validDate(
      params.from,
      timelineDefaultStart(dateInZone(new Date(), timeZone)),
    );
    const { offerings, blackouts, bookings } = await listTimelineData(
      fromDate,
      timeZone,
      TIMELINE_DAYS,
    );
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Bookings</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/bookings?view=timeline"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Today
            </Link>
            <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Week
            </Link>
            <Link
              href="/bookings?view=list"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              List
            </Link>
          </div>
        </div>
        <Timeline
          fromDate={fromDate}
          timeZone={timeZone}
          offerings={offerings}
          blackouts={blackouts}
          bookings={bookings}
          prevHref={`/bookings?view=timeline&from=${addDaysISO(fromDate, -7)}`}
          nextHref={`/bookings?view=timeline&from=${addDaysISO(fromDate, 7)}`}
          todayHref="/bookings?view=timeline"
        />
      </div>
    );
  }

  // The Timeline link only makes sense once the org actually rents
  // something out — appointment-only orgs never see it.
  const hasRentals = (await listOfferings()).length > 0;
  const timelineLink = hasRentals ? (
    <Link
      href="/bookings?view=timeline"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
    >
      Timeline
    </Link>
  ) : null;

  if (params.view === "list") {
    const { upcoming, past } = await listBookings();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Bookings</h1>
          <div className="flex items-center gap-2">
            {timelineLink}
            <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Calendar view
            </Link>
          </div>
        </div>
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} />
      </div>
    );
  }

  const weekStart = mondayOf(validDate(params.week, dateInZone(new Date(), timeZone)));
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  const [bookings, exceptions, services, { rules }] = await Promise.all([
    listConfirmedBookingsBetween(fromIso, toIso),
    listExceptionsBetween(weekStart, weekEnd),
    listServices(),
    getAvailabilityAdmin(),
  ]);

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height
    // (week arrows live inside the grid header; see CalendarWeek).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Bookings</h1>
        <div className="flex items-center gap-2">
          <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Today
          </Link>
          {timelineLink}
          <Link
            href="/bookings?view=list"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            List view
          </Link>
        </div>
      </div>
      <CalendarWeek
        weekStart={weekStart}
        timeZone={timeZone}
        bookings={bookings}
        rules={rules}
        exceptions={exceptions}
        services={services.filter((s) => s.active)}
        prevHref={`/bookings?week=${addDaysISO(weekStart, -7)}`}
        nextHref={`/bookings?week=${addDaysISO(weekStart, 7)}`}
      />
    </div>
  );
}
