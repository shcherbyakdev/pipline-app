"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addMonths, monthGrid, monthOf } from "@/features/rentals/calendar-grid";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";

/* The app's one single-date picker (TimeCombobox's date twin): a trigger
   styled like Input wearing a month-grid popover, replacing the browser's
   native date input everywhere in the admin. Dates are plain "YYYY-MM-DD"
   strings on calendar-grid's UTC-pinned helpers — no timezone can shift a
   cell. Range selection stays RangePicker's job. */

// Formatters follow the admin's language (INTL_LOCALES[locale]); UTC-pinned.
const monthLabelFmt = (l: string) => new Intl.DateTimeFormat(l, { month: "long", year: "numeric", timeZone: "UTC" });
const triggerFmt = (l: string) => new Intl.DateTimeFormat(l, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayAriaFmt = (l: string) =>
  new Intl.DateTimeFormat(l, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

export function DatePicker({
  value,
  onCommit,
  label,
  id,
  min,
  disabled,
  className,
}: {
  /** "YYYY-MM-DD", or "" for nothing picked yet. */
  value: string;
  onCommit: (date: string) => void;
  label: string;
  id?: string;
  /** Earliest selectable date (inclusive). */
  min?: string;
  disabled?: boolean;
  /** Trigger overrides — e.g. the dialog pill (dialogPillClass). */
  className?: string;
}) {
  const t = useTranslations("bookings");
  const intlLocale = INTL_LOCALES[useLocale()];
  const weekdays = t("weekdays").split(" ");
  const [open, setOpen] = React.useState(false);
  const startMonth = () => monthOf(value || min || new Date().toISOString().slice(0, 10));
  const [month, setMonth] = React.useState(startMonth);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setMonth(startMonth());
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-label={label}
            className={cn(
              // Input's metrics so it sits flush beside inputs in a row.
              "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 flex h-8 items-center rounded-lg border px-2.5 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {value ? triggerFmt(intlLocale).format(utcDate(value)) : t("datePicker.pick")}
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="pl-1 text-sm font-medium">{monthLabelFmt(intlLocale).format(utcDate(`${month}-01`))}</p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("datePicker.prevMonth")}
              // No use navigating wholly before the floor.
              disabled={min !== undefined && month <= monthOf(min)}
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("datePicker.nextMonth")}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="text-muted-foreground grid grid-cols-7 text-center text-xs">
          {weekdays.map((w) => (
            <span key={w} aria-hidden className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {monthGrid(month)
            .flat()
            .map((date, i) =>
              date === null ? (
                <span key={`pad-${i}`} aria-hidden />
              ) : (
                <button
                  key={date}
                  type="button"
                  disabled={min !== undefined && date < min}
                  aria-label={dayAriaFmt(intlLocale).format(utcDate(date))}
                  aria-current={date === value ? "date" : undefined}
                  onClick={() => {
                    onCommit(date);
                    setOpen(false);
                  }}
                  className={cn(
                    "hover:bg-muted size-8 rounded-md text-sm tabular-nums",
                    date === value && "bg-primary text-primary-foreground hover:bg-primary",
                    min !== undefined && date < min && "cursor-not-allowed opacity-35 hover:bg-transparent",
                  )}
                >
                  {Number(date.slice(8, 10))}
                </button>
              ),
            )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
