import type { ReactNode } from "react";
import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
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
import { TIMELINE_DAYS, timelineDefaultStart } from "@/features/rentals/timeline-geometry";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { ViewSwitcher } from "@/features/scheduling/components/view-switcher";
import { ScopeMenu } from "@/features/scheduling/components/scope-menu";
import {
  applyScope,
  parseScope,
  scopeHoursOwners,
  scopeItems,
  scopeLabel,
  scopeQuery,
  scopeSides,
  scopedSpace,
} from "@/features/scheduling/bookings-scope";
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
  searchParams: Promise<{
    view?: string;
    week?: string;
    from?: string;
    show?: string;
    staff?: string;
    welcome?: string;
  }>;
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
  // the roster is fetched unconditionally (every org has at least one
  // staff row — 0041 backfill + create_staff) and drives the week's
  // hours and the walk-in's staff picker even for rentals-only orgs.
  const [orgOfferings, services, activeStaff] = await Promise.all([
    rentals ? listOfferings() : Promise.resolve([]),
    eff.offersAppointments ? listServices() : Promise.resolve([]),
    listActiveStaff(),
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

  // What the page is looking at (bookings-scope.ts): one `?show=` param,
  // one grouped, multi-select selector. People are on the menu only when
  // the org sells appointments (every org has a backfilled staff row), and
  // the selector renders only when there is something to choose — the solo
  // rule, so a one-person org without spaces keeps the exact page it had.
  const people = eff.offersAppointments ? activeStaff : [];
  const scope = parseScope({ show: params.show, staff: params.staff }, people, spaces);
  const scopeGroups = scopeItems(people, spaces);
  const scopeQs = scopeQuery(scope, people, spaces);
  const sides = scopeSides(scope, people, spaces);
  const scopeMenu = scopeGroups ? (
    <ScopeMenu
      groups={scopeGroups}
      scope={scope}
      people={people.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      spaces={spaces.map((s) => ({ id: s.id, name: s.name, rangeMode: s.rangeMode }))}
      label={scopeLabel(scope, people, spaces)}
    />
  ) : null;
  // When only spaces show, their space is what New booking starts on —
  // toolbar and drag alike. The dialog still lists the whole catalogue:
  // scope sets the default, not the choice.
  const preferSpace = scopedSpace(scope, people, spaces);

  // Welcome checklist: three cheap reads, only on the one request that
  // carries ?welcome=1 (nothing is persisted — spec §4 ruling 8).
  let checklist: ChecklistItem[] = [];
  if (params.welcome === "1") {
    const [ownersWithHours, page] = await Promise.all([countHoursOwners(), getPageDraftState(org.id)]);
    checklist = setupChecklist({
      mode: eff,
      serviceCount: activeServices.length,
      spaceCount: spaces.length,
      hourlySpaceCount: spaces.filter((o) => o.rangeMode === "hours").length,
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

  // One toolbar shape for every view: primary action on the left, view
  // controls on the right (admin IA spec §2) — the scope selector, then
  // the per-view slot (`right`: the week's Today link), then the switcher.
  // The Timeline is spaces by nature: no selector, and its switcher links
  // carry no scope.
  const toolbar = (current: BookingsView, defaultStaffId: string, right: ReactNode = null) => {
    const scoped = current !== "timeline";
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>{newBookingFor(defaultStaffId)}</div>
        <div className="flex items-center gap-2">
          {scoped ? scopeMenu : null}
          {right}
          <ViewSwitcher
            current={current}
            showTimeline={showTimeline}
            scopeQuery={scoped ? scopeQs : undefined}
          />
        </div>
      </div>
    );
  };

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
        <BookingsList
          upcoming={applyScope(upcoming, scope)}
          past={applyScope(past, scope)}
          timeZone={timeZone}
          staff={activeStaff}
          mode={eff}
          // The "Space" badge tells kinds apart — only where there are two to tell.
          showKind={eff.offersAppointments && sides.people}
          scopeLabel={scope.kind === "all" ? null : scopeLabel(scope, people, spaces)}
        />
      </div>
    );
  }

  const weekStart = mondayOf(validDate(params.week, today));
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  // Availability is per owner — a person's (Team slice) or an hourly
  // space's (H2) — so the week is drawn for the scope's owners
  // (scopeHoursOwners): one ⇒ exactly their hours (the solo org is always
  // this case); several ⇒ the union, where an open tile means "someone is
  // open".
  const owners = scopeHoursOwners(scope, activeStaff, spaces);
  const [rawBookings, exceptions, availability] = await Promise.all([
    // Fetched UNFILTERED and narrowed in memory — one org-week of rows.
    listConfirmedBookingsBetween(fromIso, toIso),
    // Likewise every owner's overrides for the week, attributed per row.
    listExceptionsBetween(weekStart, weekEnd),
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
  // handed to CalendarWeek as a week of synthetic rules (one per date's
  // weekday + window, overrides already folded in, so no exceptions ride
  // along): for seven consecutive dates the weekday is unique, so
  // effectiveWindows reads them back verbatim.
  const soloStaffId = owners.length === 1 && owners[0].staffId !== undefined ? owners[0].staffId : null;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const rules =
    soloStaffId !== null
      ? availability[0].rules
      : weekDays.flatMap((date) =>
          unionWindows(date, perOwner).map((w, i) => ({
            id: `union-${date}-${i}`,
            weekday: weekdayOf(date),
            startTime: w.startTime,
            endTime: w.endTime,
          })),
        );
  const weekExceptions = soloStaffId !== null ? perOwner[0].exceptions : [];
  // Block / Unblock / Reopen are a person's actions: off the popover once
  // a space is on the week, even where that week falls back to drawing the
  // members' hours (a nights/days-only scope).
  const blockable = !sides.spaces || scope.kind === "all";
  // The week arrows and Today are plain links — they have to carry the scope.
  const scopeSuffix = scopeQs ? `&${scopeQs}` : "";
  const todayHref = scopeQs ? `/bookings?${scopeQs}` : "/bookings";

  // A walk-in drawn on a one-person week belongs to that person; on any
  // other week it defaults to the first active member.
  const defaultStaffId = (soloStaffId ?? activeStaff[0]?.id) ?? "";

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height
    // (week arrows live inside the grid header; see CalendarWeek).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {welcome}
      {toolbar(
        "week",
        defaultStaffId,
        <Link href={todayHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Today
        </Link>,
      )}
      <CalendarWeek
        weekStart={weekStart}
        timeZone={timeZone}
        staff={activeStaff}
        editStaffId={blockable ? soloStaffId : null}
        blockable={blockable}
        preferSpace={preferSpace?.id ?? null}
        defaultStaffId={defaultStaffId}
        bookings={bookings}
        rules={rules}
        exceptions={weekExceptions}
        services={activeServices}
        spaces={spaces}
        prevHref={`/bookings?week=${addDaysISO(weekStart, -7)}${scopeSuffix}`}
        nextHref={`/bookings?week=${addDaysISO(weekStart, 7)}${scopeSuffix}`}
      />
    </div>
  );
}
