import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingLocale, getOrgLocale, resolveClientStaffName } from "@/lib/booking/public";
import { whenLineFor } from "@/features/scheduling/templates";
import { ManageBooking } from "@/features/scheduling/components/manage-booking";
import { moneyInfoLines } from "@/features/rentals/pricing";
import { INTL_LOCALES } from "@/i18n/config";
import { publicLocale } from "@/i18n/public";
import { PublicIntl } from "@/i18n/public-provider";
import { PublicLanguageLinks } from "@/i18n/public-language-links";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getOrgBranding } from "@/lib/org-branding";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { BOOK_COLUMN_CLASS, bookShellClass } from "@/lib/book-shell";
import { H2 } from "@/features/booking-page/render/type";

// The client's page for one booking, in the same world as the page they
// booked on: the org's page theme on the same shell (ground and column),
// the booking as lines under the org's name — no card.
const COLUMN = cn(BOOK_COLUMN_CLASS, "max-w-md gap-6");
const PANEL = "flex flex-col gap-5";

// Booking statuses → `public.manage.status.*` keys; anything unknown shows
// its raw status rather than a blank line.
const STATUS_KEY = {
  confirmed: "confirmed",
  pending: "pending",
  declined: "declined",
  cancelled_by_client: "cancelledByClient",
  cancelled_by_provider: "cancelledByProvider",
  rescheduled: "rescheduled",
} as const;

export default async function BookingManagePage({ params, searchParams }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  const sp = await searchParams;
  if (result.status === "rate_limited") {
    // No org yet: `?lang=` and the region still decide, then English.
    const t = await getTranslations({ locale: await publicLocale(null, sp), namespace: "public.manage" });
    return (
      <div className={bookShellClass("auto")}>
        <main className={COLUMN}>
          <div className={PANEL}>
            <p className="text-muted-foreground text-sm">{t("tooManyRequests")}</p>
          </div>
        </main>
      </div>
    );
  }
  if (result.status !== "ok") notFound();
  const b = result.booking;
  // The language the client booked in (0072) — the page a confirmation mail
  // links to reads like the mail. Falling back to the org for every row
  // written before the column existed and for admin-made bookings; `?lang=`
  // and the visitor's region still win, as everywhere public (spec §4).
  const locale = await publicLocale((await getBookingLocale(b.id)) ?? (await getOrgLocale(b.orgId)), sp);
  setRequestLocale(locale);
  const [t, tUnits, tConfirmed] = await Promise.all([
    getTranslations("public.manage"),
    getTranslations("public.units"),
    getTranslations("public.confirmed"),
  ]);
  // Team: name the staff member the booking belongs to. Solo orgs collapse to
  // null, so the card reads exactly as it did before the team slice.
  const staffName = await resolveClientStaffName(b.orgId, b.staffName);
  // H3: money lines (total/deposit/cancel-window) for the booking card.
  const infoLines = moneyInfoLines(
    {
      totalCents: b.priceCents,
      depositCents: b.depositCents,
      currency: b.currency,
      cancelWindowMin: b.cancelWindowMin ?? 0,
    },
    tUnits,
  );
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isInFuture = b.startsAt.getTime() > now;
  // H3: appointments (rentalUnitId null) and offerings with no cancel window
  // are always cancellable — the gate only bites a rental past its
  // free-cancellation deadline (the RPC's cancel_booking is the backstop).
  const canCancel =
    b.rentalUnitId === null ||
    !b.cancelWindowMin ||
    now <= b.startsAt.getTime() - b.cancelWindowMin * 60_000;
  const statusKey = (STATUS_KEY as Partial<Record<string, (typeof STATUS_KEY)[keyof typeof STATUS_KEY]>>)[b.status];
  // The org's page theme (light / dark / auto), as the hosted page reads it.
  const theme = parseWidgetTheme((await getOrgBranding(b.orgId)).pageThemeRaw);
  return (
    <PublicIntl locale={locale} timeZone={b.orgTimezone}>
    <div className={bookShellClass(theme.theme)}>
    <main className={COLUMN}>
      <div className={PANEL}>
      <h1 className={H2}>{b.orgName}</h1>
      <div className="flex flex-col gap-1 border-b pb-5 text-sm">
        <p className="font-medium">{b.serviceName}</p>
        {staffName ? <p className="text-muted-foreground">{tConfirmed("with", { name: staffName })}</p> : null}
        <p className="tabular-nums">
          {whenLineFor(
            {
              startsAt: b.startsAt,
              endsAt: b.endsAt,
              isRental: b.rentalUnitId !== null,
              rangeMode: b.rangeMode,
            },
            b.orgTimezone,
            INTL_LOCALES[locale],
          )}
        </p>
        {infoLines.map((l) => (
          <p key={l} className="text-muted-foreground">
            {l}
          </p>
        ))}
        <p className="text-muted-foreground">
          {b.status === "pending" && !isInFuture
            ? t("status.expired")
            : statusKey
              ? t(`status.${statusKey}`)
              : b.status}
        </p>
        {b.status === "declined" && b.declineNote ? (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">{t("quotedNote", { note: b.declineNote })}</p>
        ) : null}
      </div>
      {b.status === "confirmed" ? (
        <>
          <a className={cn(buttonVariants({ variant: "outline" }), "h-9 self-start px-3.5")} href={`/booking/${token}/calendar.ics`}>
            {tConfirmed("addToCalendar")}
          </a>
          {isInFuture ? (
            <ManageBooking
              token={token}
              timeZone={b.orgTimezone}
              // Rentals R2: a stay reschedules through its own range picker
              // (reschedule_rental_booking), an appointment through the slot
              // grid — both are self-serve.
              canReschedule={true}
              canCancel={canCancel}
              kind={b.rentalUnitId === null ? "appointment" : "rental"}
              rangeMode={b.rangeMode}
            />
          ) : (
            <p className="text-muted-foreground text-xs">{t("alreadyStarted")}</p>
          )}
        </>
      ) : null}
      {b.status === "pending" && isInFuture ? (
        <>
          <p className="text-muted-foreground text-sm">{t("awaiting", { orgName: b.orgName })}</p>
          <ManageBooking
            token={token}
            timeZone={b.orgTimezone}
            canReschedule={false}
            canCancel={true}
            kind={b.rentalUnitId === null ? "appointment" : "rental"}
            rangeMode={b.rangeMode}
            request
          />
        </>
      ) : null}
      </div>
      <PublicLanguageLinks locale={locale} />
    </main>
    </div>
    </PublicIntl>
  );
}
