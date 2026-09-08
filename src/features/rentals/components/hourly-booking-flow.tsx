"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Minus, Plus } from "lucide-react";
import { INTL_LOCALES } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import type { PublicEquipment, PublicOffering, PublicUnit } from "@/lib/booking/public";
import { durationOptions, formatDurationLabel, freeUnitsAt, type HourlyOffering } from "@/features/rentals/hourly";
import { equipmentLines, quoteHours, sumLines, headlinePrice } from "@/features/rentals/pricing";
import type { EquipmentPick, ExtraPick } from "@/features/rentals/pricing-rules";
import { formatMoney } from "@/lib/money";
import { getHourlySlots, createRentalBookingHours } from "@/features/rentals/hourly-actions";
import { formatHourlyWhenLine } from "@/features/scheduling/templates";
import { SlotPicker } from "@/features/scheduling/components/slot-layouts/slot-picker";
import { firstDayBeyond, firstLookDays, homeWindow, windowAround, type SlotWindow } from "@/features/scheduling/slot-paging";
import type { SlotLayout } from "@/lib/widget-theme";
import { BookingConfirmed } from "@/features/scheduling/components/booking-confirmed";
import { ClientDetailsFields } from "@/features/scheduling/components/client-details-fields";
import { BookingMoneySummary } from "./booking-money-summary";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, CHIP, RECEIPT, ROW, ROW_LIST, STEP_LABEL } from "@/features/booking-page/render/type";

// offering-form.tsx's native-<select> idiom, on the widget's chip surface.
const selectClass = "wt-chip h-9 rounded-md border px-3 text-sm";

