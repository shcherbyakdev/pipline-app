import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { getAvailabilityAdmin, getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { availabilityOwnerOf, resolveOwner } from "@/features/scheduling/availability-owner";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";
import { OwnerTabs } from "@/features/scheduling/components/owner-tabs";
import { dateInZone } from "@/features/scheduling/slots";

/* One Availability page for people AND hourly spaces (admin IA spec §3,
   ruling 4). Nightly/daily spaces have no weekly hours — their check-in and
   check-out times live on the space — so they are never an owner here, and
   a nights/days-only org gets an explanation instead of a redirect. A
   `?staff=`/`?space=` naming a deactivated or foreign owner is shape-valid
   but unresolved: resolveOwner falls through to the first available owner
   silently, by design — never a 404. */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; space?: string }>;
}) {
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const eff = effectiveMode(flags, modeOf(org));
  const t = await getTranslations("availability");
  const tSpaces = await getTranslations("spaces");

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
            {t.rich("noActive", {
              link: (chunks) => (
                <Link href="/team" className="hover:text-foreground underline underline-offset-3">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tSpaces("hoursNightsOnly")}{" "}
            {eff.offersRentals ? (
              <Link href="/rentals" className="hover:text-foreground underline underline-offset-3">
                {t("openSpaces")}
              </Link>
            ) : null}
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
          {t.rich("timezoneNote", {
            timezone,
            link: (chunks) => (
              <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
        {owner.kind === "space" && hasRangeSpaces ? (
          <p className="text-muted-foreground text-sm">{tSpaces("hoursNote")}</p>
        ) : null}
        {/* Solo rule: one owner in total ⇒ no switcher (OwnerTabs renders
            nothing) and the page is identical to the pre-team one — except a
            sole space still needs naming (a sole person is "you"). */}
        {owner.kind === "space" && people.length + hourlySpaces.length < 2 ? (
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <HugeiconsIcon icon={House01Icon} size={14} className="shrink-0" aria-hidden />
            {owner.name}
          </h2>
        ) : (
          <OwnerTabs people={people} spaces={hourlySpaces} current={owner} />
        )}
      </div>
      <WeeklyHours owner={editorOwner} rules={rules} />
      <DateOverrides owner={editorOwner} timeZone={timezone} rules={rules} exceptions={exceptions} />
    </div>
  );
}
