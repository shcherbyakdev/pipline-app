import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
} from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";

  if (params.view === "list") {
    const { upcoming, past } = await listBookings();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Bookings</h1>
          <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Calendar view
          </Link>
        </div>
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} />
      </div>
    );
  }

  const weekStart = mondayOf(
    params.week && DATE_RE.test(params.week) ? params.week : dateInZone(new Date(), timeZone),
  );
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
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Bookings</h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/bookings?week=${addDaysISO(weekStart, -7)}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            ←
          </Link>
          <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Today
          </Link>
          <Link
            href={`/bookings?week=${addDaysISO(weekStart, 7)}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            →
          </Link>
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
      />
    </div>
  );
}
