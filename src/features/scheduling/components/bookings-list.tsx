"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  acceptBookingRequest, cancelBookingAdmin, resendManageLink,
} from "@/features/scheduling/booking-actions";
import { isExpiredRequest } from "@/features/scheduling/requests";
import { statusKey } from "@/features/scheduling/booking-label";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OrgMode } from "@/features/orgs/mode";
import { INTL_LOCALES } from "@/i18n/config";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { DeclineRequestDialog } from "./requests-inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// These rows server-render, so "now" is seeded after mount (the
// booking forms' seeded-now idiom): a render-time Date.now() would both trip
// react-hooks/purity and risk a hydration mismatch. Until seeded, nothing is
// treated as started — the worst case is one click that the action refuses.
function useNowMs(): number | null {
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(seed);
  }, []);
  return nowMs;
}

function Row({
  booking,
  timeZone,
  staff,
  actionable,
  showKind,
}: {
  booking: AdminBooking;
  timeZone: string;
  staff: StaffRow[];
  actionable: boolean;
  showKind: boolean;
}) {
  const t = useTranslations("bookings");
  const tSpaces = useTranslations("spaces");
  const intlLocale = INTL_LOCALES[useLocale()];
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const nowMs = useNowMs();
  // Which side of the request line this row is on. The query already routes a
  // lapsed request to Past (`actionable` false), and `isExpiredRequest` covers
  // the gap between that server render and hydration — `nowMs` is seeded once
  // at mount and never ticks, so a request lapsing later keeps its buttons
  // until the next render; the RPCs refuse them, which is the safe direction.
  const lapsedRequest =
    booking.status === "pending" &&
    (!actionable || (nowMs !== null && isExpiredRequest(booking, new Date(nowMs))));
  const liveRequest = booking.status === "pending" && !lapsedRequest;
  // "Upcoming" is ends_at-based (a stay in progress still lists), but a
  // manage link can only be reissued before the start (rotate_booking_token).
  const started = nowMs !== null && new Date(booking.startsAt).getTime() <= nowMs;
  const resendBlocked = !booking.clientEmail || started;
  const resendHint = !booking.clientEmail ? t("noEmailShort") : started ? t("resendStartedHint") : undefined;
  const status = statusKey(booking.status);

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail) toast.success(t("cancel.doneNoEmail"));
      else if (result.emailed) toast.success(t("cancel.doneEmailed"));
      else toast.warning(t("cancel.doneEmailFailed"));
      setConfirming(false);
    });

  const accept = () =>
    startTransition(async () => {
      const result = await acceptBookingRequest({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(result.emailed ? t("requests.acceptedEmailed") : t("requests.accepted"));
    });

  const resend = () =>
    startTransition(async () => {
      const result = await resendManageLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.emailed) toast.success(t("resend.sent"));
      else toast.warning(t("resend.failed"));
    });

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {booking.serviceName}
          {showKind && booking.rentalUnitId !== null ? <Badge variant="outline">{tSpaces("badge")}</Badge> : null}
        </p>
        {liveRequest ? (
          <Badge variant="secondary">{t("status.pending")}</Badge>
        ) : lapsedRequest ? (
          // "Pending approval" would be a lie in the history list — this one
          // ran out of time.
          <Badge variant="secondary">{t("requestExpired")}</Badge>
        ) : actionable ? null : (
          <Badge variant="secondary">{status ? t(`status.${status}`) : booking.status}</Badge>
        )}
      </div>
      <p>
        {whenLineFor(
          {
            startsAt: new Date(booking.startsAt),
            endsAt: new Date(booking.endsAt),
            isRental: booking.rentalUnitId !== null,
            rangeMode: booking.rangeMode,
          },
          timeZone,
          intlLocale,
        )}
      </p>
      {/* Team (multi-staff): whose appointment this is. Solo orgs never see
          the line — there is only ever one answer. */}
      {staff.length > 1 && booking.staffName ? (
        <p className="flex items-center gap-1.5">
          <span
            aria-hidden
            style={{ background: booking.staffColor ?? "var(--muted-foreground)" }}
            className="size-2 shrink-0 rounded-full"
          />
          {booking.staffName}
        </p>
      ) : null}
      <p className="text-muted-foreground">
        {booking.clientName}
        {booking.clientEmail ? ` · ${booking.clientEmail}` : ""}
        {booking.note ? ` · “${booking.note}”` : null}
      </p>
      {/* A request is answered, not managed: the list keeps only Accept /
          Decline in place of the reschedule–resend–cancel row until it
          becomes a booking. (The detail dialog also offers Resend link —
          a request's link is reissuable too, it just isn't row work.) */}
      {liveRequest ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={accept} disabled={pending}>
            {t("requests.accept")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeclining(true)} disabled={pending}>
            {t("requests.decline")}
          </Button>
          <DeclineRequestDialog bookingId={booking.id} open={declining} onOpenChange={setDeclining} />
        </div>
      ) : actionable && !lapsedRequest ? (
        <div className="flex items-center gap-2">
          {/* Stays have no slot grid to move to — cancel/rebook instead. */}
          {booking.serviceId === null ? null : (
            <BookingRescheduleDialog
              booking={{ ...booking, serviceId: booking.serviceId }}
              timeZone={timeZone}
              eligibleStaff={staff.filter((s) => s.serviceIds.includes(booking.serviceId!))}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={resend}
            disabled={pending || resendBlocked}
            focusableWhenDisabled={resendBlocked}
            title={resendHint}
          >
            {t("resendLink")}
          </Button>
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
                {t("cancel.confirm")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                {t("keep")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
              {t("cancel.button")}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function BookingsList({
  upcoming,
  past,
  timeZone,
  staff,
  mode,
  showKind,
  scopeLabel,
}: {
  upcoming: AdminBooking[];
  past: AdminBooking[];
  timeZone: string;
  staff: StaffRow[]; // active members (Team slice); one ⇒ nothing changes
  mode: OrgMode;
  // The "Space" badge on rows — the page turns it off where every row is a
  // space anyway (a spaces-only scope, a rentals-only org).
  showKind: boolean;
  // What the rows were narrowed to (bookings-scope.ts): null for
  // everything, else the words the toolbar's trigger reads.
  scopeLabel: string | null;
}) {
  const t = useTranslations("bookings");
  const emptyKey = mode.offersAppointments ? "list.emptyServices" : mode.offersRentals ? "list.emptySpaces" : "list.empty";
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("list.upcoming")}</h2>
        {upcoming.length === 0 && scopeLabel !== null ? (
          <p className="text-muted-foreground text-sm">
            {t("list.emptyScoped", { scope: scopeLabel })}{" "}
            <Link href="/bookings?view=list" className="underline">
              {t("list.showAll")}
            </Link>
          </p>
        ) : upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t.rich(emptyKey, {
              services: (chunks) => <Link href="/services" className="underline">{chunks}</Link>,
              spaces: (chunks) => <Link href="/rentals" className="underline">{chunks}</Link>,
            })}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row
                key={b.id}
                booking={b}
                timeZone={timeZone}
                staff={staff}
                actionable
                showKind={showKind}
              />
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("list.past")}</h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {scopeLabel !== null ? t("list.pastEmptyScoped", { scope: scopeLabel }) : t("list.pastEmpty")}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {past.map((b) => (
              <Row
                key={b.id}
                booking={b}
                timeZone={timeZone}
                staff={staff}
                actionable={false}
                showKind={showKind}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
