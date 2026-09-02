"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AdminBooking } from "@/features/scheduling/queries";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import {
  asEngineOffering,
  validateStay,
  type RangeAvailability,
} from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { dateInZone } from "@/features/scheduling/slots";
import { INTL_LOCALES } from "@/i18n/config";
import { whenLineFor } from "@/features/scheduling/templates";
import {
  getAdminRangeAvailability,
  rescheduleRentalBookingAdmin,
  getAdminHourlySlots,
  rescheduleRentalHoursAdmin,
} from "@/features/rentals/booking-actions";
import { TimeSlotGrid } from "@/features/scheduling/components/time-slot-grid";
import { RangePicker, type RangeValue } from "./range-picker";
import { UnitSelect } from "./unit-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogDescription,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Two rendered months are at most 62 days; the turnover tail (≤ 30) has to
// come along or validateStay reads a missing day at the far edge as
// "unavailable". 62 + 30 fits the action's own 93-day cap, so one constant
// covers every offering and the window never has to be refetched when the
// offering's turnover arrives with the first response.
const WINDOW_DAYS = 93;
// A week at a time, TimeSlotGrid's own page size (hourly-booking-flow.tsx).
const HOUR_WINDOW_DAYS = 7;

type HourlySlot = { startsAt: string; unitIds: string[] };

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
  const tu = useTranslations("public.units");
  const t = useTranslations("bookings");
  const intlLocale = INTL_LOCALES[useLocale()];
  const router = useRouter();
  const offeringId = booking.rentalOfferingId;
  const hourly = booking.rangeMode === "hours";
  // Same-duration ruling: the booking's own span, computed client-side only
  // to LABEL the picker — the action re-derives it server-side from the row
  // and never takes it from here.
  const durationMin = Math.round(
    (new Date(booking.endsAt).getTime() -
      new Date(booking.startsAt).getTime()) /
      60_000,
  );

  // ---- nights/days (range engine) state — unchanged from before H2.
  const [month, setMonth] = React.useState(() =>
    monthOf(dateInZone(new Date(booking.startsAt), timeZone)),
  );
  const [availability, setAvailability] =
    React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [range, setRange] = React.useState<RangeValue>({
    start: null,
    end: null,
  });

  // ---- hours (H2) state.
  const [hourFromDate, setHourFromDate] = React.useState(() =>
    dateInZone(new Date(booking.startsAt), timeZone),
  );
  const [hourSlots, setHourSlots] = React.useState<HourlySlot[]>([]);
  const [hourUnits, setHourUnits] = React.useState<PublicUnit[]>([]);
  const [slot, setSlot] = React.useState<string | null>(null);
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  // Request-ordering guard (house pattern, hourly-reschedule-panel.tsx
  // idiom): a fast week-nav click can fire a second fetch before the first
  // resolves — only the most recent request may ever apply its result.
  const hourSeqRef = React.useRef(0);

  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Request-ordering guard (house pattern, mirrors hourSeqRef above): a
  // fast month-nav click can fire a second fetch before the first
  // resolves — only the most recent request may ever apply its result.
  const seqRef = React.useRef(0);

  // Deliberately does NOT clear `error`: the datesTaken path reloads
  // availability and wants its message to survive the reload.
  const load = React.useCallback(
    (m: string) => {
      if (offeringId === null) return;
      startTransition(async () => {
        const seq = ++seqRef.current;
        const result = await getAdminRangeAvailability({
          offeringId,
          fromDate: firstOfMonth(m),
          days: WINDOW_DAYS,
          excludeBookingId: booking.id,
        });
        if (seq !== seqRef.current) return;
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

  const loadHours = React.useCallback(
    (fromDate: string) => {
      if (offeringId === null) return;
      startTransition(async () => {
        const seq = ++hourSeqRef.current;
        const result = await getAdminHourlySlots({
          offeringId,
          durationMin,
          fromDate,
          days: HOUR_WINDOW_DAYS,
          excludeBookingId: booking.id,
        });
        if (seq !== hourSeqRef.current) return;
        if (result.ok) {
          setHourSlots(result.slots);
          setHourUnits(result.units);
        } else {
          setHourSlots([]);
          setError(result.error);
        }
      });
    },
    [offeringId, durationMin, booking.id],
  );

  React.useEffect(() => {
    if (!open || hourly) return;
    load(month);
  }, [open, hourly, month, load]);

  React.useEffect(() => {
    if (!open || !hourly) return;
    loadHours(hourFromDate);
  }, [open, hourly, hourFromDate, loadHours]);

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
  function navigateHours(next: string) {
    setError(null);
    setHourFromDate(next);
  }
  function pickSlot(iso: string) {
    setError(null);
    setUnitId(null);
    setSlot(iso);
  }
  function backToTime() {
    setError(null);
    setSlot(null);
    setUnitId(null);
  }

  const stay =
    offering && availability && range.start && range.end
      ? validateStay(
          asEngineOffering(offering),
          availability,
          range.start,
          range.end,
        )
      : null;
  const freeUnitIds = stay && stay.ok ? stay.unitIds : null;
  const keepUnitName =
    units.find((u) => u.id === booking.rentalUnitId)?.name ?? null;

  const matchingHourSlot = slot
    ? hourSlots.find((s) => s.startsAt === slot)
    : undefined;
  const freeHourUnitIds = matchingHourSlot ? matchingHourSlot.unitIds : null;
  const keepHourUnitName =
    hourUnits.find((u) => u.id === booking.rentalUnitId)?.name ?? null;

  function confirmHours() {
    if (!slot) return;
    startTransition(async () => {
      setError(null);
      const result = await rescheduleRentalHoursAdmin({
        id: booking.id,
        unitId,
        startsAt: slot,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.datesTaken) {
          setSlot(null);
          setUnitId(null);
          loadHours(hourFromDate);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.datesChanged) {
        toast.success(
          result.emailed
            ? t("move.doneEmailed")
            : t("move.done"),
        );
      } else if (result.unitChanged) {
        toast.success(
          result.emailed ? t("move.unitChangedEmailed") : t("move.unitChanged"),
        );
      } else {
        toast.success(t("move.done"));
      }
      onOpenChange(false);
      onMoved?.();
      router.refresh();
    });
  }

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
          result.emailed
            ? t("move.stayDoneEmailed")
            : t("move.stayDone"),
        );
      } else if (result.unitChanged) {
        toast.success(
          result.emailed ? t("move.unitChangedEmailed") : t("move.unitChanged"),
        );
      } else {
        toast.success(t("move.stayDone"));
      }
      onOpenChange(false);
      onMoved?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-2xl")}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="space">{booking.serviceName}</DialogChip>}
        >
          {hourly ? t("move.title") : t("move.stayTitle")}
        </DialogBreadcrumbHeader>
        <div className="flex flex-col gap-4 px-5 pt-4 pb-6">
          <DialogDescription>
            {booking.clientName} ·{" "}
            {whenLineFor(
              {
                startsAt: new Date(booking.startsAt),
                endsAt: new Date(booking.endsAt),
                isRental: true,
                rangeMode: booking.rangeMode,
              },
              timeZone,
              intlLocale,
            )}
          </DialogDescription>
          {hourly ? (
            <div className="flex flex-col gap-4">
              {!slot ? (
                <TimeSlotGrid
                  slots={hourSlots.map((s) => s.startsAt)}
                  fromDate={hourFromDate}
                  todayISO={dateInZone(new Date(), timeZone)}
                  pending={pending}
                  orgTimeZone={timeZone}
                  onNavigate={navigateHours}
                  onPick={pickSlot}
                  regionRef={slotsRegionRef}
                  headerSlot={
                    <p className="text-sm font-medium">
                      {formatDurationLabel(durationMin, tu)}
                    </p>
                  }
                />
              ) : (
                <>
                  <p className="text-sm">
                    {formatDurationLabel(durationMin, tu)} ·{" "}
                    {new Intl.DateTimeFormat(intlLocale, {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(slot))}{" "}
                    <button
                      type="button"
                      className="text-muted-foreground underline"
                      onClick={backToTime}
                    >
                      {t("form.change")}
                    </button>
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="move-rental-hour-unit">{t("form.unit")}</Label>
                    <UnitSelect
                      id="move-rental-hour-unit"
                      units={hourUnits}
                      freeUnitIds={freeHourUnitIds}
                      value={unitId}
                      onChange={setUnitId}
                      keepUnitId={booking.rentalUnitId}
                      keepUnitName={keepHourUnitName}
                    />
                  </div>
                  <Button onClick={confirmHours} disabled={pending}>
                    {pending ? t("move.moving") : t("move.title")}
                  </Button>
                </>
              )}
              {error ? (
                <p className="text-destructive text-sm">{error}</p>
              ) : null}
            </div>
          ) : offering === null ? (
            <p className="text-muted-foreground text-sm">
              {error ?? t("form.loadingAvailability")}
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
                    <Label htmlFor="move-rental-unit">{t("form.unit")}</Label>
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
                    {pending ? t("move.moving") : t("move.stayTitle")}
                  </Button>
                </>
              ) : null}
              {error ? (
                <p className="text-destructive text-sm">{error}</p>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
