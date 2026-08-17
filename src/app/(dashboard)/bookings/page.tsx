import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
} from "@/features/scheduling/queries";
import { listActiveStaff, type StaffRow } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listOfferings, listTimelineData } from "@/features/rentals/queries";
import { RENTALS_ENABLED } from "@/lib/flags";
import { TIMELINE_DAYS, timelineDefaultStart } from "@/features/rentals/timeline-geometry";
import { Timeline } from "@/features/rentals/components/timeline";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team (multi-staff): `?staff=a,b` narrows the week to those people. Only ids
// that name an active member count — a stale link, another org's id or plain
// junk quietly falls back to "everyone", the same forgiving rule the
// availability page applies to its own `?staff=`.
function parseStaffParam(param: string | undefined, active: StaffRow[]): string[] {
  const wanted = (param ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID_RE.test(id));
  const picked = active.filter((s) => wanted.includes(s.id));
  return picked.length > 0 ? picked.map((s) => s.id) : active.map((s) => s.id);
}

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
  searchParams: Promise<{ view?: string; week?: string; from?: string; staff?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";

  // Rentals parked for the MVP (lib/flags.ts): the timeline view falls back to
  // the week calendar and its link never renders.
  if (RENTALS_ENABLED && params.view === "timeline") {
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
        <div className="flex items-center justify-end gap-2">
          {/* view switchers only — date navigation (‹ Today ›) lives in the
              timeline's own header row, next to the window it moves. */}
          <div className="flex items-center gap-2">
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
  const hasRentals = RENTALS_ENABLED && (await listOfferings()).length > 0;
  const timelineLink = hasRentals ? (
    <Link
      href="/bookings?view=timeline"
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
    >
      Timeline
    </Link>
  ) : null;

  if (params.view === "list") {
    const [{ upcoming, past }, activeStaff] = await Promise.all([
      listBookings(),
      listActiveStaff(),
    ]);
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-end gap-2">
          {timelineLink}
          <Link href="/bookings" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Calendar view
          </Link>
        </div>
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} staff={activeStaff} />
      </div>
    );
  }

  const weekStart = mondayOf(validDate(params.week, dateInZone(new Date(), timeZone)));
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  // Availability is per staff now (Team slice), so the week is drawn for the
  // selected people: one selected ⇒ exactly their hours (and the solo org is
  // always this case, unchanged from before the slice); several ⇒ the union,
  // where an open tile means "someone is open".
  const activeStaff = await listActiveStaff();
  const selectedStaffIds = parseStaffParam(params.staff, activeStaff);
  // Only a real narrowing filters the bookings: rental stays have no staff, so
  // handing `.in("staff_id", …)` every active id would drop them from a week
  // nobody asked to narrow.
  const staffFilter =
    selectedStaffIds.length < activeStaff.length ? selectedStaffIds : undefined;
  const [bookings, exceptions, services, availability] = await Promise.all([
    listConfirmedBookingsBetween(fromIso, toIso, staffFilter),
    selectedStaffIds.length > 0
      ? listExceptionsBetween(weekStart, weekEnd, selectedStaffIds)
      : [],
    listServices(),
    Promise.all(selectedStaffIds.map((id) => getAvailabilityAdmin(id))),
  ]);
  const rules = availability.flatMap((a) => a.rules);
  // The week arrows are plain links — they have to carry the lens with them.
  const staffQuery = staffFilter ? `&staff=${staffFilter.join(",")}` : "";

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height
    // (week arrows live inside the grid header; see CalendarWeek).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <Link
            href={staffQuery ? `/bookings?${staffQuery.slice(1)}` : "/bookings"}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
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
        staff={activeStaff}
        selectedStaffIds={selectedStaffIds}
        // A walk-in drawn on a one-person week belongs to that person;
        // on the "everyone" week it defaults to the first active member.
        defaultStaffId={
          (selectedStaffIds.length === 1 ? selectedStaffIds[0] : activeStaff[0]?.id) ?? ""
        }
        bookings={bookings}
        rules={rules}
        exceptions={exceptions}
        services={services.filter((s) => s.active)}
        prevHref={`/bookings?week=${addDaysISO(weekStart, -7)}${staffQuery}`}
        nextHref={`/bookings?week=${addDaysISO(weekStart, 7)}${staffQuery}`}
      />
    </div>
  );
}