// Above this many options a pill row would wrap onto several lines and eat
// into the embed's height budget — offering-form's own increment picker
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
  // S1: null people = the offering's included count; [] extras = none picked.
  const [people, setPeople] = React.useState<number | null>(null);
  const [extras, setExtras] = React.useState<ExtraPick[]>([]);
  // S6: equipment add-ons — the picks, and what the org offers with its
  // busy time (so a row can say how many are free at the chosen slot).
  const [equipment, setEquipment] = React.useState<EquipmentPick[]>([]);
  const [equipmentDefs, setEquipmentDefs] = React.useState<PublicEquipment[]>([]);
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  // Whether the RPC left it pending (the space requires approval) — the done
  // panel says "Request sent" instead of "Booking confirmed".
  const [donePending, setDonePending] = React.useState(false);
  // S2: the RPC held it for a deposit — the panel offers the pay link instead.
  const [donePayment, setDonePayment] = React.useState<{ until: string; amount: string } | null>(null);
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
        setEquipmentDefs(res.equipment);
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
      setPeople(null);
      setExtras([]);
      setEquipment([]);
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
    setPeople(null);
    setExtras([]);
    setEquipment([]);
  }

  // S6: a fresh time has its own free counts — the picks start over rather
  // than being silently re-capped against it.
  function pickSlot(iso: string) {
    setSlot(iso);
    setEquipment([]);
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
        people,
        extras,
        equipment,
      });
      if (result.ok) {
        setDoneToken(result.token);
        setDonePending(result.pending);
        setDonePayment(result.payment ?? null);
        return;
      }
      setError(result.error);
      // S1: the RPC couldn't work out a quote (duration/people/extras drifted
      // from what the offering's rules now allow) — reset the picks and let
      // the error stand so the client can retry with the defaults.
      if (result.quote) {
        setPeople(null);
        setExtras([]);
        setEquipment([]);
      }
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
  const priceLabel = headlinePrice(offering, currency, tu);

  // The pill/option price (base only, no people/extras yet): "from …" once
  // the offering carries a surcharge (the base band alone would understate
  // it), else the plain amount. A flat/unpriced offering shows nothing on
  // its pills, as before S1 (quoteHours's flat-mode line is one constant
  // amount regardless of duration, which would say nothing useful here).
  const pillPrice = (d: number) => {
    if (hourly.pricing === null && hourly.pricingMode === "flat") return null;
    try {
      const lines = quoteHours(hourly, new Date(), d, null, [], orgTimeZone).filter((l) => l.kind === "base");
      if (lines.length === 0) return null;
      const amount = formatMoney(sumLines(lines), currency);
      return hourly.pricing?.surcharges.length ? tu("from", { amount }) : amount;
    } catch {
      // A duration below the rules' first band throws quote_band — no price
      // for that pill rather than a broken render.
      return null;
    }
  };

  // S1: the live itemised quote once a slot is picked — recomputes with
  // every people/extras change so the confirm step always shows what
  // submit is about to charge.
  const quote = React.useMemo(() => {
    if (!slot || !durationMin) return null;
    try {
      return [
        ...quoteHours(hourly, new Date(slot), durationMin, people, extras, orgTimeZone),
        // S6: same try — a quote_equipment throw is the live rules refusing
        // this pick, exactly like the S1 sentinels.
        ...equipmentLines(equipmentDefs, equipment, durationMin),
      ];
    } catch {
      return null;
    }
  }, [hourly, slot, durationMin, people, extras, equipment, equipmentDefs, orgTimeZone]);

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
    return <BookingConfirmed token={doneToken} summary={summary} pending={donePending} payment={donePayment} />;
  }

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

      {!durationMin ? (
        <div className="wt-enter flex flex-col gap-2">
          <p className={STEP_LABEL}>{tStay("howLong")}</p>
          {options.length <= MAX_PILL_OPTIONS ? (
            <div className="flex flex-wrap gap-2">
              {options.map((d) => {
                // Price tracks the choice — rules-priced or per-hour
                // offerings only; a flat price is the same on every pill
                // and says nothing (pillPrice already returns null there).
                const price = pillPrice(d);
                return (
                  <Button
                    key={d}
                    type="button"
                    variant="outline"
                    className={cn(CHIP, "h-9 px-3.5 tabular-nums")}
                    onClick={() => changeDuration(d)}
                  >
                    {formatDurationLabel(d, tu)}
                    {price ? <span className="text-muted-foreground">· {price}</span> : null}
                  </Button>
                );
              })}
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
                  {pillPrice(d) ? ` · ${pillPrice(d)}` : ""}
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
          onPick={pickSlot}
          regionRef={slotsRegionRef}
          headerSlot={
            <p className={cn(STEP_LABEL, "min-w-0")}>
              {formatDurationLabel(durationMin, tu)}{" "}
              {options.length > 1 ? (
                <button
                  type="button"
                  className={CHANGE_LINK}
                  onClick={() => changeDuration(null)}
                >
                  {t("change")}
                </button>
              ) : null}
            </p>
          }
        />
      ) : needsUnitStep ? (
        <div className="wt-enter flex flex-col gap-3">
          <p className={STEP_LABEL}>
            <span className="tabular-nums">{pickSummary}</span>{" "}
            <button type="button" className={CHANGE_LINK} onClick={backToTime}>
              {t("change")}
            </button>
          </p>
          {eligibleUnits.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("nothingFreeTime")}</p>
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
          {/* The receipt: the pick restated, with the way back. */}
          <div className={RECEIPT}>
            <div className="min-w-0">
              <p className="font-medium tabular-nums">{pickSummary}</p>
              {offering.unitSelection === "client_picks" && unitId ? (
                <p className="mt-0.5">
                  {units.find((u) => u.id === unitId)?.name ?? t("selected")}{" "}
                  <button type="button" className={cn(CHANGE_LINK, "text-xs")} onClick={() => setUnitId(null)}>
                    {t("change")}
                  </button>
                </p>
              ) : null}
            </div>
            <button type="button" className={cn(CHANGE_LINK, "shrink-0")} onClick={backToTime}>
              {t("change")}
            </button>
          </div>
          <ClientDetailsFields idPrefix="hourly-" />
          {hourly.pricing?.people ? (
            <div className="flex items-center justify-between gap-3">
              <span className={STEP_LABEL}>
                {t("people")}{" "}
                <span className="text-muted-foreground">{t("included", { count: hourly.pricing.people.included })}</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("fewer")}
                  disabled={(people ?? hourly.pricing.people.included) <= 1}
                  onClick={() => setPeople((people ?? hourly.pricing!.people!.included) - 1)}
                >
                  <Minus />
                </Button>
                <span className="w-6 text-center tabular-nums">{people ?? hourly.pricing.people.included}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("more")}
                  disabled={(people ?? hourly.pricing.people.included) >= hourly.pricing.people.max}
                  onClick={() => setPeople((people ?? hourly.pricing!.people!.included) + 1)}
                >
                  <Plus />
                </Button>
              </div>
            </div>
          ) : null}
          {hourly.pricing && hourly.pricing.extras.length > 0 ? (
            <ul className={ROW_LIST} aria-label={t("extras")}>
              {hourly.pricing.extras.map((x) => {
                const qty = extras.find((e) => e.id === x.id)?.qty ?? 0;
                const setQty = (q: number) =>
                  setExtras(q <= 0 ? extras.filter((e) => e.id !== x.id) : [...extras.filter((e) => e.id !== x.id), { id: x.id, qty: q }]);
                return (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block">{x.label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatMoney(x.priceCents, currency)} · {x.unit === "hour" ? tu("perHourShort") : tu("perPiece")}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("fewerOf", { label: x.label })}
                        disabled={qty === 0}
                        onClick={() => setQty(qty - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="w-6 text-center tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("moreOf", { label: x.label })}
                        disabled={qty >= x.maxQty}
                        onClick={() => setQty(qty + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {/* S6: the org's equipment, capped by what is actually free at this
              time — a row at zero free still shows, saying so. */}
          {equipmentDefs.length > 0 && slot && durationMin ? (
            <ul className={ROW_LIST} aria-label={t("equipment")}>
              {equipmentDefs.map((eq) => {
                const free = freeUnitsAt(eq.units, new Date(slot), new Date(new Date(slot).getTime() + durationMin * 60_000));
                const qty = equipment.find((e) => e.offeringId === eq.id)?.qty ?? 0;
                const setQty = (q: number) =>
                  setEquipment(
                    q <= 0
                      ? equipment.filter((e) => e.offeringId !== eq.id)
                      : [...equipment.filter((e) => e.offeringId !== eq.id), { offeringId: eq.id, qty: q }],
                  );
                return (
                  <li key={eq.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block">{eq.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatMoney(eq.priceCents ?? 0, currency)} ·{" "}
                        {eq.pricingMode === "flat" ? tu("perBooking") : tu("perHourShort")}
                        {" · "}
                        {free === 0 ? t("noneLeft") : t("available", { count: free })}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("fewerOf", { label: eq.name })}
                        disabled={qty === 0}
                        onClick={() => setQty(qty - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="w-6 text-center tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={t("moreOf", { label: eq.name })}
                        disabled={qty >= free}
                        onClick={() => setQty(qty + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <BookingMoneySummary
            offering={offering}
            currency={currency}
            lines={quote}
            totalCents={quote === null ? null : quote.length === 0 ? null : sumLines(quote)}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            idPrefix="hourly-"
          />
          <Button type="submit" size="lg" className="wt-primary mt-1 w-full" disabled={pending || !!preview}>
            {preview ? t("preview") : pending ? t("sending") : offering.requiresApproval ? t("requestToBook") : t("confirmBooking")}
          </Button>
        </form>
      )}
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
