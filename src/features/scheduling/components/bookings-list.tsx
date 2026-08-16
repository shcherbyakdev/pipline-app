"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatWhenLine } from "@/features/scheduling/templates";
import { cancelBookingAdmin, resendManageLink } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};

function Row({
  booking,
  timeZone,
  actionable,
}: {
  booking: AdminBooking;
  timeZone: string;
  actionable: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail)
        toast.success("Booking cancelled — no email on file for this client.");
      else if (result.emailed) toast.success("Booking cancelled — the client has been emailed");
      else
        toast.warning(
          "Booking cancelled — but the email to the client failed. Contact them directly.",
        );
      setConfirming(false);
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
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{booking.serviceName}</p>
        {actionable ? null : (
          <Badge variant="secondary">{STATUS_LABEL[booking.status] ?? booking.status}</Badge>
        )}
      </div>
      <p>{formatWhenLine(new Date(booking.startsAt), timeZone)}</p>
      <p className="text-muted-foreground">
        {booking.clientName}
        {booking.clientEmail ? ` · ${booking.clientEmail}` : ""}
        {booking.note ? ` · “${booking.note}”` : null}
      </p>
      {actionable ? (
        <div className="flex items-center gap-2">
          <BookingRescheduleDialog booking={booking} timeZone={timeZone} />
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
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
                Confirm cancel
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
              Cancel booking
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
}: {
  upcoming: AdminBooking[];
  past: AdminBooking[];
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming bookings. Share your booking page to fill the calendar.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row key={b.id} booking={b} timeZone={timeZone} actionable />
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Past &amp; cancelled</h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {past.map((b) => (
              <Row key={b.id} booking={b} timeZone={timeZone} actionable={false} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
