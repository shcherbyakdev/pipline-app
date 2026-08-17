"use client";

import * as React from "react";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import { cancelBookingAdmin, resendManageLink } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { MoveRentalDialog } from "@/features/rentals/components/move-rental-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function BookingDetailDialog({
  booking, timeZone, open, onOpenChange,
}: {
  booking: AdminBooking | null;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirming(false);
      setMoveOpen(false);
    }
    onOpenChange(next);
  };
  if (!booking) return null;

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail) toast.success("Booking cancelled — no email on file for this client.");
      else if (result.emailed) toast.success("Booking cancelled — the client has been emailed");
      else toast.warning("Booking cancelled — but the email to the client failed. Contact them directly.");
      handleOpenChange(false);
    });

  const resend = () =>
    startTransition(async () => {
      const result = await resendManageLink({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.emailed) toast.success("A fresh booking link is on its way to the client.");
      else
        toast.warning(
          "Link was reset, but the email failed — the old link no longer works. Contact the client directly.",
        );
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{booking.serviceName}</DialogTitle>
          <DialogDescription>
            {whenLineFor(
              {
                startsAt: new Date(booking.startsAt),
                endsAt: new Date(booking.endsAt),
                isRental: booking.rentalUnitId !== null,
              },
              timeZone,
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {booking.clientName}
          {booking.clientEmail ? ` · ${booking.clientEmail}` : " · no email on file"}
          {booking.note ? ` · “${booking.note}”` : null}
        </p>
        <div className="flex items-center gap-2">
          {/* An appointment moves on the slot grid; a stay moves on the
              range calendar (R2) — the two pickers share nothing. */}
          {booking.serviceId === null ? null : (
            <BookingRescheduleDialog
              booking={{ ...booking, serviceId: booking.serviceId }}
              timeZone={timeZone}
            />
          )}
          {booking.rentalUnitId === null ? null : (
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
              Move…
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={resend}
            disabled={pending || !booking.clientEmail}
            focusableWhenDisabled={!booking.clientEmail}
            title={booking.clientEmail ? undefined : "No email on file"}
          >
            Resend link
          </Button>
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>Confirm cancel</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>Keep</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>Cancel booking</Button>
          )}
        </div>
        {/* Nested inside the popup: Base UI's own nested-dialog shape, so
            focus and dismissal stack instead of fighting each other. */}
        {booking.rentalUnitId === null ? null : (
          <MoveRentalDialog
            booking={booking}
            timeZone={timeZone}
            open={moveOpen}
            onOpenChange={setMoveOpen}
            // The move writes a new booking row; this one is stale the
            // moment it succeeds, so the detail dialog goes with it.
            onMoved={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
