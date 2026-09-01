"use client";

import * as React from "react";
import { toast } from "sonner";
import { whenLineFor, STATUS_LABEL } from "@/features/scheduling/templates";
import {
  acceptBookingRequest,
  cancelBookingAdmin,
  resendManageLink,
} from "@/features/scheduling/booking-actions";
import { isExpiredRequest } from "@/features/scheduling/requests";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { DeclineRequestDialog } from "./requests-inbox";
import { MoveRentalDialog } from "@/features/rentals/components/move-rental-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  dialogPanelClass,
} from "@/components/ui/dialog";

// Hint on the disabled "Resend link": rotate_booking_token (the RPC behind
// it) only accepts a booking that hasn't started, so the button says why
// rather than failing with the generic error.
export const RESEND_STARTED_HINT =
  "The appointment has already started — the link can't be reissued.";

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
      <DialogContent className={dialogPanelClass}>
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

  const accept = () =>
    startTransition(async () => {
      const result = await acceptBookingRequest({ id: booking.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.emailed ? "Accepted — confirmation sent." : "Accepted.",
      );
      onClose();
    });

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail)
        toast.success("Booking cancelled — no email on file for this client.");
      else if (result.emailed)
        toast.success("Booking cancelled — the client has been emailed");
      else
        toast.warning(
          "Booking cancelled — but the email to the client failed. Contact them directly.",
        );
      onClose();
    });

  const resend = () =>
    startTransition(async () => {
      const result = await resendManageLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      // Neutral wording: this handler serves both a booking and a request.
      else if (result.emailed)
        toast.success("A fresh link is on its way to the client.");
      else
        toast.warning(
          "Link was reset, but the email failed — the old link no longer works. Contact the client directly.",
        );
    });

  const resendBlocked = !booking.clientEmail || started;
  const resendHint = !booking.clientEmail
    ? "No email on file"
    : started
      ? RESEND_STARTED_HINT
      : undefined;

  const isRental = booking.rentalUnitId !== null;
  return (
    <>
      <DialogBreadcrumbHeader
        chip={
          <DialogChip tone={isRental ? "space" : "time"}>
            {isRental ? "Space" : "Appointment"}
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
        <p className="text-sm text-muted-foreground">
          {booking.clientName}
          {booking.clientEmail
            ? ` · ${booking.clientEmail}`
            : " · no email on file"}
          {booking.note ? ` · “${booking.note}”` : null}
        </p>
        {liveRequest ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{STATUS_LABEL.pending}</Badge>
          </div>
        ) : expiredRequest ? (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Request expired</Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              This request lapsed before it was answered.
            </p>
          </>
        ) : ended ? (
          <p className="text-muted-foreground text-xs">
            This appointment has ended.
          </p>
        ) : null}
      </div>
      {/* Only the actions branch on status — everything above is the same
          booking whatever state it is in. */}
      {liveRequest ? (
        <DialogFooterBar>
          <Button
            variant="ghost"
            size="sm"
            onClick={resend}
            disabled={pending || resendBlocked}
            focusableWhenDisabled={resendBlocked}
            title={resendHint}
          >
            Resend link
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeclining(true)}
            disabled={pending}
          >
            Decline…
          </Button>
          <Button variant="brand" size="sm" onClick={accept} disabled={pending}>
            Accept
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
              Move…
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
            Resend link
          </Button>
          {confirming ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={pending}
              >
                Confirm cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Cancel booking
            </Button>
          )}
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
