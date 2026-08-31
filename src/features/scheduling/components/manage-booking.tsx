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
import { RentalReschedulePanel } from "@/features/rentals/components/rental-reschedule-panel";
import { HourlyReschedulePanel } from "@/features/rentals/components/hourly-reschedule-panel";
import { CANCEL_WINDOW_PASSED } from "@/features/rentals/schema";
import { Button } from "@/components/ui/button";

// The viewer's local date (booking-widget's rule; getManageSlots pads its
// engine window a day each side, the picker keeps what lands on its page).
const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const viewerDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function ManageBooking({
  token,
  timeZone,
  canReschedule,
  canCancel,
  kind,
  rangeMode,
  request,
}: {
  token: string;
  timeZone: string;
  // Whether self-serve rescheduling is offered at all (cancel is always).
  canReschedule: boolean;
  // H3: false once a rental's free-cancellation window has elapsed — hides
  // the cancel button and shows CANCEL_WINDOW_PASSED instead. Always true for
  // appointments and rentals with no cancel window (page.tsx computes it).
  // Reschedule is unaffected either way.
  canCancel: boolean;
  // Rentals R2: a stay picks a date RANGE, not a slot — the same
  // Reschedule button opens a range picker instead of the slot grid.
  kind: "appointment" | "rental";
  // Rentals only (H2): which reschedule surface a booking gets — the range
  // picker (nights/days) or the hourly time grid. Null for an appointment,
  // which never reads it (kind === "appointment" always wins the branch
  // below).
  rangeMode: "nights" | "days" | "hours" | null;
  // Booking approval: a still-pending request cancels through the same
  // cancel_booking action, just with "withdraw" wording — nothing else
  // about the flow changes.
  request?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);
  // A picked slot waits for an explicit confirm (audit 2026-08-24: one
  // mis-click used to move the booking and email everyone).
  const [candidate, setCandidate] = React.useState<string | null>(null);

  const loadSlots = (date: string) => {
    setCandidate(null);
    startTransition(async () => {
      const res = await getManageSlots({ token, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else {
        const last = addDaysISO(date, 6);
        setSlots(res.slots.filter((s) => viewerDay(s) >= date && viewerDay(s) <= last));
      }
    });
  };

  const openPicker = () => {
    setPicking(true);
    // A stay's panel loads its own range availability by token.
    if (kind === "appointment") loadSlots(fromDate);
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
      {!canReschedule ? null : !picking ? (
        <Button variant="outline" onClick={openPicker} disabled={pending}>
          Reschedule
        </Button>
      ) : kind === "rental" ? (
        rangeMode === "hours" ? (
          <HourlyReschedulePanel
            token={token}
            timeZone={timeZone}
            onCancel={() => setPicking(false)}
          />
        ) : (
          <RentalReschedulePanel
            token={token}
            timeZone={timeZone}
            onCancel={() => setPicking(false)}
          />
        )
      ) : (
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
          ) : candidate ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Move this booking to <span className="font-medium">{slotLabel(candidate)}</span>?
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => pick(candidate)} disabled={pending}>
                  Confirm new time
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCandidate(null)} disabled={pending}>
                  Pick another
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => setCandidate(s)}
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
      )}
      {!canCancel ? (
        <p className="text-muted-foreground text-xs">{CANCEL_WINDOW_PASSED}</p>
      ) : confirmingCancel ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={doCancel} disabled={pending}>
            {request ? "Yes, withdraw this request" : "Yes, cancel this booking"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={pending}>
          {request ? "Withdraw request" : "Cancel booking"}
        </Button>
      )}
      {!canReschedule || (kind === "rental" && !picking) ? (
        // Rentals: the range line above is in the provider's zone, and
        // outside the open panel (which says so itself) nothing else does.
        <p className="text-muted-foreground text-xs">
          Times shown in the provider&rsquo;s timezone ({timeZone}).
        </p>
      ) : null}
    </div>
  );
}
