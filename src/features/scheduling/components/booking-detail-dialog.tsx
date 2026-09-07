"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  acceptBookingRequest,
  cancelBookingAdmin,
  markBookingPaid,
  resendManageLink,
} from "@/features/scheduling/booking-actions";
import { isExpiredRequest } from "@/features/scheduling/requests";
import { holdLabel, isLiveHold } from "@/features/scheduling/hold-label";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { INTL_LOCALES } from "@/i18n/config";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { DeclineRequestDialog } from "./requests-inbox";
import { MoveRentalDialog } from "@/features/rentals/components/move-rental-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  dialogPanelClass,
} from "@/components/ui/dialog";

// `Date.now()` is impure and react-hooks/purity forbids it during render;
// `useState(fn)` runs the initialiser once at mount, which is fine — and the
// body below is keyed on the booking id, so "mount" is "this booking was
// opened". (This dialog never server-renders open, so no hydration concern.)
const nowMs = () => Date.now();

export function BookingDetailDialog({
  booking,
  timeZone,
  staff,
  open,
  onOpenChange,
}: {
  booking: AdminBooking | null;
  timeZone: string;
  // Team (multi-staff): the org's ACTIVE members, with their service links.
  // One of them (the solo case) ⇒ nothing here names anybody.
  staff: StaffRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!booking) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the default sm panel: its footer carries three actions,
          and in a language with long words for them (Ukrainian's "Надіслати
          посилання знову") they ran past a 384px panel — which the popup's
          overflow-y turned into a horizontal scrollbar. Same width as the
          New-booking dialog. */}
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-xl")}>
        <DetailBody
          key={booking.id}
          booking={booking}
          timeZone={timeZone}
          staff={staff}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  booking,
  timeZone,
  staff,
  onClose,
}: {
  booking: AdminBooking;
  timeZone: string;
  staff: StaffRow[];
  onClose: () => void;
}) {
  const t = useTranslations("bookings");
  const tSpaces = useTranslations("spaces");
  const tAppointments = useTranslations("appointments");
  const intlLocale = INTL_LOCALES[useLocale()];
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [now] = React.useState(nowMs);
  // Past this point the booking is history: nothing to cancel or move (the
  // actions refuse it too — this just stops offering what can't happen).
  const ended = new Date(booking.endsAt).getTime() < now;
  const started = new Date(booking.startsAt).getTime() <= now;
  // A request the owner can still answer vs one that lapsed unanswered — the
  // RPCs draw the same line (0063), so nothing offers a click they'd refuse.
  const expiredRequest = isExpiredRequest(booking, new Date(now));
  const liveRequest = booking.status === "pending" && !expiredRequest;
  // S2: a hold reserves the slot until it is paid for. Live means the
  // deadline is still ahead — only then can it be marked paid; a lapsed one
  // is waiting on the drain and can still be cancelled by hand.
  const hold = booking.status === "pending_payment";
  const liveHold = isLiveHold(booking, new Date(now));
  const paidLine =
    booking.paidCents > 0 && booking.currency
      ? booking.priceCents !== null && booking.priceCents > booking.paidCents
        ? t("hold.paidBalance", {
            paid: formatMoney(booking.paidCents, booking.currency),
            balance: formatMoney(booking.priceCents - booking.paidCents, booking.currency),
          })
        : t("hold.paid", { paid: formatMoney(booking.paidCents, booking.currency) })
      : null;
  const refundLine =
    booking.refundedCents > 0 && booking.currency
      ? t("hold.refunded", { amount: formatMoney(booking.refundedCents, booking.currency) })
      : null;
  // What a cancel would send back. Offered pre-ticked (S2 ruling 3: the
  // default is a full refund) and only when there is money left to return.
  const refundable =
    booking.paidCents > booking.refundedCents && booking.currency
      ? formatMoney(booking.paidCents - booking.refundedCents, booking.currency)
      : null;
  const [refund, setRefund] = React.useState(true);

  const accept = () =>
    startTransition(async () => {
      const result = await acceptBookingRequest({ id: booking.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.emailed ? t("requests.acceptedEmailed") : t("requests.accepted"));
      onClose();
    });

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id, refund });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail) toast.success(t("cancel.doneNoEmail"));
      else if (result.emailed) toast.success(t("cancel.doneEmailed"));
      else toast.warning(t("cancel.doneEmailFailed"));
      // The cancel itself succeeded either way — a refund that didn't go
      // through is finished by hand in Stripe.
      if (result.ok && result.refundFailed) toast.warning(t("cancel.refundFailed"));
      onClose();
    });

  const markPaid = () =>
    startTransition(async () => {
      const result = await markBookingPaid({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("markPaid.done"));
      onClose();
    });

  const resend = () =>
    startTransition(async () => {
      const result = await resendManageLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      // Neutral wording: this handler serves both a booking and a request.
      else if (result.emailed) toast.success(t("resend.sent"));
      else toast.warning(t("resend.failed"));
    });

  const resendBlocked = !booking.clientEmail || started;
  const resendHint = !booking.clientEmail
    ? t("noEmailShort")
    : started
      ? t("resendStartedHint")
      : undefined;

  // Cancelling sits apart from the actions that keep the booking alive:
  // pushed to the far end of the bar and wearing the destructive tone, so the
  // one irreversible thing here never reads as a peer of Reschedule or Mark
  // as paid. Confirm and Keep travel with it (ml-auto on the pair, not on
  // each) so the row does not reflow when the confirm opens. Shared by the
  // hold footer and the general one — a hold's cancel refunds and emails
  // just like a booking's, so it asks the same second time.
  const cancelControl = confirming ? (
    <span className="flex items-center gap-2 sm:ml-auto">
      {refundable === null ? null : (
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={refund}
            onCheckedChange={(checked) => setRefund(checked === true)}
            disabled={pending}
          />
          {t("cancel.refund", { amount: refundable })}
        </label>
      )}
      <Button variant="destructive" size="sm" onClick={cancel} disabled={pending}>
        {t("cancel.confirm")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        {t("keep")}
      </Button>
    </span>
  ) : (
    <Button
      variant="destructive"
      size="sm"
      className="sm:ml-auto"
      onClick={() => setConfirming(true)}
      disabled={pending}
    >
      {t("cancel.button")}
    </Button>
  );

  const isRental = booking.rentalUnitId !== null;
  const contact = [booking.clientName, booking.clientEmail ?? t("noEmailShort"), booking.note ? `“${booking.note}”` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <DialogBreadcrumbHeader
        chip={
          <DialogChip tone={isRental ? "space" : "time"}>
            {isRental ? tSpaces("badge") : tAppointments("badge")}
          </DialogChip>
        }
      >
        {booking.serviceName}
      </DialogBreadcrumbHeader>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-6">
        <DialogDescription>
          {whenLineFor(
            {
              startsAt: new Date(booking.startsAt),
              endsAt: new Date(booking.endsAt),
              isRental,
              rangeMode: booking.rangeMode,
            },
            timeZone,
            intlLocale,
          )}
        </DialogDescription>
        {staff.length > 1 && booking.staffName ? (
          <p className="flex items-center gap-1.5 text-sm">
            <span
              aria-hidden
              style={{
                background: booking.staffColor ?? "var(--muted-foreground)",
              }}
              className="size-2 shrink-0 rounded-full"
            />
            {booking.staffName}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">{contact}</p>
        {paidLine ? <p className="text-sm">{paidLine}</p> : null}
        {refundLine ? <p className="text-sm">{refundLine}</p> : null}
        {hold ? (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t("status.pendingPayment")}</Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              {liveHold ? holdLabel(booking, timeZone, intlLocale, t) : t("hold.lapsed")}
            </p>
          </>
        ) : liveRequest ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{t("status.pending")}</Badge>
          </div>
        ) : expiredRequest ? (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t("requestExpired")}</Badge>
            </div>
            <p className="text-muted-foreground text-xs">{t("requests.lapsed")}</p>
          </>
        ) : ended ? (
          <p className="text-muted-foreground text-xs">{t("ended")}</p>
        ) : null}
      </div>
      {/* Only the actions branch on status — everything above is the same
          booking whatever state it is in. */}
      {hold ? (
        <DialogFooterBar className="sm:justify-start">
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
          {/* Only a LIVE hold can be marked paid — past the deadline the RPC
              refuses it, and the drain is about to release the slot. */}
          {liveHold ? (
            <Button variant="outline" size="sm" onClick={markPaid} disabled={pending}>
              {t("markPaid.button")}
            </Button>
          ) : null}
          {cancelControl}
        </DialogFooterBar>
      ) : liveRequest ? (
        <DialogFooterBar>
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeclining(true)}
            disabled={pending}
          >
            {t("requests.decline")}
          </Button>
          <Button variant="brand" size="sm" onClick={accept} disabled={pending}>
            {t("requests.accept")}
          </Button>
        </DialogFooterBar>
      ) : expiredRequest || ended ? null : (
        <DialogFooterBar className="sm:justify-start">
          {/* An appointment moves on the slot grid; a stay moves on the
              range calendar (R2) — the two pickers share nothing. */}
          {booking.serviceId === null ? null : (
            <BookingRescheduleDialog
              booking={{ ...booking, serviceId: booking.serviceId }}
              timeZone={timeZone}
              eligibleStaff={staff.filter((s) =>
                s.serviceIds.includes(booking.serviceId!),
              )}
            />
          )}
          {booking.rentalUnitId === null ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMoveOpen(true)}
            >
              {t("move.button")}
            </Button>
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
          {cancelControl}
        </DialogFooterBar>
      )}
      {/* Nested inside the popup: Base UI's own nested-dialog shape, so
          focus and dismissal stack instead of fighting each other. It owns
          the action, the toast and the refresh — this one just closes. */}
      {liveRequest ? (
        <DeclineRequestDialog
          bookingId={booking.id}
          open={declining}
          onOpenChange={setDeclining}
          onDeclined={onClose}
        />
      ) : null}
      {booking.rentalUnitId === null || ended ? null : (
        <MoveRentalDialog
          booking={booking}
          timeZone={timeZone}
          open={moveOpen}
          onOpenChange={setMoveOpen}
          // The move writes a new booking row; this one is stale the
          // moment it succeeds, so the detail dialog goes with it.
          onMoved={onClose}
        />
      )}
    </>
  );
}
