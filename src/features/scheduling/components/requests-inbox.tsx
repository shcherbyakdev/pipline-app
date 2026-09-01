"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  acceptBookingRequest,
  declineBookingRequest,
} from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  DialogFooterBar,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* Decline-with-a-message popup. Owns the action, the toast and the refresh so
   all three callers stay thin: this file's inbox rows, the bookings list, and
   the booking-detail dialog — which passes `onDeclined` to close itself
   afterwards (the two inline rows have nothing to close). */
export function DeclineRequestDialog({
  bookingId,
  open,
  onOpenChange,
  onDeclined,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeclined?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [note, setNote] = React.useState("");
  const noteId = React.useId();

  const change = (next: boolean) => {
    // A message typed and then abandoned shouldn't greet the next open.
    if (!next) setNote("");
    onOpenChange(next);
  };

  const decline = () =>
    startTransition(async () => {
      const result = await declineBookingRequest({
        id: bookingId,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Request declined.");
      change(false);
      onDeclined?.();
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className={dialogPanelClass}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="time">Request</DialogChip>}
        >
          Decline request
        </DialogBreadcrumbHeader>
        <div className="flex flex-col px-5 pt-4 pb-6">
          <DialogDescription>
            The time is released and the client is emailed that you can&apos;t
            take it.
          </DialogDescription>
          <textarea
            id={noteId}
            aria-label="Message to the client (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Message to the client (optional) — e.g. We're fully booked that morning, happy to take you at 14:00."
            className={cn(dialogBareInputClass, "mt-4 resize-none text-sm")}
          />
        </div>
        <DialogFooterBar>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => change(false)}
            disabled={pending}
          >
            Keep
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={decline}
            disabled={pending}
          >
            {pending ? "Declining…" : "Decline request"}
          </Button>
        </DialogFooterBar>
      </DialogContent>
    </Dialog>
  );
}

function RequestRow({
  booking,
  timeZone,
}: {
  booking: AdminBooking;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [declining, setDeclining] = React.useState(false);

  const accept = () =>
    startTransition(async () => {
      const result = await acceptBookingRequest({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else
        toast.success(
          result.emailed ? "Accepted — confirmation sent." : "Accepted.",
        );
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
      <p className="font-medium">{booking.clientName}</p>
      <p>
        {booking.serviceName}
        {booking.staffName ? ` · ${booking.staffName}` : ""}
      </p>
      <p>
        {whenLineFor(
          {
            startsAt: new Date(booking.startsAt),
            endsAt: new Date(booking.endsAt),
            isRental: booking.rentalUnitId !== null,
            rangeMode: booking.rangeMode,
          },
          timeZone,
        )}
      </p>
      {booking.priceCents !== null && booking.currency ? (
        <p>{formatMoney(booking.priceCents, booking.currency)}</p>
      ) : null}
      {booking.note ? (
        <p className="text-muted-foreground line-clamp-2">“{booking.note}”</p>
      ) : null}
      {/* The list repeats these two buttons per request, so the visible word
          alone is an ambiguous accessible name — same disambiguation the
          services and staff lists use (`Delete ${service.name}`). */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={accept}
          disabled={pending}
          aria-label={`Accept request from ${booking.clientName}`}
        >
          Accept
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDeclining(true)}
          disabled={pending}
          aria-label={`Decline request from ${booking.clientName}`}
        >
          Decline…
        </Button>
      </div>
      <DeclineRequestDialog
        bookingId={booking.id}
        open={declining}
        onOpenChange={setDeclining}
      />
    </li>
  );
}

/* Live requests waiting on the owner, above the Overview tiles. Nothing at
   all when there are none — an empty box every day would be worse than the
   silence (spec §4). */
export function RequestsInbox({
  requests,
  timeZone,
}: {
  requests: AdminBooking[];
  timeZone: string;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Requests</h2>
      <ul className="flex flex-col gap-2">
        {requests.map((b) => (
          <RequestRow key={b.id} booking={b} timeZone={timeZone} />
        ))}
      </ul>
    </section>
  );
}
