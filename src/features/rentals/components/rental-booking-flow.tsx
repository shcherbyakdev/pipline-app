"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { validateStay, type RangeAvailability } from "@/features/rentals/range";
import { firstOfMonth, monthOf } from "@/features/rentals/calendar-grid";
import { getRangeAvailability, createRentalBooking } from "@/features/rentals/public-actions";
import { RangePicker, staySummary, type RangeValue } from "./range-picker";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Two rendered months never exceed 62 days; the turnover tail has to come
// along or validateStay would read a missing day as "unavailable" at the far
// edge. The action's own input cap is 93.
function windowDays(offering: PublicOffering): number {
  return Math.min(93, 62 + offering.turnoverDays);
}

export function RentalBookingFlow({
  handle,
  orgTimeZone,
  offering,
  onBack,
}: {
  handle: string;
  orgTimeZone: string;
  offering: PublicOffering;
  onBack: (() => void) | null;
}) {
  const [month, setMonth] = React.useState(() => monthOf(todayISO()));
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [range, setRange] = React.useState<RangeValue>({ start: null, end: null });
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Deliberately does NOT clear `error`: the datesTaken path re-loads
  // availability *and* wants its message to survive the reload.
  const load = React.useCallback(
    (m: string) => {
      startTransition(async () => {
        const result = await getRangeAvailability({
          handle,
          offeringId: offering.id,
          fromDate: firstOfMonth(m),
          days: windowDays(offering),
        });
        if (result.ok) {
          setAvailability(result.availability);
          setUnits(result.units);
        } else {
          setAvailability(null);
          setError(result.error);
        }
      });
    },
    // `offering` is a stable prop object per selection; depending on the
    // whole thing keeps windowDays honest without listing its fields.
    [handle, offering],
  );

  React.useEffect(() => {
    load(month);
  }, [month, load]);

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
    availability && range.start && range.end
      ? validateStay(offering, availability, range.start, range.end)
      : null;
  const eligibleUnits =
    stay && stay.ok ? units.filter((u) => stay.unitIds.includes(u.id)) : [];

  function submit(formData: FormData) {
    const { start, end } = range;
    if (!start || !end) return;
    startTransition(async () => {
      setError(null);
      const result = await createRentalBooking({
        handle,
        offeringId: offering.id,
        unitId: offering.unitSelection === "client_picks" ? unitId : null,
        startDate: start,
        endDate: end,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        note: String(formData.get("note") ?? "") || undefined,
      });
      if (result.ok) {
        setDoneToken(result.token);
        return;
      }
      setError(result.error);
      if (result.datesTaken) {
        setRange({ start: null, end: null });
        setUnitId(null);
        load(month);
      }
    });
  }

  if (doneToken) return <BookingConfirmed token={doneToken} />;

  const needsUnitStep = offering.unitSelection === "client_picks" && !unitId;
  const summary =
    range.start && range.end ? staySummary(offering, range.start, range.end, orgTimeZone) : null;

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
        {offering.priceLabel ? (
          <span className="text-muted-foreground shrink-0 text-xs">{offering.priceLabel}</span>
        ) : null}
      </div>

      {!range.end ? (
        <RangePicker
          offering={offering}
          availability={availability}
          loading={pending}
          month={month}
          onMonthChange={changeMonth}
          value={range}
          onChange={changeRange}
          canGoBack={month > monthOf(todayISO())}
          timeZone={orgTimeZone}
        />
      ) : needsUnitStep ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {summary}{" "}
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => changeRange({ start: null, end: null })}
            >
              change dates
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing is free for those dates any more — please pick again.
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
            {summary}{" "}
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => changeRange({ start: null, end: null })}
            >
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required maxLength={320} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" name="note" maxLength={2000} rows={3} />
          </div>
          <Button type="submit" className="wt-primary" disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
