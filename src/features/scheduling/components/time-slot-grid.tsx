"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { PAGE_DAYS, shiftDays } from "@/features/scheduling/slot-paging";
import { INTL_LOCALES } from "@/i18n/config";

export function TimeSlotGrid({
  slots,
  fromDate,
  todayISO,
  pending,
  orgTimeZone,
  onNavigate,
  onPick,
  regionRef,
  toolbar,
  emptyHint,
  headerSlot,
}: {
  slots: string[]; // ISO instants
  fromDate: string; // viewer-local YYYY-MM-DD, 7-day page
  todayISO: string;
  pending: boolean;
  orgTimeZone: string;
  onNavigate: (nextFromDate: string) => void;
  onPick: (iso: string) => void;
  regionRef?: React.Ref<HTMLDivElement>;
  /** A row of its own between the header and the times — the person switch. */
  toolbar?: React.ReactNode;
  /** Replaces the default "No free times this week — try the next." */
  emptyHint?: string;
  /** Rendered left of the nav buttons, in the original single-row layout
      (justify-between). Omit for a standalone nav row — a caller with no
      header content to place there gets today's layout either way, since
      justify-between with one child packs to flex-start. */
  headerSlot?: React.ReactNode;
}): React.JSX.Element {
  const t = useTranslations("public.slots");
  const intl = INTL_LOCALES[useLocale()];
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Intentionally duplicated, not shared with booking-widget.tsx's own
  // dayFmt/timeFmt (used there for the post-pick confirmation step) — two
  // cheap Intl formatters beat threading them through as props.
  const dayFmt = new Intl.DateTimeFormat(intl, { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit" });
  const tzShortFmt = new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

  // Group by the VIEWER's local date, not the UTC date — a late-evening
  // slot in the viewer's zone must appear under the day they'd call it.
  const viewerDayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Only this page's seven viewer-local days: the server pads its window a
  // day each side so no day is missed across the org/viewer offset.
  const lastDay = shiftDays(fromDate, PAGE_DAYS - 1);
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = viewerDayKey.format(new Date(s));
    if (day < fromDate || day > lastDay) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  // A DST fall-back day shows the same HH:MM twice (02:00 CEST, 02:00 CET);
  // disambiguate those labels with the zone name, and only those.
  const timeLabel = (iso: string, daySlots: string[]) => {
    const base = timeFmt.format(new Date(iso));
    const dup = daySlots.some((o) => o !== iso && timeFmt.format(new Date(o)) === base);
    return dup ? `${base} ${tzShortFmt.format(new Date(iso)).split(" ").pop()}` : base;
  };

  return (
    // Bare fragment: every top-level child here is meant to lay out as a
    // direct row of the parent's `flex flex-col gap-*` — no wrapper of our
    // own that would introduce an extra gap or nesting level.
    <>
      <div className="flex items-center justify-between">
        {headerSlot}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            className="wt-surface"
            aria-label={t("prevWeek")}
            title={t("prevWeek")}
            disabled={fromDate <= todayISO}
            onClick={() => onNavigate(shiftDays(fromDate, -PAGE_DAYS))}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="wt-surface"
            aria-label={t("nextWeek")}
            title={t("nextWeek")}
            onClick={() => onNavigate(shiftDays(fromDate, PAGE_DAYS))}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
          </Button>
        </div>
      </div>
      {toolbar}
      {/* While a new week loads, the previous list stays put (dimmed) so
          the region doesn't collapse and re-expand — no flash. */}
      <div
        ref={regionRef}
        tabIndex={-1}
        aria-live="polite"
        aria-busy={pending || undefined}
        className={
          // outline-none: focus arrives programmatically after a duration
          // pick; the UA ring would box the whole week — the visible rings
          // belong on the slot buttons.
          pending
            ? "flex flex-col gap-4 opacity-60 outline-none transition-opacity"
            : "flex flex-col gap-4 outline-none"
        }
      >
        {pending && byDay.size === 0 ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : byDay.size === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyHint ?? t("emptyWeek")}</p>
        ) : (
          [...byDay.entries()].map(([day, daySlots]) => (
            <div key={day} className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs font-medium">
                {dayFmt.format(new Date(daySlots[0]))}
              </p>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="wt-surface"
                    onClick={() => onPick(s)}
                    aria-label={`${dayFmt.format(new Date(s))}, ${timeLabel(s, daySlots)}`}
                  >
                    {timeLabel(s, daySlots)}
                  </Button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("viewerTz", { tz: viewerTz })}</p>
      {viewerTz !== orgTimeZone ? (
        <p className="text-muted-foreground text-xs">{t("orgTz", { tz: orgTimeZone })}</p>
      ) : null}
    </>
  );
}
