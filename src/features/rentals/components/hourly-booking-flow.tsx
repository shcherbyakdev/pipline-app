"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import type { PublicOffering, PublicUnit } from "@/lib/booking/public";
import { durationOptions, formatDurationLabel, type HourlyOffering } from "@/features/rentals/hourly";
import { formatOfferingPrice, totalCents } from "@/features/rentals/pricing";
import { formatMoney } from "@/lib/money";
import { getHourlySlots, createRentalBookingHours } from "@/features/rentals/hourly-actions";
import { formatHourlyWhenLine } from "@/features/scheduling/templates";
import { SlotPicker } from "@/features/scheduling/components/slot-layouts/slot-picker";
import { firstDayBeyond, firstLookDays, homeWindow, windowAround, type SlotWindow } from "@/features/scheduling/slot-paging";
import type { SlotLayout } from "@/lib/widget-theme";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { BookingMoneySummary } from "./booking-money-summary";

// offering-dialog.tsx's native-<select> idiom.
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

// Above this many options a pill row would wrap onto several lines and eat
// into the embed's height budget — offering-dialog's own increment picker
// draws the same line at a handful of options.
const MAX_PILL_OPTIONS = 8;

const viewerDayFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
const viewerDay = (iso: string) => viewerDayFmt.format(new Date(iso));
function todayISO(): string {
  return viewerDayFmt.format(new Date());
}

type HourlySlot = { startsAt: string; unitIds: string[] };

