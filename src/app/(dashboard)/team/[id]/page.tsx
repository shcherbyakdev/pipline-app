import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar03Icon, PlusSignIcon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getAvailabilityAdmin, listServices } from "@/features/scheduling/queries";
import { getStaff, listStaffBookings } from "@/features/scheduling/staff-queries";
import type { DetailBookingRow } from "@/features/scheduling/detail-bookings";
import { MemberHeader } from "@/features/scheduling/components/member-header";
import { MemberServices } from "@/features/scheduling/components/member-services";
import { statusKey } from "@/features/scheduling/booking-label";
import { summarizeWeekly } from "@/features/scheduling/hours-summary";
import { ownerHref } from "@/features/scheduling/availability-owner";
import { whenLineFor } from "@/features/scheduling/templates";
import { CopyLinkButton } from "@/components/copy-link-button";
import { railLinkClass } from "@/components/shell/rail";
import { Badge } from "@/components/ui/badge";
import { loadPublicResources } from "@/lib/booking/public-offering";
import { bookingPath } from "@/lib/booking/url";
import { requireOrg } from "@/lib/auth/session";
import { gateHref } from "@/lib/billing/gate-href";
import { evaluateServiceGate } from "@/lib/billing/gates";
import { INTL_LOCALES } from "@/i18n/config";
import { env } from "@/env";
import { z } from "zod";

/* One person, laid out like the overview page (main column + rail). The
   header edits itself in place, services are pills, appointments follow;
   the rail carries the week's hours and the links out. No form on the page
   (user ruling 2026-09-03: clean). */
export default async function TeamMemberPage({ params }: PageProps<"/team/[id]">) {
  const { id } = await params;
  // Shape-guard before querying: a malformed id would surface as a Postgres
  // cast error (500), not the 404 it actually is (rentals/[id] idiom).
  if (!z.uuid().safeParse(id).success) notFound();
  const { org } = await requireOrg();
  const [staff, services, scheduling, resources, bookings, availability, serviceDoorHref, locale, t, tb, tCommon, tAvailability] =
    await Promise.all([
      getStaff(id),
      listServices(),
      getSchedulingSettings(),
      loadPublicResources(org.id),
      listStaffBookings(id),
      getAvailabilityAdmin(id),
      // The same gate the Services page asks before offering the form.
      gateHref(org.id, evaluateServiceGate),
      getLocale(),
      getTranslations("team"),
      getTranslations("bookings"),
      getTranslations("common"),
      getTranslations("availability"),
    ]);
  // RLS returns nothing for other orgs' people — the 404 we want.
  if (!staff || !scheduling) notFound();
  const timeZone = scheduling.timezone;
  const intlLocale = INTL_LOCALES[locale];

  // The roster row's rules, unchanged: a deactivated person's URL 404s and so
  // does one the plan keeps off the public roster (null = no cap applies).
  const isPublic = resources === null || resources.staff.some((s) => s.id === staff.id);
  const path = scheduling.handle && staff.active && isPublic ? bookingPath(scheduling.handle, staff.slug) : null;
  const overPlanLimit = staff.active && !isPublic;

  // A render helper, not a component: it closes over the page's translators
  // and zone, and the lint rule (static-components) is right that a component
  // made per render would remount its subtree.
  const bookingsList = (title: string, rows: DetailBookingRow[], empty: string) => (
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
                    { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: false },
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
          <Link href="/team" className="text-muted-foreground w-fit text-xs hover:underline">
            {t("detail.back")}
          </Link>
          <MemberHeader
            staff={staff}
            handle={scheduling.handle}
            badges={
              <>
                {staff.sortOrder === 0 ? (
                  <Badge variant="secondary">{t("owner")}</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">{t("member")}</span>
                )}
                {!staff.active ? <Badge variant="outline">{tCommon("inactive")}</Badge> : null}
                {overPlanLimit ? (
                  <Badge variant="destructive" title={t("overLimitTitle")}>
                    {t("overLimit")}
                    <span className="sr-only">{t("overLimitSr")}</span>
                  </Badge>
                ) : null}
              </>
            }
          >
          </MemberHeader>
        </div>

        <section aria-labelledby="member-services" className="flex flex-col gap-3">
          <h2 id="member-services" className="text-sm font-medium">
            {t("form.services")}
          </h2>
          <MemberServices staffId={staff.id} serviceIds={staff.serviceIds} services={services} />
        </section>

        <section aria-labelledby="member-appointments" className="flex flex-col gap-4">
          <h2 id="member-appointments" className="text-sm font-medium">
            {t("detail.appointments")}
          </h2>
          {bookingsList(t("detail.upcoming"), bookings.upcoming, t("detail.noUpcoming"))}
          {bookingsList(t("detail.recent"), bookings.recent, t("detail.noRecent"))}
        </section>
      </div>

      {/* The overview page's rail: on lg it sits beside the column, below
          that it follows it — everything here must stay reachable on a phone. */}
      <aside className="flex w-full shrink-0 flex-col gap-8 lg:w-44 lg:pt-1">
        {/* Hours are edited on /availability (admin IA spec §3); this only
            summarises the weekly rules, like the space detail page. */}
        <section className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-medium text-muted-foreground">{t("detail.hours")}</h2>
          <p className="text-[13px]">{summarizeWeekly(availability.rules, tAvailability)}</p>
          {/* /availability lists ACTIVE people only, so a deactivated one
              would silently land on someone else's hours — say so instead. */}
          {staff.active ? (
            <Link
              href={ownerHref({ kind: "staff", id: staff.id })}
              className="text-muted-foreground hover:text-foreground w-fit text-xs hover:underline"
            >
              {t("detail.editHours")}
            </Link>
          ) : (
            <p className="text-muted-foreground text-xs">{t("detail.reactivateToEdit")}</p>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("detail.quickActions")}</h2>
          {path ? <CopyLinkButton url={`${env.NEXT_PUBLIC_APP_URL}${path}`} name={staff.name} rail /> : null}
          {/* The Services page's own create form, here, for this person
              alone (`?staff=`) — so only while they are bookable (a service
              nobody can be booked for is not a service). A capped org gets
              the door. */}
          {staff.active ? (
            <Link href={serviceDoorHref ?? `/services/new?staff=${staff.id}`} className={railLinkClass}>
              <HugeiconsIcon icon={PlusSignIcon} size={14} className="text-subtle shrink-0" />
              {t("detail.addService")}
            </Link>
          ) : null}
          {path ? (
            <Link href={`/embed?staff=${staff.slug}`} className={railLinkClass}>
              <HugeiconsIcon icon={SourceCodeIcon} size={14} className="text-subtle shrink-0" />
              {t("detail.embed")}
            </Link>
          ) : null}
          {staff.active ? (
            <Link href={`/bookings?show=staff:${staff.id}`} className={railLinkClass}>
              <HugeiconsIcon icon={Calendar03Icon} size={14} className="text-subtle shrink-0" />
              {t("detail.calendar")}
            </Link>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
