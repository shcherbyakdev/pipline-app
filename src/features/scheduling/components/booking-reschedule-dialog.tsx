"use client";

import * as React from "react";
import { toast } from "sonner";
import { addDaysISO } from "@/features/scheduling/slots";
import { getAdminSlots, rescheduleBookingAdmin } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const todayISO = () => new Date().toISOString().slice(0, 10);

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function BookingRescheduleDialog({
  booking,
  timeZone,
}: {
  booking: AdminBooking;
  timeZone: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);

  const loadSlots = (date: string) => {
    startTransition(async () => {
      const res = await getAdminSlots({ serviceId: booking.serviceId, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else setSlots(res.slots);
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) loadSlots(fromDate);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO()) return;
    setFromDate(next);
    loadSlots(next);
  };

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBookingAdmin({ id: booking.id, startsAt });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate);
      } else {
        if (res.noEmail) toast.success("Booking moved — no email on file for this client.");
        else if (res.emailed) toast.success("Booking moved — the client has been emailed");
        else
          toast.warning(
            "Booking moved — but the email with the new manage link failed. Contact the client directly.",
          );
        setOpen(false);
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            Reschedule
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{booking.serviceName}” for {booking.clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">Week of {fromDate}</p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav(-7)}
              disabled={pending || fromDate <= todayISO()}
              aria-label="Previous week"
            >
              ←
            </Button>
            <Button variant="ghost" size="sm" onClick={() => nav(7)} disabled={pending} aria-label="Next week">
              →
            </Button>
          </div>
        </div>
        {slots === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground text-sm">No free times this week.</p>
        ) : (
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
            {slots.map((s) => (
              <Button key={s} variant="outline" size="sm" disabled={pending} onClick={() => pick(s)}>
                {slotLabel(s)}
              </Button>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">Times in your browser timezone; org timezone: {timeZone}.</p>
      </DialogContent>
    </Dialog>
  );
}
