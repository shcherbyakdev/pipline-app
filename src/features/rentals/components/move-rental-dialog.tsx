"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { validateStay, type RangeAvailability } from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { dateInZone } from "@/features/scheduling/slots";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  getAdminRangeAvailability,
  rescheduleRentalBookingAdmin,
} from "@/features/rentals/booking-actions";
import { RangePicker, type RangeValue } from "./range-picker";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Two rendered months are at most 62 days; the turnover tail (≤ 30) has to
// come along or validateStay reads a missing day at the far edge as
// "unavailable". 62 + 30 fits the action's own 93-day cap, so one constant
// covers every offering and the window never has to be refetched when the
// offering's turnover arrives with the first response.
const WINDOW_DAYS = 93;

export function MoveRentalDialog({
  booking,
  timeZone,
  open,
  onOpenChange,
  onMoved,
}: {
  booking: AdminBooking;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The caller usually shows this booking behind the dialog; after a move
  // that row is stale (the RPC writes a new one), so it closes itself.
  onMoved?: () => void;
}) {
  const router = useRouter();
  const offeringId = booking.rentalOfferingId;
  const [month, setMonth] = React.useState(() =>
    monthOf(dateInZone(new Date(booking.startsAt), timeZone)),
  );
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [range, setRange] = React.useState<RangeValue>({ start: null, end: null });
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Deliberately does NOT clear `error`: the datesTaken path reloads
  // availability and wants its message to survive the reload.
  const load = React.useCallback(
    (m: string) => {
      if (offeringId === null) return;
      startTransition(async () => {
        const result = await getAdminRangeAvailability({
          offeringId,
          fromDate: firstOfMonth(m),
          days: WINDOW_DAYS,
          excludeBookingId: booking.id,
        });
        if (result.ok) {
          setAvailability(result.availability);
          setOffering(result.offering);
          setUnits(result.units);
        } else {
          setAvailability(null);
          setError(result.error);
        }
      });
    },
    [offeringId, booking.id],
  );

  React.useEffect(() => {
    if (!open) return;
    load(month);
  }, [open, month, load]);

  if (offeringId === null) return null;

  function changeMonth(m: string) {
    setError(null);
    setMonth(m);
  }
  function changeRange(next: RangeValue) {
    setError(null);
    setUnitId(null);
    setRange(next);
  }

  const stay =
    offering && availability && range.start && range.end
      ? validateStay(offering, availability, range.start, range.end)
      : null;
  const freeUnitIds = stay && stay.ok ? stay.unitIds : null;
  const keepUnitName = units.find((u) => u.id === booking.rentalUnitId)?.name ?? null;

  function confirm() {
    const { start, end } = range;
    if (!start || !end) return;
    startTransition(async () => {
      setError(null);
      const result = await rescheduleRentalBookingAdmin({
        id: booking.id,
        unitId,
        startDate: start,
        endDate: end,
      });
      if (!result.ok) {
        // Inline in every case (it belongs to the form); a lost-dates
        // failure also resets the picker and refetches, and its message has
        // to survive that reload — the toast would just repeat it.
        setError(result.error);
        if (result.datesTaken) {
          setRange({ start: null, end: null });
          setUnitId(null);
          load(month);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.datesChanged) {
        toast.success(
          result.emailed ? "Stay moved — the client has been emailed" : "Stay moved",
        );
      } else if (result.unitChanged) {
        toast.success(result.emailed ? "Unit changed — client emailed" : "Unit changed");
      } else {
        toast.success("Stay moved");
      }
      onOpenChange(false);
      onMoved?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Move stay</DialogTitle>
          <DialogDescription>
            {booking.clientName} ·{" "}
            {whenLineFor(
              {
                startsAt: new Date(booking.startsAt),
                endsAt: new Date(booking.endsAt),
                isRental: true,
              },
              timeZone,
            )}
          </DialogDescription>
        </DialogHeader>
        {offering === null ? (
          <p className="text-muted-foreground text-sm">
            {error ?? "Loading availability…"}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <RangePicker
              variant="admin"
              offering={offering}
              availability={availability}
              loading={pending}
              month={month}
              onMonthChange={changeMonth}
              value={range}
              onChange={changeRange}
              canGoBack={month > monthOf(dateInZone(new Date(), timeZone))}
              timeZone={timeZone}
            />
            {range.start && range.end ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="move-rental-unit">Unit</Label>
                  <UnitSelect
                    id="move-rental-unit"
                    units={units}
                    freeUnitIds={freeUnitIds}
                    value={unitId}
                    onChange={setUnitId}
                    keepUnitId={booking.rentalUnitId}
                    keepUnitName={keepUnitName}
                  />
                </div>
                <Button onClick={confirm} disabled={pending || !stay?.ok}>
                  {pending ? "Moving…" : "Move stay"}
                </Button>
              </>
            ) : null}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
