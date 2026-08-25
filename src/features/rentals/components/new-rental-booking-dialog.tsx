"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { asEngineOffering, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { hourlyGrid, type OfferingOption } from "@/features/rentals/offering-option";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { durationOptions, formatDurationLabel } from "@/features/rentals/hourly";
import { dateInZone } from "@/features/scheduling/slots";
import {
  getAdminRangeAvailability,
  createRentalBookingAdmin,
  getAdminHourlySlots,
  createRentalBookingHoursAdmin,
} from "@/features/rentals/booking-actions";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { TimeSlotGrid } from "@/features/scheduling/components/time-slot-grid";
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
import { SPACES } from "@/features/orgs/vocab";

// See move-rental-dialog.tsx: 62 rendered days + the longest turnover tail.
const WINDOW_DAYS = 93;
// A week at a time, TimeSlotGrid's own page size (hourly-booking-flow.tsx).
const HOUR_WINDOW_DAYS = 7;
// create-booking-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";
// hourly-booking-flow.tsx's own threshold for pills vs a <select>.
const MAX_PILL_OPTIONS = 8;

export type { OfferingOption };

type HourlySlot = { startsAt: string; unitIds: string[] };

// The prefill props seed state on mount only: the timeline mounts this per
// opening (and unmounts it on close) so each empty cell's offering/unit/date
// lands in the initial state.
export function NewRentalBookingDialog({
  open,
  onOpenChange,
  offerings,
  initialOfferingId,
  initialUnitId,
  initialStartDate,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerings: OfferingOption[];
  initialOfferingId?: string;
  initialUnitId?: string | null;
  initialStartDate?: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [offeringId, setOfferingId] = React.useState(
    () => initialOfferingId ?? offerings[0]?.id ?? "",
  );
  const selected = offerings.find((o) => o.id === offeringId) ?? null;
  const grid = selected ? hourlyGrid(selected) : null;
  const hourly = grid !== null;
  const hourOptions = grid ? durationOptions(grid) : [];

  // ---- nights/days (range engine) state — unchanged from before H2.
  const [month, setMonth] = React.useState(() =>
    monthOf(initialStartDate ?? dateInZone(new Date(), timeZone)),
  );
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [offering, setOffering] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  // A click on an empty cell means "check in here" — the end date is still
  // the provider's to pick.
  const [range, setRange] = React.useState<RangeValue>(() => ({
    start: initialStartDate ?? null,
    end: null,
  }));

  // ---- hours (H2) state.
  const [durationMin, setDurationMin] = React.useState<number | null>(null);
  const [hourFromDate, setHourFromDate] = React.useState(() => dateInZone(new Date(), timeZone));
  const [hourSlots, setHourSlots] = React.useState<HourlySlot[]>([]);
  const [hourUnits, setHourUnits] = React.useState<PublicUnit[]>([]);
  const [slot, setSlot] = React.useState<string | null>(null);
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  // Request-ordering guard (house pattern, hourly-booking-flow.tsx idiom): a
  // fast duration/week-nav change can fire a second fetch before the first
  // resolves — only the most recent request may ever apply its result.
  const hourSeqRef = React.useRef(0);

  const [unitId, setUnitId] = React.useState<string | null>(initialUnitId ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Request-ordering guard (house pattern, mirrors hourSeqRef above /
  // move-rental-dialog.tsx's seqRef): a fast month-nav click can fire a
  // second fetch before the first resolves — only the most recent request
  // may ever apply its result.
  const seqRef = React.useRef(0);

  const load = React.useCallback((id: string, m: string) => {
    if (!id) return;
    startTransition(async () => {
      const seq = ++seqRef.current;
      const result = await getAdminRangeAvailability({
        offeringId: id,
        fromDate: firstOfMonth(m),
        days: WINDOW_DAYS,
        excludeBookingId: null,
      });
      if (seq !== seqRef.current) return;
      if (result.ok) {
        setAvailability(result.availability);
        setOffering(result.offering);
        setUnits(result.units);
        // Belt and braces on the timeline's disabled cells: a seeded
        // check-in the engine won't accept leaves the picker with no legal
        // check-out and no way to clear it (the "change" reset only shows
        // once both dates are set), so drop it and let the provider pick.
        // Past the window is one way in; a day that is fully booked (or
        // outside the fetched month) is the other, which is what a click
        // landing on a turnover tail or a bar's half-cell would seed.
        setRange((r) => {
          if (r.start === null) return r;
          const day = result.availability.dates[r.start];
          return r.start < result.availability.notBefore || !day || day.free === 0
            ? { start: null, end: null }
            : r;
        });
      } else {
        setAvailability(null);
        setError(result.error);
      }
    });
  }, []);

  // Deliberately does NOT clear `error` (hourly-booking-flow.tsx idiom): the
  // slotTaken retry below re-loads times and wants its message to survive.
  const loadHours = React.useCallback(
    (id: string, duration: number, fromDate: string) => {
      startTransition(async () => {
        const seq = ++hourSeqRef.current;
        const result = await getAdminHourlySlots({
          offeringId: id,
          durationMin: duration,
          fromDate,
          days: HOUR_WINDOW_DAYS,
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
    [],
  );

  React.useEffect(() => {
    if (!open || hourly) return;
    load(offeringId, month);
  }, [open, hourly, offeringId, month, load]);

  React.useEffect(() => {
    if (!open || !hourly || durationMin === null) return;
    loadHours(offeringId, durationMin, hourFromDate);
  }, [open, hourly, offeringId, durationMin, hourFromDate, loadHours]);

  function changeOffering(id: string) {
    setError(null);
    setOfferingId(id);
    setOffering(null);
    setAvailability(null);
    setRange({ start: null, end: null });
    setDurationMin(null);
    setHourSlots([]);
    setHourUnits([]);
    setSlot(null);
    setUnitId(null);
  }
  function changeMonth(m: string) {
    setError(null);
    setMonth(m);
  }
  // Unlike the other pickers this keeps `unitId` across a date change: it
  // usually came from the timeline cell the provider clicked, and that unit
  // is the point of the walk-in. `effectiveUnitId` below drops it if the new
  // dates aren't free on it.
  function changeRange(next: RangeValue) {
    setError(null);
    setRange(next);
  }

  function changeDuration(d: number | null) {
    setError(null);
    setDurationMin(d);
    setSlot(null);
    setUnitId(null);
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
      ? validateStay(asEngineOffering(offering), availability, range.start, range.end)
      : null;
  const freeUnitIds = stay && stay.ok ? stay.unitIds : null;
  // A prefilled unit that isn't free for the chosen dates must not be sent —
  // the select would show it as unselected while the state still held it.
  const effectiveUnitId = unitId && freeUnitIds?.includes(unitId) ? unitId : null;

  const matchingHourSlot = slot ? hourSlots.find((s) => s.startsAt === slot) : undefined;
  const freeHourUnitIds = matchingHourSlot ? matchingHourSlot.unitIds : null;
  const effectiveHourUnitId = unitId && freeHourUnitIds?.includes(unitId) ? unitId : null;

  function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    const name = String(formData.get("name") ?? "");
    const note = String(formData.get("note") ?? "") || undefined;

    if (hourly) {
      if (!slot || durationMin === null) return;
      startTransition(async () => {
        setError(null);
        const result = await createRentalBookingHoursAdmin({
          offeringId,
          unitId: effectiveHourUnitId,
          startsAt: slot,
          durationMin,
          name,
          email: email || undefined,
          note,
        });
        if (!result.ok) {
          setError(result.error);
          if (result.slotTaken) {
            setSlot(null);
            setUnitId(null);
            loadHours(offeringId, durationMin, hourFromDate);
          } else {
            toast.error(result.error);
          }
          return;
        }
        if (result.emailed) toast.success("Booking created — confirmation emailed");
        else if (email)
          toast.warning(
            "Booking created — but the confirmation email failed. Contact the client directly.",
          );
        else toast.success("Booking created (no email on file)");
        onOpenChange(false);
        router.refresh();
      });
      return;
    }

    const { start, end } = range;
    if (!start || !end) return;
    startTransition(async () => {
      setError(null);
      const result = await createRentalBookingAdmin({
        offeringId,
        unitId: effectiveUnitId,
        startDate: start,
        endDate: end,
        name,
        email: email || undefined,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        if (result.datesTaken) {
          setRange({ start: null, end: null });
          setUnitId(null);
          load(offeringId, month);
        } else {
          toast.error(result.error);
        }
        return;
      }
      if (result.emailed) toast.success("Booking created — confirmation emailed");
      else if (email)
        toast.warning(
          "Booking created — but the confirmation email failed. Contact the client directly.",
        );
      else toast.success("Booking created (no email on file)");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{SPACES.walkIn}</DialogTitle>
          <DialogDescription>
            Recorded on your behalf — notice and booking-window limits don’t apply.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-rental-offering">{SPACES.field}</Label>
          <select
            id="new-rental-offering"
            className={selectClass}
            value={offeringId}
            onChange={(e) => changeOffering(e.target.value)}
          >
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {hourly ? (
          <div className="flex flex-col gap-4">
            {durationMin === null ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-sm">How long?</p>
                {hourOptions.length <= MAX_PILL_OPTIONS ? (
                  <div className="flex flex-wrap gap-2">
                    {hourOptions.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => changeDuration(d)}
                      >
                        {formatDurationLabel(d)}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <select
                    aria-label="Duration"
                    className={selectClass}
                    defaultValue=""
                    onChange={(e) => changeDuration(Number(e.target.value))}
                  >
                    <option value="" disabled>
                      Choose a duration
                    </option>
                    {hourOptions.map((d) => (
                      <option key={d} value={d}>
                        {formatDurationLabel(d)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : !slot ? (
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
                    {formatDurationLabel(durationMin)}{" "}
                    <button
                      type="button"
                      className="text-muted-foreground underline"
                      onClick={() => changeDuration(null)}
                    >
                      change
                    </button>
                  </p>
                }
              />
            ) : (
              <form action={submit} className="flex flex-col gap-3">
                <p className="text-sm">
                  {formatDurationLabel(durationMin)} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(slot))}{" "}
                  <button type="button" className="text-muted-foreground underline" onClick={backToTime}>
                    change
                  </button>
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-rental-hour-unit">Unit</Label>
                  <UnitSelect
                    id="new-rental-hour-unit"
                    units={hourUnits}
                    freeUnitIds={freeHourUnitIds}
                    value={effectiveHourUnitId}
                    onChange={setUnitId}
                  />
                </div>
                <ClientDetailsFields emailOptional idPrefix="new-rental-hour-" />
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating…" : "Create booking"}
                </Button>
              </form>
            )}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
        ) : offering === null ? (
          <p className="text-muted-foreground text-sm">{error ?? "Loading availability…"}</p>
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
              <form action={submit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-rental-unit">Unit</Label>
                  <UnitSelect
                    id="new-rental-unit"
                    units={units}
                    freeUnitIds={freeUnitIds}
                    value={effectiveUnitId}
                    onChange={setUnitId}
                  />
                </div>
                <ClientDetailsFields emailOptional idPrefix="new-rental-" />
                <Button type="submit" disabled={pending || !stay?.ok}>
                  {pending ? "Creating…" : "Create booking"}
                </Button>
              </form>
            ) : null}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