export function HourlyBookingFlow({
  handle,
  orgTimeZone,
  offering,
  currency,
  onBack,
  layout = "calendar",
  preview,
}: {
  handle: string;
  orgTimeZone: string;
  offering: PublicOffering;
  currency: string;
  onBack: (() => void) | null;
  /** How start times are shown — shared with the appointment widget (spec §8). */
  layout?: SlotLayout;
  /** Admin live previews: canned start times, never a fetch. */
  preview?: { slots: string[] };
}) {
  // The widget branch only ever hands this component an hours offering
  // (booking-widget.tsx's rangeMode check) — the trio is guaranteed set
  // (0056 CHECK).
  const hourly = offering as HourlyOffering;
  const options = React.useMemo(() => durationOptions(hourly), [hourly]);
  const intlLocale = INTL_LOCALES[useLocale()];
  const t = useTranslations("public.widget");
  const tStay = useTranslations("public.stay");
  const tu = useTranslations("public.units");

  // Preview opens straight on the times (the shortest duration): the cards
  // are about how times show, not about the duration step.
  const [durationMin, setDurationMin] = React.useState<number | null>(
    options.length === 1 || preview ? options[0] : null,
  );
  // The layout's home window — or, in preview, the one holding the canned
  // slots (booking-widget.tsx's home()).
  const home = (): SlotWindow => {
    const today = todayISO();
    if (!preview) return homeWindow(layout, today);
    const first = firstDayBeyond(preview.slots, homeWindow(layout, today), viewerDay) ?? today;
    return windowAround(layout, first, today);
  };
  const [win, setWin] = React.useState<SlotWindow>(home);
  // False until the visitor pages (or the first look jumped ahead): the
  // fetch for a fresh duration spans firstLookDays and may move the window
  // to the one holding the first free time (booking-widget.tsx's rule).
  const [navigated, setNavigated] = React.useState(false);
  const [slots, setSlots] = React.useState<HourlySlot[]>(() => (preview ? preview.slots.map((startsAt) => ({ startsAt, unitIds: [] })) : []));
  const [units, setUnits] = React.useState<PublicUnit[]>([]);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  // Whether the RPC left it pending (the space requires approval) — the done
  // panel says "Request sent" instead of "Booking confirmed".
  const [donePending, setDonePending] = React.useState(false);
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
    if (!durationMin || preview) return;
    startTransition(async () => {
      const seq = ++seqRef.current;
      const firstLook = !navigated;
      const res = await getHourlySlots({
        handle,
        offeringId: offering.id,
        durationMin,
        fromDate: win.from,
        days: firstLook ? firstLookDays(win) : win.days,
        unitId: offering.unitSelection === "client_picks" ? unitId : null,
      });
      if (seq !== seqRef.current) return;
      if (res.ok) {
        setSlots(res.slots);
        setUnits(res.units);
        // Booked out here? Open on the window holding the first free time —
        // one round trip instead of a "try the next" click per empty page.
        if (firstLook) {
          const target = firstDayBeyond(res.slots.map((s) => s.startsAt), win, viewerDay);
          if (target) {
            setWin(windowAround(layout, target, todayISO()));
            setNavigated(true);
          }
        }
      } else {
        setSlots([]);
        setError(res.error);
      }
    });
  }, [handle, offering.id, offering.unitSelection, durationMin, win, navigated, unitId, preview, layout]);

  React.useEffect(() => {
    load();
  }, [load]);

  // A layout change (the studio's previews switch it live) opens the fresh
  // layout on its own home window — booking-widget.tsx's render-time adjust.
  const [appliedLayout, setAppliedLayout] = React.useState(layout);
  if (layout !== appliedLayout) {
    setAppliedLayout(layout);
    setWin(home());
    setNavigated(false);
    setSlot(null);
  }

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
      // A fresh duration takes a fresh first look from the home window.
      setWin(home());
      setNavigated(false);
    });
    slotsRegionRef.current?.focus();
  }

  function navigate(next: SlotWindow) {
    setError(null);
    setWin(next);
    setNavigated(true);
  }

  function backToTime() {
    setError(null);
    setSlot(null);
    setUnitId(null);
    setTermsAccepted(false);
  }

  const matchingSlot = slot ? slots.find((s) => s.startsAt === slot) : undefined;
  const eligibleUnits = matchingSlot ? units.filter((u) => matchingSlot.unitIds.includes(u.id)) : [];
  // Preview has no units (canned slots only): the details form follows the
  // time directly, as it does for an auto-assigned space — and for a
  // single-unit one, which has nothing to pick (`!== 1` so a multi-unit
  // space keeps the step while its units load; see rental-booking-flow).
  const needsUnitStep =
    !preview && offering.unitSelection === "client_picks" && units.length !== 1 && !!slot && !unitId;

  function submit(formData: FormData) {
    if (!slot || !durationMin || preview) return;
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
        setDonePending(result.pending);
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
  const dayFmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit" });
  const pickSummary =
    slot && durationMin
      ? `${formatDurationLabel(durationMin, tu)} · ${dayFmt.format(new Date(slot))}, ${timeFmt.format(new Date(slot))}`
      : null;
  const priceLabel = formatOfferingPrice(offering, currency, tu);
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
              intlLocale,
            ),
          }
        : undefined;
    return <BookingConfirmed token={doneToken} summary={summary} pending={donePending} />;
  }

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

      {!durationMin ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{tStay("howLong")}</p>
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
                  {formatDurationLabel(d, tu)}
                  {/* Price tracks the choice (per-hour offerings only — a
                      flat price is the same on every pill and says nothing). */}
                  {hourly.pricingMode === "per_unit" && hourly.priceCents !== null ? (
                    <span className="text-muted-foreground">
                      · {formatMoney(totalCents(hourly, d / 60)!, currency)}
                    </span>
                  ) : null}
                </Button>
              ))}
            </div>
          ) : (
            <select
              aria-label={tStay("duration")}
              className={selectClass}
              defaultValue=""
              onChange={(e) => changeDuration(Number(e.target.value))}
            >
              <option value="" disabled>
                {tStay("chooseDuration")}
              </option>
              {options.map((d) => (
                <option key={d} value={d}>
                  {formatDurationLabel(d, tu)}
                  {hourly.pricingMode === "per_unit" && hourly.priceCents !== null
                    ? ` · ${formatMoney(totalCents(hourly, d / 60)!, currency)}`
                    : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : !slot ? (
        <SlotPicker
          layout={layout}
          slots={slots.map((s) => s.startsAt)}
          window={win}
          today={todayISO()}
          pending={pending}
          orgTimeZone={orgTimeZone}
          onNavigate={navigate}
          onPick={setSlot}
          regionRef={slotsRegionRef}
          headerSlot={
            <p className="text-sm font-medium">
              {formatDurationLabel(durationMin, tu)}{" "}
              {options.length > 1 ? (
                <button
                  type="button"
                  className="text-muted-foreground underline"
                  onClick={() => changeDuration(null)}
                >
                  {t("change")}
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
              {t("change")}
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("nothingFreeTime")}</p>
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
          <ClientDetailsFields idPrefix="hourly-" />
          <BookingMoneySummary
            offering={offering}
            currency={currency}
            units={durationUnits}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            idPrefix="hourly-"
          />
          <Button type="submit" className="wt-primary" disabled={pending || !!preview}>
            {preview ? t("preview") : pending ? t("sending") : offering.requiresApproval ? t("requestToBook") : t("confirmBooking")}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
