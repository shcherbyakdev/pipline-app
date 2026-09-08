import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import {
  listCalendarBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
  getOfferingAvailabilityAdmin,
  countHoursOwners,
} from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listOfferings, listTimelineData } from "@/features/rentals/queries";
import { NewBookingButton } from "@/features/scheduling/components/new-booking-button";
import { canCreateWalkIn } from "@/features/scheduling/booking-kinds";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { defaultBookingsView, effectiveMode, modeOf } from "@/features/orgs/mode";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ZOOMS, parseDays, shiftDays, timelineStart, windowLabel } from "@/features/rentals/timeline-layout";
import { bufferWindow } from "@/features/rentals/pan";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/features/scheduling/components/staff-tabs";
import { CalendarGrid } from "@/features/scheduling/components/calendar-grid";
import { CalendarMonth } from "@/features/scheduling/components/calendar-month";
import { ViewSwitcher } from "@/features/scheduling/components/view-switcher";
import { ScopeMenu } from "@/features/scheduling/components/scope-menu";
import {
  applyScope,
  parseScope,
  scopeHoursOwners,
  scopeItems,
  scopeQuery,
  scopeSides,
  scopedSpace,
} from "@/features/scheduling/bookings-scope";
import type { BookingsView } from "@/features/scheduling/bookings-views";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { addMonths, monthGrid, monthStart } from "@/features/scheduling/month-grid";
import { unionWindows, weekdayOf } from "@/features/scheduling/day-windows";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { SETUP_DISMISSED_COOKIE, setupChecklist, showWelcome, type ChecklistItem } from "@/features/scheduling/setup-checklist";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { INTL_LOCALES } from "@/i18n/config";
import { WelcomeBanner } from "@/features/scheduling/components/welcome-banner";
import { PageActions } from "@/components/shell/page-actions";

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

