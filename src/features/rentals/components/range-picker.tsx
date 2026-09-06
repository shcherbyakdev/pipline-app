"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import type { UnitsT } from "@/i18n/translator";
import { cn } from "@/lib/utils";
import { CHANGE_LINK, PANEL, STEP_LABEL } from "@/features/booking-page/render/type";
import { PagerDiscs } from "@/features/scheduling/components/slot-layouts/frame";
import type { PublicOffering } from "@/lib/booking/public";
import { asEngineOffering, stayLength, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { addMonths, monthGrid } from "@/features/rentals/calendar-grid";

export type RangeValue = { start: string | null; end: string | null };

// Everything here is org-local by construction — the dates carry no time and
// no zone, so every formatter is pinned to UTC to keep the viewer's own
// timezone from shifting a cell by a day.
function labelFormatters(intlLocale: string) {
  return {
    monthLabelFmt: new Intl.DateTimeFormat(intlLocale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    dayLabelFmt: new Intl.DateTimeFormat(intlLocale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}
const utcDate = (date: string) => new Date(`${date}T00:00:00Z`);
const hhmm = (time: string) => time.slice(0, 5);

// "3 nights · check-in 15:00 · check-out 11:00 (Europe/Berlin)". Rentals never
// convert to the viewer's zone: a check-in time is a wall-clock instruction at
// the property, so it is shown as-is with the org zone named.
export function staySummary(
  offering: PublicOffering,
  start: string,
  end: string,
  timeZone: string,
  tu: UnitsT,
): string {
  const n = stayLength(asEngineOffering(offering).rangeMode, start, end);
  const nights = offering.rangeMode === "nights";
  // RangePicker is nights/days-only (the H2 hourly flow uses its own
  // widget) — both are set (0056 CHECK).
  return tu("summary", {
    length: tu(nights ? "nights" : "days", { count: n }),
    inLabel: tu(nights ? "summaryCheckIn" : "summaryPickup"),
    inTime: hhmm(offering.startTime!),
    outLabel: tu(nights ? "summaryCheckOut" : "summaryReturn"),
    outTime: hhmm(offering.endTime!),
    tz: timeZone,
  });
}

export function RangePicker({
  offering,
  availability,
  loading,
  month,
  onMonthChange,
  value,
  onChange,
  canGoBack,
  timeZone,
  variant = "widget",
  months = 2,
}: {
  offering: PublicOffering;
  availability: RangeAvailability | null;
  loading: boolean;
  month: string;
  onMonthChange: (month: string) => void;
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  canGoBack: boolean;
  timeZone: string;
  // The admin dialogs render the same picker outside the widget's themed
  // shell, where `wt-surface`/`wt-primary` and `--widget-accent` resolve to
  // nothing — they take the app's own palette instead.
  variant?: "widget" | "admin";
  /** The stays templates (spec §8): one grid, or two side by side. */
  months?: 1 | 2;
}) {
  const locale = useLocale();
  const t = useTranslations("public.stay");
  const tSlots = useTranslations("public.slots");
  const tWidget = useTranslations("public.widget");
  const tManage = useTranslations("public.manage");
  const tu = useTranslations("public.units");
  const weekdays = tSlots("weekdays").split(" ");
  const { monthLabelFmt, dayLabelFmt } = React.useMemo(() => labelFormatters(INTL_LOCALES[locale]), [locale]);
  const { start, end } = value;
  const picking = start !== null && end === null;
  const widget = variant === "widget";

  function isDisabled(date: string): boolean {
    if (!availability) return true;
    const day = availability.dates[date];
    // Outside the fetched window, before the notice cut-off, or past the
    // booking window: nothing to offer either way.
    if (!day) return true;
    if (date < availability.notBefore || date > availability.notAfter) return true;
    if (!picking) return day.free === 0;
    // Choosing an end: the start itself stays live so a mis-click can undo
    // itself, everything before it is out, and the rest is whatever the shared
    // engine says about the whole span (min/max stay, turnover, unit overlap).
    if (date === start) return false;
    if (date < start!) return true;
    return !validateStay(asEngineOffering(offering), availability, start!, date).ok;
  }

  function inRange(date: string): boolean {
    return start !== null && end !== null && date > start && date < end;
  }

  function click(date: string) {
    if (isDisabled(date)) return;
    if (!picking) {
      onChange({ start: date, end: null });
      return;
    }
    if (date === start) {
      // A same-date stay is legal in "days" mode (pickup and return on one
      // day); in "nights" mode it never is, so the click means "start over".
      const same = availability && validateStay(asEngineOffering(offering), availability, date, date).ok;
      onChange(same ? { start: date, end: date } : { start: null, end: null });
      return;
    }
    onChange({ start, end: date });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The step prompt leads the picker (aria-live announces the
          check-in → check-out swap) — below the grids it taught the
          two-click model a viewport too late on phones. */}
      <div className="flex items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0">
          {!(start && end) ? (
            <p className="text-sm">
              <span className="font-medium">
                {picking
                  ? t(offering.rangeMode === "nights" ? "pickCheckOut" : "pickReturn")
                  : t(offering.rangeMode === "nights" ? "pickCheckIn" : "pickPickup")}
              </span>{" "}
              <span className="text-muted-foreground">
                {picking ? t("fadedForStay") : t("faded")}
              </span>
            </p>
          ) : null}
        </div>
        <PagerDiscs
          prevDisabled={!canGoBack}
          onPrev={() => onMonthChange(addMonths(month, -1))}
          onNext={() => onMonthChange(addMonths(month, 1))}
          prevLabel={tSlots("prevMonth")}
          nextLabel={tSlots("nextMonth")}
        />
      </div>

      <div aria-live="polite">
        {loading ? <p className="text-muted-foreground text-sm">{tManage("loadingAvailability")}</p> : null}
      </div>

      {/* The month(s) on the soft panel (the widget), or plain in the admin
          dialogs; day cells are flat — a stay is a band, not a row of boxes. */}
      <div className={cn("grid gap-4", months === 2 && "md:grid-cols-2", widget && cn(PANEL, "p-3 sm:p-4"), loading && "opacity-60 transition-opacity duration-150")}>
        {(months === 2 ? [month, addMonths(month, 1)] : [month]).map((m) => (
          <div key={m} className="flex flex-col gap-1">
            <p className={cn(STEP_LABEL, "pb-1 text-center")}>
              {monthLabelFmt.format(utcDate(`${m}-01`))}
            </p>
            <div className="text-muted-foreground grid grid-cols-7 text-center text-xs font-medium">
              {weekdays.map((w) => (
                <span key={w} aria-hidden="true" className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {monthGrid(m)
                .flat()
                .map((date, i) => {
                  if (date === null) return <span key={`pad-${i}`} aria-hidden="true" />;
                  const disabled = isDisabled(date);
                  const selected = date === start || date === end;
                  const between = inRange(date);
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={disabled}
                      aria-disabled={disabled}
                      aria-pressed={selected}
                      aria-label={dayLabelFmt.format(utcDate(date))}
                      onClick={() => click(date)}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md text-center text-sm tabular-nums outline-none transition-[background-color,color] duration-150 ease-strong",
                        "focus-visible:ring-2 focus-visible:ring-[var(--widget-accent)] focus-visible:ring-offset-2",
                        widget
                          ? selected
                            ? "wt-primary font-semibold"
                            : !disabled && !between && "wt-surface font-medium"
                          : selected
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "hover:bg-muted font-medium",
                        disabled && "text-muted-foreground cursor-not-allowed font-normal opacity-40",
                      )}
                      // Inline: the widget theme squares every `rounded-*` class
                      // to r (globals.css), so the band between check-in and
                      // check-out — flat inner cells, the endpoints squared on
                      // the band's side — is drawn here.
                      style={
                        between
                          ? {
                              borderRadius: 0,
                              backgroundColor: `color-mix(in oklab, transparent, ${
                                widget ? "var(--widget-tint, var(--widget-accent))" : "var(--primary)"
                              } 16%)`,
                            }
                          : selected && start && end && start !== end
                            ? date === start
                              ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
                              : { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }
                            : undefined
                      }
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {start && end ? (
        <p className="text-sm">
          <span className="font-medium">{staySummary(offering, start, end, timeZone, tu)}</span>{" "}
          <button type="button" className={CHANGE_LINK} onClick={() => onChange({ start: null, end: null })}>
            {tWidget("change")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
