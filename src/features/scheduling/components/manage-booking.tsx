"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDaysISO } from "@/features/scheduling/slots";
import {
  cancelBooking,
  getManageSlots,
  rescheduleBooking,
} from "@/features/scheduling/manage-actions";
import { Button } from "@/components/ui/button";

// UTC "today" — matches booking-widget's documented caveat (far-west
// evening viewers start one day ahead; navigation covers it).
const todayISO = () => new Date().toISOString().slice(0, 10);

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function ManageBooking({ token, timeZone }: { token: string; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);

  const loadSlots = (date: string) => {
    startTransition(async () => {
      const res = await getManageSlots({ token, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else setSlots(res.slots);
    });
  };

  const openPicker = () => {
    setPicking(true);
    loadSlots(fromDate);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO()) return;
    setFromDate(next);
    loadSlots(next);
  };

  const doCancel = () =>
    startTransition(async () => {
      const res = await cancelBooking({ token });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Booking cancelled");
        router.refresh();
      }
    });

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBooking({ token, startsAt });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate);
      } else {
        // New booking, new token: the manage link changes.
        router.push(`/booking/${res.token}`);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {picking ? (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Pick a new time</p>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(7)}
                disabled={pending}
                aria-label="Next week"
              >
                →
              </Button>
            </div>
          </div>
          {slots === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">No free times this week — try the next.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => pick(s)}
                >
                  {slotLabel(s)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Times shown in your local timezone; the provider is in {timeZone}.
          </p>
        </div>
      ) : (
        <Button variant="outline" onClick={openPicker} disabled={pending}>
          Reschedule
        </Button>
      )}
      {confirmingCancel ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={doCancel} disabled={pending}>
            Yes, cancel this booking
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={pending}>
          Cancel booking
        </Button>
      )}
    </div>
  );
}
