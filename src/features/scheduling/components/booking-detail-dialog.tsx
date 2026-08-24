"use client";

import * as React from "react";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import { cancelBookingAdmin, resendManageLink } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { MoveRentalDialog } from "@/features/rentals/components/move-rental-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

// Hint on the disabled "Resend link": rotate_booking_token (the RPC behind
// it) only accepts a booking that hasn't started, so the button says why
// rather than failing with the generic error.
export const RESEND_STARTED_HINT = "The appointment has already started — the link can't be reissued.";

// `Date.now()` is impure and react-hooks/purity forbids it during render;
// `useState(fn)` runs the initialiser once at mount, which is fine — and the
// body below is keyed on the booking id, so "mount" is "this booking was
// opened". (This dialog never server-renders open, so no hydration concern.)
const nowMs = () => Date.now();

export function BookingDetailDialog({
  booking, timeZone, staff, open, onOpenChange,
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
      <DialogContent>
        <DetailBody key={booking.id} booking={booking} timeZone={timeZone} staff={staff} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  booking, timeZone, staff, onClose,
}: {
  booking: AdminBooking;
  timeZone: string;
  staff: StaffRow[];
  onClose: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [now] = React.useState(nowMs);
  // Past this point the booking is history: nothing to cancel or move (the
  // actions refuse it too — this just stops offering what can't happen).
  const ended = new Date(booking.endsAt).getTime() < now;
  const started = new Date(booking.startsAt).getTime() <= now;

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail) toast.success("Booking cancelled — no email on file for this client.");
      else if (result.emailed) toast.success("Booking cancelled — the client has been emailed");
      else toast.warning("Booking cancelled — but the email to the client failed. Contact them directly.");
      onClose();
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

  const resendBlocked = !booking.clientEmail || started;
  const resendHint = !booking.clientEmail ? "No email on file" : started ? RESEND_STARTED_HINT : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{booking.serviceName}</DialogTitle>
        <DialogDescription>
          {whenLineFor(
            {
              startsAt: new Date(booking.startsAt),
              endsAt: new Date(booking.endsAt),
              isRental: booking.rentalUnitId !== null,
              rangeMode: booking.rangeMode,
            },
            timeZone,
          )}
        </DialogDescription>
      </DialogHeader>
      {staff.length > 1 && booking.staffName ? (
        <p className="flex items-center gap-1.5 text-sm">
          <span
            aria-hidden
            style={{ background: booking.staffColor ?? "var(--muted-foreground)" }}
            className="size-2 shrink-0 rounded-full"
          />
          {booking.staffName}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {booking.clientName}
        {booking.clientEmail ? ` · ${booking.clientEmail}` : " · no email on file"}
        {booking.note ? ` · “${booking.note}”` : null}
      </p>
      {ended ? (
        <p className="text-muted-foreground text-xs">This appointment has ended.</p>
      ) : (
        <div className="flex items-center gap-2">
          {/* An appointment moves on the slot grid; a stay moves on the
              range calendar (R2) — the two pickers share nothing. */}
          {booking.serviceId === null ? null : (
            <BookingRescheduleDialog
              booking={{ ...booking, serviceId: booking.serviceId }}
              timeZone={timeZone}
              eligibleStaff={staff.filter((s) => s.serviceIds.includes(booking.serviceId!))}
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
            disabled={pending || resendBlocked}
            focusableWhenDisabled={resendBlocked}
            title={resendHint}
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
      )}
      {/* Nested inside the popup: Base UI's own nested-dialog shape, so
          focus and dismissal stack instead of fighting each other. */}
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