function asView(param: string | undefined, fallback: BookingsView): BookingsView {
  return param === "day" || param === "week" || param === "month" || param === "timeline" ? param : fallback;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    week?: string;
    date?: string;
    month?: string;
    from?: string;
    days?: string;
    show?: string;
    staff?: string;
  }>;
}) {
  const [t, tRoot, locale, params, settings] = await Promise.all([
    getTranslations("bookings"),
    getTranslations(),
    getLocale(),
    searchParams,
    getSchedulingSettings(),
  ]);
  const timeZone = settings?.timezone ?? "UTC";
  const today = dateInZone(new Date(), timeZone);
  // Noon UTC pins the calendar date whatever the zone; the locale is the
  // admin's, pinned through INTL_LOCALES (never the runtime's default).
  const atNoon = (d: string) => new Date(`${d}T12:00:00Z`);
  const dayLabel = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const monthLabel = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    month: "long", year: "numeric", timeZone: "UTC",
  });
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const mode = modeOf(org);
  const eff = effectiveMode(flags, mode);
  const rentals = eff.offersRentals;

  // Fetched once, up front, for every view: the catalogue decides the
  // default view, the Timeline link and (Task 3) the New-booking picker;
  // the roster is fetched unconditionally (every org has at least one
  // staff row — 0041 backfill + create_staff) and drives the week's
  // hours and the walk-in's staff picker even for rentals-only orgs.
  const [orgOfferings, services, activeStaff] = await Promise.all([
    rentals ? listOfferings() : Promise.resolve([]),
    eff.offersAppointments ? listServices() : Promise.resolve([]),
    listActiveStaff(),
  ]);
  // S6: equipment is never booked on its own — it rides a room booking as an
  // add-on — so it is not one of the things this page offers to book, scope
  // or count. (Its units still draw lanes on the timeline, from its own read.)
  const spaces = orgOfferings.filter((o) => o.active && o.kind !== "equipment");
  const activeServices = services.filter((s) => s.active);
  const hasHourly = spaces.some((o) => o.rangeMode === "hours");
  const view = asView(params.view, rentals ? defaultBookingsView(eff, hasHourly) : "week");
  // The switcher's Timeline item makes sense once the org sells spaces and
  // has one to show — every space is a lane there now, hourly rooms
  // included. The branch itself still answers an explicit ?view=timeline
  // with the Timeline's own empty state.
  const showTimeline = rentals && spaces.length > 0;

  // What the page is looking at (bookings-scope.ts): one `?show=` param,
  // one grouped, multi-select selector. People are on the menu only when
  // the org sells appointments (every org has a backfilled staff row), and
  // the selector renders only when there is something to choose — the solo
  // rule, so a one-person org without spaces keeps the exact page it had.
  const people = eff.offersAppointments ? activeStaff : [];
  const scope = parseScope({ show: params.show, staff: params.staff }, people, spaces);
  const scopeGroups = scopeItems(people, spaces);
  const scopeQs = scopeQuery(scope, people, spaces);
  // Plain links (week arrows, Today, the timeline's window) carry the scope.
  const scopeSuffix = scopeQs ? `&${scopeQs}` : "";
  const sides = scopeSides(scope, people, spaces);
  const scopeMenu = scopeGroups ? (
    <ScopeMenu
      groups={scopeGroups}
      scope={scope}
      people={people.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      spaces={spaces.map((s) => ({ id: s.id, name: s.name, rangeMode: s.rangeMode }))}
    />
  ) : null;
  // When only spaces show, their space is what New booking starts on —
  // toolbar and drag alike. The dialog still lists the whole catalogue:
  // scope sets the default, not the choice.
  const preferSpace = scopedSpace(scope, people, spaces);

  // Welcome checklist: one cheap read on every load until the list is
  // done or the owner dismisses it (setup-checklist.ts showWelcome). It
  // used to ride ?welcome=1 and vanished on the first click — every chip
  // navigates away. Progress is still derived, never persisted (spec §4
  // ruling 8, amended); the dismissal is a cookie keyed by org id.
  const dismissed = (await cookies()).get(SETUP_DISMISSED_COOKIE)?.value === org.id;
  let checklist: ChecklistItem[] = [];
  if (!dismissed) {
    const ownersWithHours = await countHoursOwners();
    // Bookable = has an active unit: the measure the public page uses
    // (listPublicOfferings), so the chip cannot tick while /[handle] 404s.
    const bookableSpaceCount = spaces.filter((o) => o.activeUnitCount > 0).length;
    checklist = setupChecklist({
      mode: eff,
      serviceCount: activeServices.length,
      spaceCount: spaces.length,
      bookableSpaceCount,
      unitlessSpaceId: spaces.find((o) => o.activeUnitCount === 0)?.id ?? null,
      hourlySpaceCount: spaces.filter((o) => o.rangeMode === "hours").length,
      ownersWithHours,
    });
  }
  const handle = settings?.handle ?? null;
  const welcome = showWelcome({ dismissed, handle, checklist }) ? (
    <WelcomeBanner handle={handle} appUrl={env.NEXT_PUBLIC_APP_URL} mode={eff} checklist={checklist} />
  ) : null;

  // One entry for every kind of walk-in (spec §2, ruling 5). On the
  // "everyone" week a walk-in defaults to the first active member; the week
  // branch below overrides that for a one-person scope.
  const newBookingFor = (defaultStaffId: string) =>
    canCreateWalkIn(activeServices, spaces) ? (
      <NewBookingButton
        services={activeServices}
        spaces={spaces}
        staff={activeStaff}
        defaultStaffId={defaultStaffId}
        timeZone={timeZone}
        initial={preferSpace ? { kind: "space", offeringId: preferSpace.id } : undefined}
      />
    ) : null;

  // One toolbar shape for every view, Google Calendar's: TIME on the left
  // — Today, a pair of borderless arrows, then the window in words, the
  // only thing on the page that says which days these are; WHAT AND HOW on
  // the right — the scope lens, the per-view control (`extra`: the
  // timeline's zoom) and the switcher. New booking is a page action, so it
  // rides up into the top bar (PageActions) like every other page's create
  // CTA. Every view reads the scope; the timeline takes its spaces side and
  // ignores people.
  //
  // All three views wrap it in the SAME container (flex-1, full width, the
  // page's own `gap-4`), so switching view moves nothing but the body: the
  // List used to sit in a centred `max-w-2xl p-6` column, which slid the
  // whole toolbar sideways and down on every switch. The narrow measure is
  // the LIST's, not the page's — it stays on the list.
  const arrowClass = cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "text-muted-foreground");
  const dateNav = (o: {
    todayHref: string;
    prevHref: string;
    nextHref: string;
    prevLabel: string;
    nextLabel: string;
    label: string;
  }) => (
    <>
      <Link href={o.todayHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        {tRoot("common.today")}
      </Link>
      <Link href={o.prevHref} aria-label={o.prevLabel} className={arrowClass}>
        <ChevronLeft />
      </Link>
      <Link href={o.nextHref} aria-label={o.nextLabel} className={arrowClass}>
        <ChevronRight />
      </Link>
      <span className="ml-1.5 text-[15px] font-medium tabular-nums">{o.label}</span>
    </>
  );
  const toolbar = (
    current: BookingsView,
    defaultStaffId: string,
    nav: ReactNode = null,
    extra: ReactNode = null,
  ) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">{nav}</div>
      <div className="flex flex-wrap items-center gap-2">
        {scopeMenu}
        {extra}
        <ViewSwitcher current={current} showTimeline={showTimeline} scopeQuery={scopeQs} />
        <PageActions>{newBookingFor(defaultStaffId)}</PageActions>
      </div>
    </div>
  );

  if (rentals && view === "timeline") {
    // The timeline (a client component) is only pulled in when this branch
    // actually renders it.
    const { Timeline } = await import("@/features/rentals/components/timeline");
    const days = parseDays(params.days);
    const fromDate = validDate(params.from, timelineStart(today, days));
    // A window either side of the visible one rides along, so dragging the
    // chart always has real days under the hand (pan.ts bufferWindow).
    const { bufferFrom, cols } = bufferWindow(fromDate, days);
    const data = await listTimelineData(bufferFrom, timeZone, cols);
    // The scope's spaces side narrows the lanes. A people-only scope shows
    // every space — a timeline of nobody is no lens.
    const offerings =
      scope.kind === "some" && sides.spaces
        ? data.offerings.filter((o) => scope.spaces === "all" || scope.spaces.includes(o.id))
        : data.offerings;
    const unitIds = new Set(offerings.flatMap((o) => o.units.map((u) => u.id)));
    const blackouts = data.blackouts.filter((b) => unitIds.has(b.unitId));
    const bookings = data.bookings.filter((b) => b.rentalUnitId !== null && unitIds.has(b.rentalUnitId));
    // The default zoom writes no param, so the plain Timeline link stays clean.
    const zoomQs = (d: number) => (d === 28 ? "" : `&days=${d}`);
    const base = `/bookings?view=timeline${zoomQs(days)}${scopeSuffix}`;
    const shift = shiftDays(days);
    const nav = dateNav({
      todayHref: base,
      prevHref: `${base}&from=${addDaysISO(fromDate, -shift)}`,
      nextHref: `${base}&from=${addDaysISO(fromDate, shift)}`,
      prevLabel: t("timeline.back", { count: shift }),
      nextLabel: t("timeline.forward", { count: shift }),
      label: windowLabel(fromDate, days, INTL_LOCALES[locale]),
    });
    const zoom = (
      <nav aria-label={t("timeline.zoom")} className={SEGMENTED_NAV_CLASS}>
        {ZOOMS.map((z) => (
          <Link
            key={z}
            href={`/bookings?view=timeline${zoomQs(z)}${scopeSuffix}&from=${fromDate}`}
            aria-current={z === days ? "page" : undefined}
            className={segmentedItemClass(z === days)}
          >
            {t("timeline.weeks", { count: z / 7 })}
          </Link>
        ))}
      </nav>
    );
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {welcome}
        {toolbar("timeline", activeStaff[0]?.id ?? "", nav, zoom)}
        <Timeline
          fromDate={fromDate}
          bufferFrom={bufferFrom}
          days={days}
          timeZone={timeZone}
          offerings={offerings}
          blackouts={blackouts}
          bookings={bookings}
          scopeSuffix={scopeSuffix}
          hrefBase={base}
        />
      </div>
    );
  }

  if (view === "month") {
    // A month is for "how full is it": bookings only, no hours and no
    // availability reads. The fetch covers the whole GRID, so the leading
    // and trailing days of the neighbouring months are populated too.
    const first = monthStart(validDate(params.month, today));
    const grid = monthGrid(first);
    const last = grid[grid.length - 1];
    // Whose hours the month reads is the same question the week asks
    // (scopeHoursOwners): a day is CLOSED when nobody in the scope is open
    // on it — the union, so one person's day off never greys a day someone
    // else works. Overrides ride along, so a closed public holiday and a
    // one-off open Sunday both land.
    const monthOwners = scopeHoursOwners(scope, activeStaff, people, spaces);
    const [rawMonth, monthExceptions, monthAvailability] = await Promise.all([
      listCalendarBookingsBetween(
        wallTimeToUtc(grid[0], "00:00", timeZone).toISOString(),
        wallTimeToUtc(addDaysISO(last, 1), "00:00", timeZone).toISOString(),
      ),
      listExceptionsBetween(grid[0], last),
      Promise.all(
        monthOwners.map((o) =>
          o.staffId !== undefined
            ? getAvailabilityAdmin(o.staffId, today)
            : getOfferingAvailabilityAdmin(o.rentalOfferingId, today),
        ),
      ),
    ]);
    const monthPerOwner = monthOwners.map((o, i) => ({
      rules: monthAvailability[i].rules,
      exceptions: monthExceptions.filter((e) =>
        o.staffId !== undefined ? e.staffId === o.staffId : e.rentalOfferingId === o.rentalOfferingId,
      ),
    }));
    // The windows themselves, not just "closed or not": an empty list hatches
    // the cell, and a booking started from that cell carries the same list
    // the week grid's drag carries, so the outside-hours hint behaves the
    // same at both zoom levels.
    const monthWindows = Object.fromEntries(grid.map((d) => [d, unionWindows(d, monthPerOwner)]));
    const monthHref = (m: string) => `/bookings?view=month&month=${m}${scopeSuffix}`;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {welcome}
        {toolbar(
          "month",
          activeStaff[0]?.id ?? "",
          dateNav({
            todayHref: `/bookings?view=month${scopeSuffix}`,
            prevHref: monthHref(addMonths(first, -1)),
            nextHref: monthHref(addMonths(first, 1)),
            prevLabel: t("prevMonth"),
            nextLabel: t("nextMonth"),
            label: monthLabel.format(atNoon(first)),
          }),
        )}
        <CalendarMonth
          monthDate={first}
          today={today}
          timeZone={timeZone}
          bookings={applyScope(rawMonth, scope)}
          staff={activeStaff}
          services={activeServices}
          spaces={spaces}
          defaultStaffId={activeStaff[0]?.id ?? ""}
          preferSpace={preferSpace?.id ?? null}
          windowsByDate={monthWindows}
          scopeSuffix={scopeSuffix}
        />
      </div>
    );
  }

  // Day and Week are the same grid at two widths (CalendarGrid dayCount):
  // one column starting on the picked date, or seven starting on its Monday.
  // Everything below — the fetch window, the owners' hours, the union — is
  // written in terms of `dayCount`, so the Day view costs a narrower query,
  // not a second code path.
  const isDay = view === "day";
  const dayCount = isDay ? 1 : 7;
  const gridStart = isDay ? validDate(params.date, today) : mondayOf(validDate(params.week, today));
  const gridEnd = addDaysISO(gridStart, dayCount - 1);
  const fromIso = wallTimeToUtc(gridStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(gridStart, dayCount), "00:00", timeZone).toISOString();

  // Availability is per owner — a person's (Team slice) or an hourly
  // space's (H2) — so the week is drawn for the scope's owners
  // (scopeHoursOwners): one ⇒ exactly their hours (the solo org is always
  // this case); several ⇒ the union, where an open tile means "someone is
  // open".
  const owners = scopeHoursOwners(scope, activeStaff, people, spaces);
  const [rawBookings, exceptions, availability] = await Promise.all([
    // Fetched UNFILTERED and narrowed in memory — one org-window of rows.
    listCalendarBookingsBetween(fromIso, toIso),
    // Likewise every owner's overrides for the window, attributed per row.
    listExceptionsBetween(gridStart, gridEnd),
    Promise.all(
      owners.map((o) =>
        o.staffId !== undefined
          ? getAvailabilityAdmin(o.staffId, today)
          : getOfferingAvailabilityAdmin(o.rentalOfferingId, today),
      ),
    ),
  ]);
  const bookings = applyScope(rawBookings, scope);
  const perOwner = owners.map((o, i) => ({
    rules: availability[i].rules,
    exceptions: exceptions.filter((e) =>
      o.staffId !== undefined ? e.staffId === o.staffId : e.rentalOfferingId === o.rentalOfferingId,
    ),
  }));
  // One PERSON ⇒ their rows go straight through (so the grid's block/unblock
  // and "Reopen day" keep working off real exceptions). Anything else —
  // several people, or a space's hours — is resolved per owner and the
  // results unioned (unionWindows): pooling every owner's rules AND
  // exceptions into one call would let one closed day empty the whole
  // column, and one open override replace everybody's hours. The union is
  // handed to CalendarGrid as synthetic rules (one per date's weekday +
  // window, overrides already folded in, so no exceptions ride along):
  // across at most seven consecutive dates the weekday is unique, so
  // effectiveWindows reads them back verbatim.
  const soloStaffId = owners.length === 1 && owners[0].staffId !== undefined ? owners[0].staffId : null;
  const gridDays = Array.from({ length: dayCount }, (_, i) => addDaysISO(gridStart, i));
  const rules =
    soloStaffId !== null
      ? availability[0].rules
      : gridDays.flatMap((date) =>
          unionWindows(date, perOwner).map((w, i) => ({
            id: `union-${date}-${i}`,
            weekday: weekdayOf(date),
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        );
  const gridExceptions = soloStaffId !== null ? perOwner[0].exceptions : [];
  // Block / Unblock / Reopen are a person's actions: off the popover once
  // a space is on the week, even where that week falls back to drawing the
  // members' hours (a nights/days-only scope).
  const blockable = !sides.spaces || scope.kind === "all";

  // A walk-in drawn on a one-person week belongs to that person; on any
  // other week it defaults to the first active member.
  const defaultStaffId = (soloStaffId ?? activeStaff[0]?.id) ?? "";

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {welcome}
      {toolbar(
        view,
        defaultStaffId,
        dateNav(
          isDay
            ? {
                todayHref: `/bookings?view=day${scopeSuffix}`,
                prevHref: `/bookings?view=day&date=${addDaysISO(gridStart, -1)}${scopeSuffix}`,
                nextHref: `/bookings?view=day&date=${addDaysISO(gridStart, 1)}${scopeSuffix}`,
                prevLabel: t("prevDay"),
                nextLabel: t("nextDay"),
                label: dayLabel.format(atNoon(gridStart)),
              }
            : {
                todayHref: scopeQs ? `/bookings?${scopeQs}` : "/bookings",
                prevHref: `/bookings?week=${addDaysISO(gridStart, -7)}${scopeSuffix}`,
                nextHref: `/bookings?week=${addDaysISO(gridStart, 7)}${scopeSuffix}`,
                prevLabel: t("prevWeek"),
                nextLabel: t("nextWeek"),
                // The timeline's window label, over the week's seven days.
                label: windowLabel(gridStart, 7, INTL_LOCALES[locale]),
              },
        ),
      )}
      <CalendarGrid
        startDate={gridStart}
        dayCount={dayCount}
        timeZone={timeZone}
        scopeSuffix={scopeSuffix}
        staff={activeStaff}
        editStaffId={blockable ? soloStaffId : null}
        blockable={blockable}
        preferSpace={preferSpace?.id ?? null}
        defaultStaffId={defaultStaffId}
        bookings={bookings}
        rules={rules}
        exceptions={gridExceptions}
        services={activeServices}
        spaces={spaces}
      />
    </div>
  );
}
