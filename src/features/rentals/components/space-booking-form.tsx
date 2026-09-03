"use client";

import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { asEngineOffering, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { hourlyGrid, type OfferingOption } from "@/features/rentals/offering-option";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { durationOptions, formatDurationLabel } from "@/features/rentals/hourly";
import { dateInZone } from "@/features/scheduling/slots";
import { INTL_LOCALES } from "@/i18n/config";
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

// See move-rental-dialog.tsx: 62 rendered days + the longest turnover tail.
const WINDOW_DAYS = 93;
// A week at a time, TimeSlotGrid's own page size (hourly-booking-flow.tsx).
const HOUR_WINDOW_DAYS = 7;
// The native-<select> idiom shared by the booking forms.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";
// hourly-booking-flow.tsx's own threshold for pills vs a <select>.
const MAX_PILL_OPTIONS = 8;

type HourlySlot = { startsAt: string; unitIds: string[] };

/* The space half of the New-booking dialog (admin IA spec §2). The shell
   owns WHICH space; this form owns dates (nights/days: RangePicker + range
   engine), or duration + time slot (hourly), then unit and client. The
   prefill props seed state on mount only — the shell mounts this keyed by
   the space id, so a switch always starts clean. */
export function SpaceBookingForm({
  offering,
  initialUnitId,
  initialStartDate,
  timeZone,
  onDone,
}: {
  offering: OfferingOption;
  initialUnitId?: string | null;
  initialStartDate?: string;
  timeZone: string;
  onDone: () => void;
}) {
  const tu = useTranslations("public.units");
  const t = useTranslations("bookings");
  const tCommon = useTranslations("common");
  const intlLocale = INTL_LOCALES[useLocale()];
  const router = useRouter();
  const offeringId = offering.id;
  const grid = hourlyGrid(offering);
  const hourly = grid !== null;
  const hourOptions = grid ? durationOptions(grid) : [];

  // ---- nights/days (range engine) state — unchanged from before H2.
  const [month, setMonth] = React.useState(() =>
    monthOf(initialStartDate ?? dateInZone(new Date(), timeZone)),
  );
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [loaded, setLoaded] = React.useState<PublicOffering | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  // A click on an empty cell means "check in here" — the end date is still
  // the provider's to pick.
  const [range, setRange] = React.useState<RangeValue>(() => ({
    start: initialStartDate ?? null,
    end: null,
  }));

  // ---- hours (H2) state. A drag's day seeds the 7-day window (falls back
  // to today when there's no drag prefill), same as the range side above.
  const [durationMin, setDurationMin] = React.useState<number | null>(null);
  const [hourFromDate, setHourFromDate] = React.useState(
    () => initialStartDate ?? dateInZone(new Date(), timeZone),
  );
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
        setLoaded(result.offering);
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
    if (hourly) return;
    load(offeringId, month);
  }, [hourly, offeringId, month, load]);

  React.useEffect(() => {
    if (!hourly || durationMin === null) return;
    loadHours(offeringId, durationMin, hourFromDate);
  }, [hourly, offeringId, durationMin, hourFromDate, loadHours]);

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
    loaded && availability && range.start && range.end
      ? validateStay(asEngineOffering(loaded), availability, range.start, range.end)
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
        if (result.emailed) toast.success(t("create.doneEmailed"));
        else if (email)
          toast.warning(
            t("create.doneEmailFailed"),
          );
        else toast.success(t("create.doneNoEmail"));
        onDone();
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
      if (result.emailed) toast.success(t("create.doneEmailed"));
      else if (email)
        toast.warning(
          t("create.doneEmailFailed"),
        );
      else toast.success(t("create.doneNoEmail"));
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {hourly ? (
        <div className="flex flex-col gap-4">
          {durationMin === null ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">{t("form.howLong")}</p>
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
                      {formatDurationLabel(d, tu)}
                    </Button>
                  ))}
                </div>
              ) : (
                <select
                  aria-label={t("form.duration")}
                  className={selectClass}
                  defaultValue=""
                  onChange={(e) => changeDuration(Number(e.target.value))}
                >
                  <option value="" disabled>
                    {t("form.chooseDuration")}
                  </option>
                  {hourOptions.map((d) => (
                    <option key={d} value={d}>
                      {formatDurationLabel(d, tu)}
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
                  {formatDurationLabel(durationMin, tu)}{" "}
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => changeDuration(null)}
                  >
                    {t("form.change")}
                  </button>
                </p>
              }
            />
          ) : (
            <form action={submit} className="flex flex-col gap-3">
              <p className="text-sm">
                {formatDurationLabel(durationMin, tu)} ·{" "}
                {new Intl.DateTimeFormat(intlLocale, {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(slot))}{" "}
                <button type="button" className="text-muted-foreground underline" onClick={backToTime}>
                  {t("form.change")}
                </button>
              </p>
              <UnitSelect
                id="new-rental-hour-unit"
                label={t("form.unit")}
                units={hourUnits}
                freeUnitIds={freeHourUnitIds}
                value={effectiveHourUnitId}
                onChange={setUnitId}
              />
              <ClientDetailsFields emailOptional idPrefix="new-rental-hour-" />
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("creating") : t("create.button")}
              </Button>
            </form>
          )}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
      ) : loaded === null ? (
        <p className="text-muted-foreground text-sm">{error ?? t("form.loadingAvailability")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <RangePicker
            variant="admin"
            offering={loaded}
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
              <UnitSelect
                id="new-rental-unit"
                label={t("form.unit")}
                units={units}
                freeUnitIds={freeUnitIds}
                value={effectiveUnitId}
                onChange={setUnitId}
              />
              <ClientDetailsFields emailOptional idPrefix="new-rental-" />
              <Button type="submit" disabled={pending || !stay?.ok}>
                {pending ? tCommon("creating") : t("create.button")}
              </Button>
            </form>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
