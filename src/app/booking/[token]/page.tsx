import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { getBookingLocale, getOrgLegal, getOrgLocale, resolveClientStaffName } from "@/lib/booking/public";
import { formatUntil, whenLineFor } from "@/features/scheduling/templates";
import { ManageBooking } from "@/features/scheduling/components/manage-booking";
import { moneyInfoLines } from "@/features/rentals/pricing";
import { cancelFeePct } from "@/features/rentals/cancel-policy";
import { formatMoney } from "@/lib/money";
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
import { LegalFooter } from "@/features/booking-page/render/legal-footer";

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
  pending_payment: "pendingPayment",
  declined: "declined",
  cancelled_by_client: "cancelledByClient",
  cancelled_by_provider: "cancelledByProvider",
  rescheduled: "rescheduled",
  expired: "expired",
} as const;

// Nobody is turning up for these: the money lines drop their "at the venue"
// half (moneyInfoLines' `settled`).
const DEAD_STATUSES = new Set(["expired", "cancelled_by_client", "cancelled_by_provider", "declined", "rescheduled"]);

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
  // H3: money lines (total/deposit/fee/policy) for the booking card.
  // S1: `lines` is the quote the RPC snapshotted — the breakdown the client
  // saw at checkout, printed above the total.
  const infoLines = moneyInfoLines(
    {
      totalCents: b.priceCents,
      depositCents: b.depositCents,
      currency: b.currency,
      cancelPolicy: b.cancelPolicy,
      feeCents: b.feeCents,
      lines: b.lines,
      paidCents: b.paidCents,
      refundedCents: b.refundedCents,
      holding: b.status === "pending_payment",
      // S2: a dead row (a lapsed hold, a cancel, a decline) still shows what
      // was paid and refunded, but never asks for money at the venue.
      settled: DEAD_STATUSES.has(b.status),
    },
    tUnits,
  );
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const isInFuture = b.startsAt.getTime() > now;
  // S3: the consequence of cancelling right now, for the confirm step. Only
  // a confirmed, priced rental has one; the RPC recomputes it on the write.
  // `b.feeCents` is whatever an earlier reschedule already cost — money the
  // studio keeps regardless — so this tier's fee is on top of it, and the
  // refund estimate subtracts both.
  const feePct = b.rentalUnitId !== null && b.status === "confirmed" ? cancelFeePct(b.cancelPolicy, b.startsAt, new Date(now)) : 0;
  const tierFeeCents = b.priceCents !== null ? Math.round((b.priceCents * feePct) / 100) : 0;
  const refundCents = Math.max(0, b.paidCents - b.refundedCents - b.feeCents - tierFeeCents);
  const cancelLines: string[] = [];
  if (b.currency && tierFeeCents > 0) cancelLines.push(tUnits("cancelFeeNow", { amount: formatMoney(tierFeeCents, b.currency), pct: feePct }));
  if (b.currency && refundCents > 0 && b.status === "confirmed") cancelLines.push(tUnits("willRefund", { amount: formatMoney(refundCents, b.currency) }));
  const statusKey = (STATUS_KEY as Partial<Record<string, (typeof STATUS_KEY)[keyof typeof STATUS_KEY]>>)[b.status];
  // Checkout redirects back with `?paid=`/`?pay=` (the pay route) — first
  // value if Next hands back an array for a repeated key.
  const paidParam = Array.isArray(sp.paid) ? sp.paid[0] : sp.paid;
  const payParam = Array.isArray(sp.pay) ? sp.pay[0] : sp.pay;
  // The org's page theme (light / dark / auto), as the hosted page reads it.
  const theme = parseWidgetTheme((await getOrgBranding(b.orgId)).pageThemeRaw);
  return (
    <PublicIntl locale={locale} timeZone={b.orgTimezone}>
    <div className={bookShellClass(theme.theme)}>
    <main className={COLUMN}>
      <div className={PANEL}>
      <h1 className={H2}>{b.orgName}</h1>
      {paidParam === "1" && b.status === "confirmed" ? <p className="text-sm">{t("paymentReceived")}</p> : null}
      {paidParam === "1" && b.status === "pending_payment" ? <p className="text-sm">{t("paymentProcessing")}</p> : null}
      {payParam === "failed" ? <p className="text-destructive text-sm">{t("paymentFailed")}</p> : null}
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
            ? t("status.requestExpired")
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
              cancelLines={cancelLines}
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
            kind={b.rentalUnitId === null ? "appointment" : "rental"}
            rangeMode={b.rangeMode}
            request
          />
        </>
      ) : null}
      {b.status === "pending_payment" && isInFuture ? (
        <>
          <p className="text-muted-foreground text-sm">
            {b.holdExpiresAt && b.holdExpiresAt.getTime() > now
              ? t("reservedUntil", { until: formatUntil(b.holdExpiresAt, b.orgTimezone, INTL_LOCALES[locale]) })
              : t("holdLapsed")}
          </p>
          {b.holdExpiresAt && b.holdExpiresAt.getTime() > now ? (
            <a className={cn(buttonVariants({ variant: "brand" }), "h-9 self-start px-3.5")} href={`/booking/${token}/pay?lang=${locale}`}>
              {b.depositCents !== null && b.currency ? tConfirmed("pay", { amount: formatMoney(b.depositCents, b.currency) }) : tConfirmed("pay", { amount: "" })}
            </a>
          ) : null}
          <ManageBooking token={token} timeZone={b.orgTimezone} canReschedule={false} kind="rental" rangeMode={b.rangeMode} request />
        </>
      ) : null}
      {b.status === "expired" ? <p className="text-muted-foreground text-sm">{t("expiredBody")}</p> : null}
      </div>
      <PublicLanguageLinks locale={locale} />
      <LegalFooter legal={await getOrgLegal(b.orgId)} />
    </main>
    </div>
    </PublicIntl>
  );
}
