import Link from "next/link";
import { getAvailabilityAdmin, getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { SPACES } from "@/features/orgs/vocab";
import { availabilityOwnerOf, resolveOwner } from "@/features/scheduling/availability-owner";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";
import { OwnerTabs } from "@/features/scheduling/components/owner-tabs";
import { dateInZone } from "@/features/scheduling/slots";

/* One Availability page for people AND hourly spaces (admin IA spec §3,
   ruling 4). Nightly/daily spaces have no weekly hours — their check-in and
   check-out times live on the space — so they are never an owner here, and
   a nights/days-only org gets an explanation instead of a redirect. */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; space?: string }>;
}) {
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const eff = effectiveMode(flags, modeOf(org));

  // People are owners only where the org sells appointments: every org has
  // a staff row (0041 backfill), but a spaces-only org's is not bookable
  // and must not surface here as hours to set.
  const [params, people, spaceRows, settings] = await Promise.all([
    searchParams,
    eff.offersAppointments ? listActiveStaff() : Promise.resolve([]),
    eff.offersRentals ? listOfferings() : Promise.resolve([]),
    getSchedulingSettings(),
  ]);
  const timezone = settings?.timezone ?? "UTC";
  const activeSpaces = spaceRows.filter((o) => o.active);
  const hourlySpaces = activeSpaces.filter((o) => o.rangeMode === "hours");
  const hasRangeSpaces = activeSpaces.some((o) => o.rangeMode !== "hours");

  // Whose hours are on screen — see resolveOwner for the fallback order.
  const owner = resolveOwner(params, people, hourlySpaces);

  if (!owner) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        {eff.offersAppointments ? (
          <p className="text-muted-foreground text-sm">
            Nobody on the team is active right now.{" "}
            <Link href="/team" className="hover:text-foreground underline underline-offset-3">
              Reactivate someone
            </Link>{" "}
            to set hours.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {SPACES.hoursNightsOnly}{" "}
            <Link href="/rentals" className="hover:text-foreground underline underline-offset-3">
              Open {SPACES.nav} →
            </Link>
          </p>
        )}
      </div>
    );
  }

  // Org-local today: override dates live in the org's timezone, so "still
  // upcoming" has to be judged there, not in UTC.
  const today = dateInZone(new Date(), timezone);
  const { rules, exceptions } =
    owner.kind === "staff"
      ? await getAvailabilityAdmin(owner.id, today)
      : await getOfferingAvailabilityAdmin(owner.id, today);
  const editorOwner = availabilityOwnerOf(owner);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Times are shown in {timezone} ·{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Change on Booking page
          </Link>
        </p>
        {owner.kind === "space" && hasRangeSpaces ? (
          <p className="text-muted-foreground text-sm">{SPACES.hoursNote}</p>
        ) : null}
        {/* Solo rule: one owner in total ⇒ no switcher (OwnerTabs renders
            nothing) and the page is identical to the pre-team one. */}
        <OwnerTabs people={people} spaces={hourlySpaces} current={owner} />
      </div>
      <WeeklyHours owner={editorOwner} rules={rules} />
      <DateOverrides owner={editorOwner} timeZone={timezone} rules={rules} exceptions={exceptions} />
    </div>
  );
}
