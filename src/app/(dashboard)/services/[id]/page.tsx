import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { ChevronRight } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SourceCodeIcon } from "@hugeicons/core-free-icons";
import { getService, listServiceBookings } from "@/features/scheduling/queries";
import type { DetailBookingRow } from "@/features/scheduling/detail-bookings";
import { listStaff } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { ServiceForm } from "@/features/scheduling/components/service-form";
import { ServiceHeader } from "@/features/scheduling/components/service-header";
import { ServiceStaff } from "@/features/scheduling/components/service-staff";
import { DeleteServiceButton } from "@/features/scheduling/components/delete-service-button";
import { statusKey } from "@/features/scheduling/booking-label";
import { whenLineFor } from "@/features/scheduling/templates";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/copy-link-button";
import { railLinkClass } from "@/components/shell/rail";
import { bookableAdminServices } from "@/lib/booking/bookable";
import { bookingLink } from "@/lib/booking/url";
import { INTL_LOCALES } from "@/i18n/config";
import { env } from "@/env";

/* One service, laid out like a space's page (main column + rail): the header
   edits itself in place, then who offers it, then the settings — folded away
   behind their own heading, since the header already says the duration and
   price — then the appointments booked for it. The rail carries the ways out,
   delete included. */
export default async function ServiceDetailPage({ params }: PageProps<"/services/[id]">) {
  const { id } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (the rentals/[id] idiom).
  if (!z.uuid().safeParse(id).success) notFound();

  const [service, staff, settings, bookings, locale, t, tCommon, tUnits, tb] = await Promise.all([
    getService(id),
    listStaff(),
    getSchedulingSettings(),
    listServiceBookings(id),
    getLocale(),
    getTranslations("services"),
    getTranslations("common"),
    getTranslations("public.units"),
    getTranslations("bookings"),
  ]);
  // RLS hides other orgs' rows — indistinguishable from a nonexistent id,
  // which is exactly the 404 we want.
  if (!service) notFound();
  const timeZone = settings?.timezone ?? "UTC";
  const intlLocale = INTL_LOCALES[locale];
  // The list row's rule: a public link only for a service a client can
  // actually book — active, offered by an active person — once the org has a
  // handle. An unlinked one would just degrade to the org flow.
  const bookable = bookableAdminServices([service], staff).length > 0;
  const url =
    settings?.handle && bookable
      ? bookingLink(env.NEXT_PUBLIC_APP_URL, settings.handle, { service: service.id })
      : null;
  const meta = [tUnits("minutes", { count: service.durationMin }), service.priceLabel]
    .filter(Boolean)
    .join(" · ");

  // A render helper, not a component: it closes over the page's translators
  // and zone, and the static-components lint rule is right that a component
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
                  {/* Every row is this service, so the client is the news. */}
                  <p className="min-w-0 truncate font-medium">{b.clientName}</p>
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
          <Link href="/services" className="text-muted-foreground w-fit text-xs hover:underline">
            {t("back")}
          </Link>
          <ServiceHeader
            service={service}
            meta={meta}
            badges={
              <>
                {!service.active ? <Badge variant="outline">{tCommon("inactive")}</Badge> : null}
                {service.active && !bookable ? <Badge variant="outline">{t("notBookable")}</Badge> : null}
              </>
            }
          >
            {url ? <CopyLinkButton url={url} name={service.name} /> : null}
          </ServiceHeader>
        </div>

        <section aria-labelledby="service-team" className="flex flex-col gap-3">
          <h2 id="service-team" className="text-sm font-medium">
            {t("detail.team")}
          </h2>
          {/* Solo rule: one person on the roster means there is nothing to
              choose — say so rather than offer a checklist of one. */}
          {staff.length < 2 ? (
            <p className="text-muted-foreground text-sm">{t("detail.teamSolo")}</p>
          ) : (
            <ServiceStaff serviceId={service.id} staffIds={service.staffIds} staff={staff} />
          )}
        </section>

        {/* The page's long tail: the header already says the duration and
            price, so the rest opens on demand. Native <details> (the space
            form's idiom): the closed fields stay in the DOM, so FormData is
            unaffected, and the open state survives the revalidation a save
            triggers because nothing here remounts. */}
        <details className="group flex flex-col gap-4">
          <summary className="group/summary focus-visible:ring-ring/30 -mx-1 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 outline-none select-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="text-subtle group-hover/summary:text-foreground size-3.5 transition-[transform,color] group-open:rotate-90" />
            <h2 className="text-sm font-medium">{t("detail.settings")}</h2>
          </summary>
          <ServiceForm service={service} />
        </details>

        <section aria-labelledby="service-appointments" className="flex flex-col gap-4">
          <h2 id="service-appointments" className="text-sm font-medium">
            {t("detail.appointments")}
          </h2>
          {bookingsList(t("detail.upcoming"), bookings.upcoming, t("detail.noUpcoming"))}
          {bookingsList(t("detail.recent"), bookings.recent, t("detail.noRecent"))}
        </section>
      </div>

      {/* The overview page's rail: beside the column on lg, after it below. */}
      <aside className="flex w-full shrink-0 flex-col gap-8 lg:w-44 lg:pt-1">
        <section className="flex flex-col gap-1">
          <h2 className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("detail.quickActions")}</h2>
          {url ? (
            <Link href="/embed" className={railLinkClass}>
              <HugeiconsIcon icon={SourceCodeIcon} size={14} className="text-subtle shrink-0" />
              {t("detail.embed")}
            </Link>
          ) : null}
          <DeleteServiceButton id={service.id} name={service.name} className={railLinkClass} />
        </section>
      </aside>
    </div>
  );
}
