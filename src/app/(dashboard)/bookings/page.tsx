import type { ReactNode } from "react";
import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
  countHoursOwners,
} from "@/features/scheduling/queries";
import { listActiveStaff, type StaffRow } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listOfferings, listTimelineData } from "@/features/rentals/queries";
import { NewBookingButton } from "@/features/scheduling/components/new-booking-button";
import { canCreateWalkIn } from "@/features/scheduling/booking-kinds";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { defaultBookingsView, effectiveMode, modeOf } from "@/features/orgs/mode";
import { SPACES } from "@/features/orgs/vocab";
import { TIMELINE_DAYS, timelineDefaultStart } from "@/features/rentals/timeline-geometry";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { ViewSwitcher } from "@/features/scheduling/components/view-switcher";
import { applyStaffLens } from "@/features/scheduling/staff-lens";
import type { BookingsView } from "@/features/scheduling/bookings-views";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { unionWindows, weekdayOf } from "@/features/scheduling/day-windows";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { getPageDraftState } from "@/features/booking-page/queries";
import { setupChecklist, type ChecklistItem } from "@/features/scheduling/setup-checklist";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { WelcomeBanner } from "@/features/scheduling/components/welcome-banner";

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

function asView(param: string | undefined, fallback: BookingsView): BookingsView {
  return param === "week" || param === "timeline" || param === "list" ? param : fallback;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; from?: string; staff?: string; welcome?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";
  const today = dateInZone(new Date(), timeZone);
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const mode = modeOf(org);
  const eff = effectiveMode(flags, mode);
  const rentals = eff.offersRentals;

  // Fetched once, up front, for every view: the catalogue decides the
  // default view, the Timeline link and (Task 3) the New-booking picker;
  // the roster drives the week's lens and the walk-in's staff picker.
  const [orgOfferings, services, activeStaff] = await Promise.all([
    rentals ? listOfferings() : Promise.resolve([]),
    eff.offersAppointments ? listServices() : Promise.resolve([]),
    eff.offersAppointments ? listActiveStaff() : Promise.resolve([]),
  ]);
  const spaces = orgOfferings.filter((o) => o.active);
  const activeServices = services.filter((s) => s.active);
  const hasHourly = spaces.some((o) => o.rangeMode === "hours");
  const hasRangeOfferings = spaces.some((o) => o.rangeMode !== "hours");
  const view = asView(params.view, rentals ? defaultBookingsView(eff, hasHourly) : "week");
  // The switcher's Timeline item only makes sense once the org sells spaces
  // AND has a nights/days one to show there (hourly bookings live on the
  // week grid). The branch itself still answers an explicit ?view=timeline
  // (and the nights-only default) with the Timeline's own empty state.
  const showTimeline = rentals && hasRangeOfferings;

  // Welcome checklist: three cheap reads, only on the one request that
  // carries ?welcome=1 (nothing is persisted — spec §4 ruling 8).
  let checklist: ChecklistItem[] = [];
  if (params.welcome === "1") {
    const [ownersWithHours, page] = await Promise.all([countHoursOwners(), getPageDraftState(org.id)]);
    checklist = setupChecklist({
      mode: eff,
      serviceCount: activeServices.length,
      spaceCount: spaces.length,
      ownersWithHours,
      published: page.published !== null,
    });
  }
  const welcome =
    params.welcome === "1" ? (
      <WelcomeBanner
        handle={settings?.handle ?? null}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        mode={eff}
        checklist={checklist}
      />
    ) : null;

  // One entry for every kind of walk-in (spec §2, ruling 5). On the
  // "everyone" week a walk-in defaults to the first active member; the week
  // branch below overrides that for a one-person lens.
  const newBookingFor = (defaultStaffId: string) =>
    canCreateWalkIn(activeServices, spaces) ? (
      <NewBookingButton
        services={activeServices}
        spaces={spaces}
        staff={activeStaff}
        defaultStaffId={defaultStaffId}
        timeZone={timeZone}
      />
    ) : null;

  // One toolbar shape for every view: primary action on the left, view
  // controls on the right (admin IA spec §2). `right` is the per-view slot
  // before the switcher (the week's Today link, the lens chip).
  const toolbar = (
    current: BookingsView,
    defaultStaffId: string,
    right: ReactNode = null,
    staffQuery?: string,
  ) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>{newBookingFor(defaultStaffId)}</div>
      <div className="flex items-center gap-2">
        {right}
        <ViewSwitcher current={current} showTimeline={showTimeline} staffQuery={staffQuery} />
      </div>
    </div>
  );

  if (rentals && view === "timeline") {
    // The timeline (a client component) is only pulled in when this branch
    // actually renders it.
    const { Timeline } = await import("@/features/rentals/components/timeline");
    const fromDate = validDate(params.from, timelineDefaultStart(today));
    const { offerings, blackouts, bookings } = await listTimelineData(fromDate, timeZone, TIMELINE_DAYS);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {welcome}
        {toolbar("timeline", activeStaff[0]?.id ?? "")}
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

  if (view === "list") {
    const { upcoming, past } = await listBookings();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        {welcome}
        {toolbar("list", activeStaff[0]?.id ?? "")}
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} staff={activeStaff} mode={eff} />
      </div>
    );
  }

  const weekStart = mondayOf(validDate(params.week, today));
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  // Availability is per staff (Team slice), so the week is drawn for the
  // selected people: one selected ⇒ exactly their hours (the solo org is
  // always this case); several ⇒ the union, where an open tile means
  // "someone is open".
  const selectedStaffIds = parseStaffParam(params.staff, activeStaff);
  // Only a real narrowing is a lens; the "everyone" week shows spaces too.
  const staffFilter =
    selectedStaffIds.length < activeStaff.length ? selectedStaffIds : undefined;
  const [rawBookings, exceptions, availability] = await Promise.all([
    // Fetched UNFILTERED and narrowed in memory (one org-week of rows) — that
    // is what yields the hidden-spaces count for the chip below.
    listConfirmedBookingsBetween(fromIso, toIso),
    selectedStaffIds.length > 0 ? listExceptionsBetween(weekStart, weekEnd, selectedStaffIds) : [],
    Promise.all(selectedStaffIds.map((id) => getAvailabilityAdmin(id, today))),
  ]);
  const { visible: bookings, hiddenSpaces } = applyStaffLens(rawBookings, staffFilter);
  // One person ⇒ their rows go straight through (so the grid's block/unblock
  // and "Reopen day" keep working off real exceptions). Several ⇒ each
  // person's day is resolved on its own and the results unioned
  // (unionWindows) — pooling everyone's rules AND exceptions into one call
  // would let one member's closed day empty the whole column, and one open
  // override replace everybody's hours. The union is handed to CalendarWeek
  // as a week of synthetic rules (one per date's weekday + window, overrides
  // already folded in, so no exceptions ride along): for seven consecutive
  // dates the weekday is unique, so effectiveWindows reads them back verbatim.
  const solo = selectedStaffIds.length === 1;
  const perStaff = selectedStaffIds.map((id, i) => ({
    rules: availability[i].rules,
    exceptions: exceptions.filter((e) => e.staffId === id),
  }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const rules = solo
    ? availability[0].rules
    : weekDays.flatMap((date) =>
        unionWindows(date, perStaff).map((w, i) => ({
          id: `union-${date}-${i}`,
          weekday: weekdayOf(date),
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      );
  const weekExceptions = solo ? exceptions : [];
  // The week arrows are plain links — they have to carry the lens with them.
  const staffQuery = staffFilter ? `staff=${staffFilter.join(",")}` : "";
  const staffSuffix = staffQuery ? `&${staffQuery}` : "";
  const todayHref = staffQuery ? `/bookings?${staffQuery}` : "/bookings";
  // The lens hides space bookings (a room is nobody's work) — say so, with
  // the way out, instead of silently dropping rows (spec §2, ruling 6).
  const hiddenChip =
    staffFilter && hiddenSpaces > 0 ? (
      <Link
        href={`/bookings?week=${weekStart}`}
        className="text-muted-foreground hover:text-foreground rounded-md border border-dashed px-2 py-1 text-xs"
      >
        {SPACES.hidden(hiddenSpaces)} · Show everyone
      </Link>
    ) : null;

  // A walk-in drawn on a one-person week belongs to that person; on the
  // "everyone" week it defaults to the first active member.
  const defaultStaffId = (selectedStaffIds.length === 1 ? selectedStaffIds[0] : activeStaff[0]?.id) ?? "";

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height
    // (week arrows live inside the grid header; see CalendarWeek).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {welcome}
      {toolbar(
        "week",
        defaultStaffId,
        <>
          {hiddenChip}
          <Link href={todayHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Today
          </Link>
        </>,
        staffQuery,
      )}
      <CalendarWeek
        weekStart={weekStart}
        timeZone={timeZone}
        staff={activeStaff}
        selectedStaffIds={selectedStaffIds}
        defaultStaffId={defaultStaffId}
        bookings={bookings}
        rules={rules}
        exceptions={weekExceptions}
        services={activeServices}
        spaces={spaces}
        prevHref={`/bookings?week=${addDaysISO(weekStart, -7)}${staffSuffix}`}
        nextHref={`/bookings?week=${addDaysISO(weekStart, 7)}${staffSuffix}`}
      />
    </div>
  );
}
