"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { durationOptions, formatDurationLabel, type HourlyOffering } from "@/features/rentals/hourly";
import { formatOfferingPrice } from "@/features/rentals/pricing";
import { getHourlySlots, createRentalBookingHours } from "@/features/rentals/hourly-actions";
import { formatHourlyWhenLine } from "@/features/scheduling/templates";
import { TimeSlotGrid } from "@/features/scheduling/components/time-slot-grid";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { BookingMoneySummary } from "./booking-money-summary";

// offering-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

// Above this many options a pill row would wrap onto several lines and eat
// into the embed's height budget — offering-dialog's own increment picker
// draws the same line at a handful of options.
const MAX_PILL_OPTIONS = 8;

function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

type HourlySlot = { startsAt: string; unitIds: string[] };

export function HourlyBookingFlow({
  handle,
  orgTimeZone,
  offering,
  currency,
  onBack,
}: {
  handle: string;
  orgTimeZone: string;
  offering: PublicOffering;
  currency: string;
  onBack: (() => void) | null;
}) {
  // The widget branch only ever hands this component an hours offering
  // (booking-widget.tsx's rangeMode check) — the trio is guaranteed set
  // (0056 CHECK).
  const hourly = offering as HourlyOffering;
  const options = React.useMemo(() => durationOptions(hourly), [hourly]);

  const [durationMin, setDurationMin] = React.useState<number | null>(
    options.length === 1 ? options[0] : null,
  );
  const [fromDate, setFromDate] = React.useState(todayISO());
  const [slots, setSlots] = React.useState<HourlySlot[]>([]);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const slotsRegionRef = React.useRef<HTMLDivElement>(null);
  // Request-ordering guard: a fast "change duration" or week-nav click can
  // fire a second fetch before the first resolves — only the most recent
  // request may ever apply its result.
  const seqRef = React.useRef(0);

  // Deliberately does NOT clear `error` (RentalBookingFlow's `load`): the
  // slotTaken retry below re-loads times *and* wants its message to survive
  // the reload.
  const load = React.useCallback(() => {
    if (!durationMin) return;
    startTransition(async () => {
      const seq = ++seqRef.current;
      const res = await getHourlySlots({
        handle,
        offeringId: offering.id,
        durationMin,
        fromDate,
        days: 7,
        unitId: offering.unitSelection === "client_picks" ? unitId : null,
      });
      if (seq !== seqRef.current) return;
      if (res.ok) {
        setSlots(res.slots);
        setUnits(res.units);
      } else {
        setSlots([]);
        setError(res.error);
      }
    });
  }, [handle, offering.id, offering.unitSelection, durationMin, fromDate, unitId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // A duration pick mounts the slot grid in its place (this component's own
  // conditional render below) — flushSync (booking-widget.tsx's staff-pick
  // idiom) forces that mount to happen before the focus call so the region
  // actually exists to receive it. Only on the forward pick: `d === null` is
  // the "change" link going back to the duration step, where there is
  // nothing of this component's to focus.
  function changeDuration(d: number | null) {
    setError(null);
    if (d === null) {
      setDurationMin(d);
      setSlot(null);
      setUnitId(null);
      setTermsAccepted(false);
      return;
    }
    flushSync(() => {
      setDurationMin(d);
      setSlot(null);
      setUnitId(null);
      setTermsAccepted(false);
    });
    slotsRegionRef.current?.focus();
  }

  function navigate(next: string) {
    setError(null);
    setFromDate(next);
  }

  function backToTime() {
    setError(null);
    setSlot(null);
    setUnitId(null);
    setTermsAccepted(false);
  }

  const matchingSlot = slot ? slots.find((s) => s.startsAt === slot) : undefined;
  const eligibleUnits = matchingSlot ? units.filter((u) => matchingSlot.unitIds.includes(u.id)) : [];
  const needsUnitStep = offering.unitSelection === "client_picks" && !!slot && !unitId;

  function submit(formData: FormData) {
    if (!slot || !durationMin) return;
    startTransition(async () => {
      setError(null);
      const result = await createRentalBookingHours({
        handle,
        offeringId: offering.id,
        unitId: offering.unitSelection === "client_picks" ? unitId : null,
        startsAt: slot,
        durationMin,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        note: String(formData.get("note") ?? "") || undefined,
        termsAccepted,
      });
      if (result.ok) {
        setDoneToken(result.token);
        return;
      }
      setError(result.error);
      if (result.slotTaken) {
        setSlot(null);
        setUnitId(null);
        setTermsAccepted(false);
        load();
      }
    });
  }

  // Viewer-local, matching TimeSlotGrid's own slot-button labels — the pick
  // is confirmed in the same timezone it was offered in. The post-booking
  // summary below (formatHourlyWhenLine) switches to the org's own zone,
  // matching RentalBookingFlow's convention for a physical resource.
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  const pickSummary =
    slot && durationMin
      ? `${formatDurationLabel(durationMin)} · ${dayFmt.format(new Date(slot))}, ${timeFmt.format(new Date(slot))}`
      : null;
  const priceLabel = formatOfferingPrice(offering, currency);
  const durationUnits = durationMin === null ? null : durationMin / 60;

  if (doneToken) {
    const summary =
      slot && durationMin
        ? {
            title: offering.name,
            whenLine: formatHourlyWhenLine(
              new Date(slot),
              new Date(new Date(slot).getTime() + durationMin * 60_000),
              orgTimeZone,
            ),
          }
        : undefined;
    return <BookingConfirmed token={doneToken} summary={summary} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {offering.name}{" "}
          {onBack ? (
            <button type="button" className="text-muted-foreground underline" onClick={onBack}>
              change
            </button>
          ) : null}
        </p>
        {priceLabel ? (
          <span className="text-muted-foreground shrink-0 text-xs">{priceLabel}</span>
        ) : null}
      </div>

      {!durationMin ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">How long?</p>
          {options.length <= MAX_PILL_OPTIONS ? (
            <div className="flex flex-wrap gap-2">
              {options.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="wt-surface"
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
              {options.map((d) => (
                <option key={d} value={d}>
                  {formatDurationLabel(d)}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : !slot ? (
        <TimeSlotGrid
          slots={slots.map((s) => s.startsAt)}
          fromDate={fromDate}
          todayISO={todayISO()}
          pending={pending}
          orgTimeZone={orgTimeZone}
          onNavigate={navigate}
          onPick={setSlot}
          regionRef={slotsRegionRef}
          headerSlot={
            <p className="text-sm font-medium">
              {formatDurationLabel(durationMin)}{" "}
              {options.length > 1 ? (
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => changeDuration(null)}
                >
                  change
                </button>
              ) : null}
            </p>
          }
        />
      ) : needsUnitStep ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {pickSummary}{" "}
            <button type="button" className="text-muted-foreground underline" onClick={backToTime}>
              change
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is free for that time any more — please pick again.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {eligibleUnits.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setUnitId(u.id)}
                    className="wt-surface flex w-full flex-col items-start gap-0.5 rounded-md border px-4 py-3 text-left text-sm"
                  >
                    <span className="font-medium">{u.name}</span>
                    {u.description ? (
                      <span className="text-muted-foreground text-xs">{u.description}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form action={submit} className="flex flex-col gap-4">
          <p className="text-sm">
            {pickSummary}{" "}
            <button type="button" className="text-muted-foreground underline" onClick={backToTime}>
              change
            </button>
          </p>
          {offering.unitSelection === "client_picks" && unitId ? (
            <p className="text-sm">
              <span className="font-medium">
                {units.find((u) => u.id === unitId)?.name ?? "Selected"}
              </span>{" "}
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => setUnitId(null)}
              >
                change
              </button>
            </p>
          ) : null}
          <ClientDetailsFields idPrefix="hourly-" />
          <BookingMoneySummary
            offering={offering}
            currency={currency}
            units={durationUnits}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            idPrefix="hourly-"
          />
          <Button type="submit" className="wt-primary" disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
