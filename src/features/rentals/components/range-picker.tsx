"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublicOffering } from "@/lib/booking/public";
import { asEngineOffering, stayLength, validateStay, type RangeAvailability } from "@/features/rentals/range";
import { addMonths, monthGrid } from "@/features/rentals/calendar-grid";

export type RangeValue = { start: string | null; end: string | null };

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
// Everything here is org-local by construction — the dates carry no time and
// no zone, so every formatter is pinned to UTC to keep the viewer's own
// timezone from shifting a cell by a day.
const monthLabelFmt = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayLabelFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
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
): string {
  const n = stayLength(asEngineOffering(offering).rangeMode, start, end);
  const unit = offering.rangeMode === "nights" ? "night" : "day";
  const [inLabel, outLabel] =
    offering.rangeMode === "nights" ? ["check-in", "check-out"] : ["pickup", "return"];
  // RangePicker is nights/days-only (the H2 hourly flow uses its own
  // widget) — both are set (0056 CHECK).
  return `${n} ${unit}${n === 1 ? "" : "s"} · ${inLabel} ${hhmm(offering.startTime!)} · ${outLabel} ${hhmm(offering.endTime!)} (${timeZone})`;
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
}) {
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
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className={widget ? "wt-surface" : undefined}
          disabled={!canGoBack}
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(month, -1))}
        >
          ←
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={widget ? "wt-surface" : undefined}
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(month, 1))}
        >
          →
        </Button>
      </div>

      <div aria-live="polite">
        {loading ? <p className="text-muted-foreground text-sm">Loading availability…</p> : null}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[month, addMonths(month, 1)].map((m) => (
          <div key={m} className="flex flex-col gap-2">
            <p className="text-center text-sm font-medium">
              {monthLabelFmt.format(utcDate(`${m}-01`))}
            </p>
            <div className="text-muted-foreground grid grid-cols-7 gap-1 text-center text-xs">
              {WEEKDAYS.map((w) => (
                <span key={w} aria-hidden="true">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
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
                        "rounded-md border py-1.5 text-center text-sm tabular-nums",
                        widget
                          ? selected
                            ? "wt-primary font-semibold"
                            : "wt-surface"
                          : selected
                            ? "bg-primary text-primary-foreground border-primary font-semibold"
                            : "bg-background hover:bg-muted",
                        disabled && "cursor-not-allowed border-transparent opacity-35",
                      )}
                      style={
                        between
                          ? {
                              backgroundColor: `color-mix(in oklab, transparent, ${
                                widget ? "var(--widget-accent)" : "var(--primary)"
                              } 18%)`,
                            }
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
          <span className="font-medium">{staySummary(offering, start, end, timeZone)}</span>{" "}
          <button
            type="button"
            className="text-muted-foreground underline"
            onClick={() => onChange({ start: null, end: null })}
          >
            change
          </button>
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {picking
            ? `Now pick your ${offering.rangeMode === "nights" ? "check-out" : "return"} date. Faded dates are unavailable for that stay.`
            : `Pick your ${offering.rangeMode === "nights" ? "check-in" : "pickup"} date. Faded dates are unavailable.`}
        </p>
      )}
    </div>
  );
}
