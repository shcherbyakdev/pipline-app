"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { asEngineOffering, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { addMonths, monthOf } from "@/features/rentals/calendar-grid";
import { formatOfferingPrice, stayUnits } from "@/features/rentals/pricing";
import { getRangeAvailability, createRentalBooking } from "@/features/rentals/public-actions";
import { RangePicker, staySummary, type RangeValue } from "./range-picker";
import { NextFreeStays } from "./next-free-stays";
import { stayFetchWindow } from "@/features/rentals/stay-window";
import { StayFields } from "./stay-fields";
import type { StayLayout } from "@/lib/widget-theme";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { BookingMoneySummary } from "./booking-money-summary";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RentalBookingFlow({
  handle,
  orgTimeZone,
  offering,
  currency,
  onBack,
  stayLayout = "one-month",
  preview,
}: {
  handle: string;
  orgTimeZone: string;
  offering: PublicOffering;
  currency: string;
  onBack: (() => void) | null;
  /** How the stay is picked — the stays template (spec §8). */
  stayLayout?: StayLayout;
  /** Admin live previews: canned availability, never a fetch. */
  preview?: { availability: RangeAvailability };
}) {
  const t = useTranslations("public.widget");
  const tu = useTranslations("public.units");
  const [month, setMonth] = React.useState(() => monthOf(preview ? preview.availability.notBefore : todayISO()));
  const [availability, setAvailability] = React.useState<RangeAvailability | null>(preview?.availability ?? null);
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [range, setRange] = React.useState<RangeValue>({ start: null, end: null });
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  // Whether the RPC left it pending (the space requires approval) — the done
  // panel says "Request sent" instead of "Booking confirmed".
  const [donePending, setDonePending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  // Request-ordering guard: a fast month-nav click can fire a second fetch
  // before the first resolves — only the most recent request may ever apply
  // its result.
  const seqRef = React.useRef(0);
  // The window the current availability covers: a re-render that needs the
  // same window (a check-in picked inside the shown month) does not refetch.
  const fetchedRef = React.useRef<string | null>(null);
  const months: 1 | 2 = stayLayout === "two-months" ? 2 : 1;

  // Deliberately does NOT clear `error`: the datesTaken path re-loads
  // availability *and* wants its message to survive the reload. `force`
  // is that path: the same window, fetched again.
  const load = React.useCallback(
    (m: string, start: string | null, force = false) => {
      if (preview) return;
      const w = stayFetchWindow({ shown: m, months, start, turnoverDays: offering.turnoverDays });
      const key = `${w.from}:${w.days}`;
      if (!force && fetchedRef.current === key) return;
      fetchedRef.current = key;
      startTransition(async () => {
        const seq = ++seqRef.current;
        const result = await getRangeAvailability({
          handle,
          offeringId: offering.id,
          fromDate: w.from,
          days: w.days,
        });
        if (seq !== seqRef.current) return;
        if (result.ok) {
          setAvailability(result.availability);
          setUnits(result.units);
        } else {
          setAvailability(null);
          setError(result.error);
        }
      });
    },
    [handle, offering.id, offering.turnoverDays, months, preview],
  );

  React.useEffect(() => {
    load(month, range.start);
  }, [month, range.start, load]);

  function changeMonth(m: string) {
    setError(null);
    setMonth(m);
  }

  function changeRange(next: RangeValue) {
    setError(null);
    setUnitId(null);
    setTermsAccepted(false);
    setRange(next);
  }

  const stay =
    availability && range.start && range.end
      ? validateStay(asEngineOffering(offering), availability, range.start, range.end)
      : null;
  const eligibleUnits =
    stay && stay.ok ? units.filter((u) => stay.unitIds.includes(u.id)) : [];

  function submit(formData: FormData) {
    const { start, end } = range;
    if (!start || !end || preview) return;
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
        termsAccepted,
      });
      if (result.ok) {
        setDoneToken(result.token);
        setDonePending(result.pending);
        return;
      }
      setError(result.error);
      if (result.datesTaken) {
        setRange({ start: null, end: null });
        setUnitId(null);
        setTermsAccepted(false);
        load(month, null, true);
      }
    });
  }

  const summary =
    range.start && range.end ? staySummary(offering, range.start, range.end, orgTimeZone, tu) : null;
  const stayUnitCount =
    range.start && range.end
      ? stayUnits(offering.rangeMode as "nights" | "days", range.start, range.end)
      : null;
  const priceLabel = formatOfferingPrice(offering, currency, tu);

  if (doneToken) {
    return (
      <BookingConfirmed
        token={doneToken}
        summary={summary ? { title: offering.name, whenLine: summary } : undefined}
        pending={donePending}
      />
    );
  }

  // Preview has no units (canned availability only): the details form
  // follows the dates directly, as it does for an auto-assigned space.
  const needsUnitStep = !preview && offering.unitSelection === "client_picks" && !unitId;
  // The earliest month the picker may show: this one — or the canned one.
  const homeMonth = monthOf(preview ? preview.availability.notBefore : todayISO());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {offering.name}{" "}
          {onBack ? (
            <button type="button" className="text-muted-foreground underline" onClick={onBack}>
              {t("change")}
            </button>
          ) : null}
        </p>
        {priceLabel ? (
          <span className="text-muted-foreground shrink-0 text-xs">{priceLabel}</span>
        ) : null}
      </div>

      {!range.end ? (
        stayLayout === "next-free" ? (
          <NextFreeStays
            offering={offering}
            availability={availability}
            loading={pending}
            onPick={(start, end) => changeRange({ start, end })}
            onLater={() => changeMonth(addMonths(month, 2))}
            onSooner={month > homeMonth ? () => changeMonth(homeMonth) : null}
          />
        ) : stayLayout === "fields" ? (
          <StayFields offering={offering} value={range} onChange={changeRange} open={!!preview}>
            <RangePicker
              offering={offering}
              availability={availability}
              loading={pending}
              month={month}
              onMonthChange={changeMonth}
              value={range}
              onChange={changeRange}
              canGoBack={month > homeMonth}
              timeZone={orgTimeZone}
              months={1}
            />
          </StayFields>
        ) : (
          <RangePicker
            offering={offering}
            availability={availability}
            loading={pending}
            month={month}
            onMonthChange={changeMonth}
            value={range}
            onChange={changeRange}
            canGoBack={month > homeMonth}
            timeZone={orgTimeZone}
            months={months}
          />
        )
      ) : needsUnitStep ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {summary}{" "}
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => changeRange({ start: null, end: null })}
            >
              {t("changeDates")}
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("nothingFreeDates")}</p>
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
              {t("change")}
            </button>
          </p>
          {offering.unitSelection === "client_picks" && unitId ? (
            <p className="text-sm">
              <span className="font-medium">
                {units.find((u) => u.id === unitId)?.name ?? t("selected")}
              </span>{" "}
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => setUnitId(null)}
              >
                {t("change")}
              </button>
            </p>
          ) : null}
          <ClientDetailsFields idPrefix="rental-" />
          <BookingMoneySummary
            offering={offering}
            currency={currency}
            units={stayUnitCount}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            idPrefix="rental-"
          />
          <Button type="submit" className="wt-primary" disabled={pending}>
            {pending ? t("sending") : offering.requiresApproval ? t("requestToBook") : t("confirmBooking")}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
