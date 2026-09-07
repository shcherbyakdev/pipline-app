"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import type { PublicOffering } from "@/lib/booking/public";
import type { RangeValue } from "./range-picker";

// Org-local dates: pinned to UTC like every formatter around the range
// picker so the viewer's zone never shifts a day.
const fieldFormatter = (intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const utcDate = (d: string) => new Date(`${d}T00:00:00Z`);

/* The "Check-in and check-out fields" template (spec §8): two fields at the
   top; tapping one opens the month grid (the children) beneath them. The
   grid closes on its own once both dates are set — the flow moves on. */
export function StayFields({
  offering, value, onChange, open: openByDefault = false, children,
}: {
  offering: PublicOffering;
  value: RangeValue;
  onChange: (next: RangeValue) => void;
  /** Previews open the grid at once so the template reads as itself. */
  open?: boolean;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("public.stay");
  const fieldFmt = React.useMemo(() => fieldFormatter(INTL_LOCALES[locale]), [locale]);
  const [open, setOpen] = React.useState(openByDefault);
  const [inLabel, outLabel] =
    offering.rangeMode === "nights" ? [t("checkIn"), t("checkOut")] : [t("pickup"), t("return")];
  const field = (label: string, date: string | null, active: boolean) => (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => {
        // Tapping a filled check-out means "start over"; a check-in tap
        // keeps a picked start so the visitor can go on to the end.
        if (label === outLabel && value.start && value.end) onChange({ start: null, end: null });
        setOpen(true);
      }}
      // The product's input: card fill on the hairline, the accent ring on
      // the field being filled.
      className={cn(
        "wt-chip flex flex-col items-start gap-0.5 rounded-md border px-3.5 py-2.5 text-left transition-[box-shadow] duration-150 ease-strong",
        active && "ring-2 ring-[var(--widget-accent)]",
      )}
    >
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className={cn("text-sm tabular-nums", date ? "font-medium" : "text-muted-foreground")}>{date ? fieldFmt.format(utcDate(date)) : t("addDate")}</span>
    </button>
  );
  const picking = value.start !== null && value.end === null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {field(inLabel, value.start, open && !picking)}
        {field(outLabel, value.end, open && picking)}
      </div>
      {open ? children : null}
    </div>
  );
}
