"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatWhenLine } from "@/features/scheduling/templates";
import { cancelBookingAdmin } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
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
  const handleOpenChange = (next: boolean) => {
    if (!next) setConfirming(false);
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{booking.serviceName}</DialogTitle>
          <DialogDescription>{formatWhenLine(new Date(booking.startsAt), timeZone)}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {booking.clientName}
          {booking.clientEmail ? ` · ${booking.clientEmail}` : " · no email on file"}
          {booking.note ? ` · “${booking.note}”` : null}
        </p>
        <div className="flex items-center gap-2">
          <BookingRescheduleDialog booking={booking} timeZone={timeZone} />
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>Confirm cancel</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>Keep</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>Cancel booking</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
