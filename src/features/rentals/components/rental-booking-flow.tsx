"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { asEngineOffering, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { addMonths, monthOf } from "@/features/rentals/calendar-grid";
import { formatOfferingPrice, stayUnits, totalCents } from "@/features/rentals/pricing";
import { getRangeAvailability, createRentalBooking } from "@/features/rentals/public-actions";
import { RangePicker, staySummary, type RangeValue } from "./range-picker";
import { NextFreeStays } from "./next-free-stays";
import { stayFetchWindow } from "@/features/rentals/stay-window";
import { StayFields } from "./stay-fields";
import type { StayLayout } from "@/lib/widget-theme";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { BookingMoneySummary } from "./booking-money-summary";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, RECEIPT, ROW, ROW_LIST, STEP_LABEL } from "@/features/booking-page/render/type";

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
  const tStay = useTranslations("public.stay");
  // Org-local dates carry no zone: pinned to UTC like the picker's own
  // formatters so the viewer's zone never shifts a day.
  const rangeFmt = new Intl.DateTimeFormat(INTL_LOCALES[useLocale()], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
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
  // follows the dates directly, as it does for an auto-assigned space. So
  // does a single-unit space — there is nothing to pick (`!== 1`, not
  // `> 1`: while units are still loading the step stays put, so a
  // multi-unit space never flashes the details form first).
  const needsUnitStep =
    !preview && offering.unitSelection === "client_picks" && units.length !== 1 && !unitId;
  // The earliest month the picker may show: this one — or the canned one.
  const homeMonth = monthOf(preview ? preview.availability.notBefore : todayISO());

  return (
    // The space channel's tint (widget-theme.ts): green open days for an org
    // without an accent of its own.
    <div className="flex flex-col gap-6" style={{ "--widget-tint": "var(--widget-tint-space)" } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-3">
        <p className={cn(STEP_LABEL, "min-w-0")}>
          {offering.name}{" "}
          {onBack ? (
            <button type="button" className={CHANGE_LINK} onClick={onBack}>
              {t("change")}
            </button>
          ) : null}
        </p>
        {priceLabel ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{priceLabel}</span>
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
        <div className="wt-enter flex flex-col gap-3">
          <p className={STEP_LABEL}>
            {summary}{" "}
            <button type="button" className={CHANGE_LINK} onClick={() => changeRange({ start: null, end: null })}>
              {t("changeDates")}
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("nothingFreeDates")}</p>
          ) : (
            <ul className={ROW_LIST}>
              {eligibleUnits.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setUnitId(u.id)} className={ROW}>
                    <span className="min-w-0">
                      <span className="block font-medium">{u.name}</span>
                      {u.description ? (
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">{u.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <form
          // onSubmit rather than action: React resets an action form's fields
          // when the action settles, so a refused booking (rate limit, a slot
          // just taken) would wipe the name and email the visitor typed.
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
          className="wt-enter flex flex-col gap-4"
        >
          {/* The receipt: the stay restated, with the way back. */}
          <div className={RECEIPT}>
            <div className="min-w-0">
              {/* The dates first — the summary line names the length and the
                  check-in/out times, never the days themselves. */}
              <p className="font-medium tabular-nums">
                {tStay("range", { start: rangeFmt.format(new Date(`${range.start}T00:00:00Z`)), end: rangeFmt.format(new Date(`${range.end}T00:00:00Z`)) })}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">{summary}</p>
              {offering.unitSelection === "client_picks" && unitId ? (
                <p className="mt-0.5">
                  {units.find((u) => u.id === unitId)?.name ?? t("selected")}{" "}
                  <button type="button" className={cn(CHANGE_LINK, "text-xs")} onClick={() => setUnitId(null)}>
                    {t("change")}
                  </button>
                </p>
              ) : null}
            </div>
            <button type="button" className={cn(CHANGE_LINK, "shrink-0")} onClick={() => changeRange({ start: null, end: null })}>
              {t("change")}
            </button>
          </div>
          <ClientDetailsFields idPrefix="rental-" />
          <BookingMoneySummary
            offering={offering}
            currency={currency}
            lines={null}
            totalCents={stayUnitCount === null ? null : totalCents(offering, stayUnitCount)}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            idPrefix="rental-"
          />
          <Button type="submit" size="lg" className="wt-primary mt-1 w-full" disabled={pending}>
            {pending ? t("sending") : offering.requiresApproval ? t("requestToBook") : t("confirmBooking")}
          </Button>
        </form>
      )}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
