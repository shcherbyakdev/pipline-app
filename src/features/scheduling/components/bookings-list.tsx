"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { whenLineFor, STATUS_LABEL } from "@/features/scheduling/templates";
import { cancelBookingAdmin, resendManageLink } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OrgMode } from "@/features/orgs/mode";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { RESEND_STARTED_HINT } from "./booking-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// These rows server-render, so "now" is seeded after mount (the
// create-booking-dialog idiom): a render-time Date.now() would both trip
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
}: {
  booking: AdminBooking;
  timeZone: string;
  staff: StaffRow[];
  actionable: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  const nowMs = useNowMs();
  // "Upcoming" is ends_at-based (a stay in progress still lists), but a
  // manage link can only be reissued before the start (rotate_booking_token).
  const started = nowMs !== null && new Date(booking.startsAt).getTime() <= nowMs;
  const resendBlocked = !booking.clientEmail || started;
  const resendHint = !booking.clientEmail ? "No email on file" : started ? RESEND_STARTED_HINT : undefined;

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
      <p>
        {whenLineFor(
          {
            startsAt: new Date(booking.startsAt),
            endsAt: new Date(booking.endsAt),
            isRental: booking.rentalUnitId !== null,
          },
          timeZone,
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
      {actionable ? (
        <div className="flex items-center gap-2">
          {/* Rentals have no slot grid to move to — cancel/rebook instead. */}
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
  staff,
  mode,
}: {
  upcoming: AdminBooking[];
  past: AdminBooking[];
  timeZone: string;
  staff: StaffRow[]; // active members (Team slice); one ⇒ nothing changes
  mode: OrgMode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming bookings.{" "}
            {mode.offersAppointments && (
              <>
                <Link href="/services" className="underline">Set up a service</Link>
                {mode.offersRentals ? " or " : " "}
              </>
            )}
            {mode.offersRentals && (
              <>
                <Link href="/rentals" className="underline">
                  {mode.offersAppointments ? "add" : "Add"} a rental offering and its units
                </Link>{" "}
              </>
            )}
            to start taking bookings, then share your booking page.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row key={b.id} booking={b} timeZone={timeZone} staff={staff} actionable />
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
              <Row key={b.id} booking={b} timeZone={timeZone} staff={staff} actionable={false} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
