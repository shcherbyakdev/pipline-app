import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import {
  getOffering,
  listOfferings,
  listOfferingBookings,
  listUnitsWithBlackouts,
  type OfferingBookingRow,
} from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { headlinePrice } from "@/features/rentals/pricing";
import { OfferingForm } from "@/features/rentals/components/offering-form";
import { SpaceHeader } from "@/features/rentals/components/space-header";
import { DeleteSpaceButton } from "@/features/rentals/components/delete-space-button";
import { SpaceActiveSwitch } from "@/features/rentals/components/space-active-switch";
import { UnitsEditor } from "@/features/rentals/components/units-editor";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/copy-link-button";
import { getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { summarizeWeekly } from "@/features/scheduling/hours-summary";
import { ownerHref } from "@/features/scheduling/availability-owner";
import { statusKey } from "@/features/scheduling/booking-label";
import { whenLineFor } from "@/features/scheduling/templates";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { bookingLink } from "@/lib/booking/url";
import { railLinkClass } from "@/components/shell/rail";
import { INTL_LOCALES } from "@/i18n/config";
import { env } from "@/env";

/* One space, laid out like a team member's page (main column + rail): the
   header edits itself in place (name, description, on/off), then the
   settings as three closed rows (one Save — its fields validate together),
   then the dates it can't be booked (and units, once split), then bookings.
   The rail carries the week's hours (hourly spaces) and the ways out,
   delete included. */
export default async function RentalDetailPage({ params }: PageProps<"/rentals/[id]">) {
  const { id } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (same idiom as programs/[id]/units/[unitId]).
  if (!z.uuid().safeParse(id).success) notFound();

  // One round of reads; only the hours summary waits on the space itself.
  const offeringP = getOffering(id);
  const [offering, offerings, units, settings, bookings, availability, locale, t, tu, tb, tAvailability] =
    await Promise.all([
      offeringP,
      // S6: the rooms a composite can include — hourly plain spaces, never
      // this one (no nesting, and a studio can't include itself).
      listOfferings(),
      listUnitsWithBlackouts(id),
      getSchedulingSettings(),
      listOfferingBookings(id),
      // U3 (ruling 4): hours are edited on /availability; this page only
      // summarises the weekly rules (hourly spaces have them; nights/days
      // spaces use check-in/out times instead).
      offeringP.then((o) => (o?.rangeMode === "hours" ? getOfferingAvailabilityAdmin(id) : null)),
      getLocale(),
      getTranslations("spaces"),
      getTranslations("public.units"),
      getTranslations("bookings"),
      getTranslations("availability"),
    ]);
  // RLS hides other orgs' rows — indistinguishable from a nonexistent id,
  // which is exactly the 404 we want.
  if (!offering) notFound();
  const hourly = offering.rangeMode === "hours";
  const timeZone = settings?.timezone ?? "UTC";
  const currency = settings?.currency ?? "PLN";
  const intlLocale = INTL_LOCALES[locale];
  const schedule = hourly
    ? t("schedule.hours", {
        min: formatDurationLabel(offering.minDurationMin!, tu),
        max: formatDurationLabel(offering.maxDurationMin!, tu),
        step: offering.slotIncrementMin!,
      })
    : t(`schedule.${offering.rangeMode}`, { start: offering.startTime!, end: offering.endTime! });
  const price = headlinePrice(offering, currency, tu);
  // The list row's rule: a public link only for an active space, once the
  // org has a handle.
  const url =
    settings?.handle && offering.active
      ? bookingLink(env.NEXT_PUBLIC_APP_URL, settings.handle, { space: offering.id })
      : null;

  // A render helper, not a component: it closes over the page's translators
  // and zone, and the static-components lint rule is right that a component
  // made per render would remount its subtree.
  const bookingsList = (title: string, rows: OfferingBookingRow[], empty: string) => (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((b) => {
            const key = statusKey(b.status);
            return (
              <li key={b.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate">
                    <span className="font-medium">{b.title}</span>
                    <span className="text-muted-foreground"> · {b.clientName}</span>
                  </p>
                  <Badge variant="secondary">{key ? tb(`status.${key}`) : b.status}</Badge>
                </div>
                <p>
                  {whenLineFor(
                    { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: true, rangeMode: b.rangeMode },
                    timeZone,
                    intlLocale,
                  )}
                </p>
                {b.note ? <p className="text-muted-foreground">{t("detail.note", { note: b.note })}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:flex-row lg:gap-12">
      <div className="flex min-w-0 flex-1 flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
            {t("back")}
          </Link>
          <SpaceHeader
            offering={offering}
            meta={[schedule, price].filter(Boolean).join(" · ")}
            badges={
              <>
                <Badge variant="outline">{t(`mode.${offering.rangeMode}`)}</Badge>
                {offering.active && offering.activeUnitCount === 0 ? (
                  <Badge variant="outline">{t("notBookable")}</Badge>
                ) : null}
                {offering.kind === "composite" ? (
                  <Badge variant="outline">
                    {t("chip.includes", { count: offering.componentIds.length })}
                  </Badge>
                ) : null}
                {offering.kind === "equipment" ? <Badge variant="outline">{t("chip.addon")}</Badge> : null}
                <SpaceActiveSwitch id={offering.id} active={offering.active} />
              </>
            }
          >
            {url ? <CopyLinkButton url={url} name={offering.name} /> : null}
          </SpaceHeader>
        </div>

        <section aria-labelledby="space-settings" className="flex flex-col gap-2">
          <h2 id="space-settings" className="text-sm font-medium">
            {t("detail.settings")}
          </h2>
          <OfferingForm
            offering={offering}
            currency={currency}
            rooms={offerings
              .filter((o) => o.id !== offering.id && o.rangeMode === "hours" && o.kind === "space")
              .map(({ id: roomId, name }) => ({ id: roomId, name }))}
          />
        </section>

        {/* S6: a composite IS one unit — it holds every room it includes, so
            there is nothing here to split or black out on its own. */}
        {offering.kind === "composite" ? null : (
          <UnitsEditor offeringId={offering.id} units={units} />
        )}

        <section aria-labelledby="space-bookings" className="flex flex-col gap-4">
          <h2 id="space-bookings" className="text-sm font-medium">
            {t("detail.bookings")}
          </h2>
          {bookingsList(t("detail.upcoming"), bookings.upcoming, t("detail.noUpcoming"))}
          {bookingsList(t("detail.recent"), bookings.recent, t("detail.noRecent"))}
        </section>
      </div>

      {/* The overview page's rail: beside the column on lg, after it below. */}
      <aside className="flex w-full shrink-0 flex-col gap-8 lg:w-44 lg:pt-1">
        {availability ? (
          <section className="flex flex-col gap-1.5">
            <h2 className="text-[13px] font-medium text-muted-foreground">{t("detail.openingHours")}</h2>
            <p className="text-[13px]">{summarizeWeekly(availability.rules, tAvailability)}</p>
            {/* /availability lists ACTIVE hourly spaces only, so an inactive
                one would silently land on another owner's hours — say so
                instead of linking. */}
            {offering.active ? (
              <Link
                href={ownerHref({ kind: "space", id: offering.id })}
                className="text-muted-foreground hover:text-foreground w-fit text-xs hover:underline"
              >
                {t("detail.editHours")}
              </Link>
            ) : (
              <p className="text-muted-foreground text-xs">{t("detail.reactivateToEdit")}</p>
            )}
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("detail.quickActions")}</h2>
          {url ? (
            <Link href={`/embed?space=${offering.id}`} className={railLinkClass}>
              <HugeiconsIcon icon={SourceCodeIcon} size={14} className="text-subtle shrink-0" />
              {t("detail.embed")}
            </Link>
          ) : null}
          {offering.active ? (
            <Link href={`/bookings?view=timeline&show=space:${offering.id}`} className={railLinkClass}>
              <HugeiconsIcon icon={Calendar03Icon} size={14} className="text-subtle shrink-0" />
              {t("detail.timeline")}
            </Link>
          ) : null}
          <DeleteSpaceButton id={offering.id} name={offering.name} className={railLinkClass} />
        </section>
      </aside>
    </div>
  );
}
