import { statusKey } from "@/features/scheduling/booking-label";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, listClientBookings } from "@/features/clients/queries";
import { ClientHeader } from "@/features/clients/components/client-header";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { whenLineFor } from "@/features/scheduling/templates";
import { requireOrg } from "@/lib/auth/session";
import { INTL_LOCALES } from "@/i18n/config";
import { Badge } from "@/components/ui/badge";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Booking statuses → `bookings.status.*` keys; anything unknown shows its
// raw status rather than a blank badge (booking/[token]/page.tsx idiom).
export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  // Shape-guard before querying: a malformed id would surface as a Postgres
  // cast error (500), not the 404 it actually is.
  if (!UUID_RE.test(id)) notFound();
  const [client, bookings, settings, { org }, t, tb, ts, locale] = await Promise.all([
    getClient(id),
    listClientBookings(id),
    getSchedulingSettings(),
    requireOrg(),
    getTranslations("clients"),
    getTranslations("bookings"),
    getTranslations("spaces"),
    getLocale(),
  ]);
  // RLS returns nothing for foreign orgs' clients — the 404 we want.
  if (!client) notFound();
  const timeZone = settings?.timezone ?? "UTC";
  const intlLocale = INTL_LOCALES[locale];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        {/* Same wayfinding as the space detail page ("← Spaces"). */}
        <Link href="/clients" className="text-muted-foreground w-fit text-sm hover:underline">
          {t("detail.back")}
        </Link>
        <ClientHeader id={client.id} name={client.name} />
        {client.email ? (
          <a
            href={`mailto:${client.email}`}
            className="text-muted-foreground hover:text-foreground w-fit px-3 text-sm hover:underline"
          >
            {client.email}
          </a>
        ) : (
          <p className="text-muted-foreground px-3 text-sm">{t("detail.noEmail")}</p>
        )}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {bookings.length === 100
            ? t("detail.bookingsLast", { count: 100 })
            : t("detail.bookings", { count: bookings.length })}
        </h2>
        {bookings.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("detail.noBookings")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {bookings.map((b) => {
              const key = statusKey(b.status);
              return (
                <li key={b.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-medium">
                      {b.serviceName}
                      {org.offersAppointments && b.rentalUnitId !== null ? (
                        <Badge variant="outline">{ts("badge")}</Badge>
                      ) : null}
                    </p>
                    <Badge variant="secondary">{key ? tb(`status.${key}`) : b.status}</Badge>
                  </div>
                  <p>
                    {whenLineFor(
                      {
                        startsAt: new Date(b.startsAt),
                        endsAt: new Date(b.endsAt),
                        isRental: b.rentalUnitId !== null,
                        rangeMode: b.rangeMode,
                      },
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
      </section>
    </div>
  );
}
