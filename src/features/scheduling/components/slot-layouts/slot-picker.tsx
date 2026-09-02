"use client";

import * as React from "react";
import { TimeSlotGrid } from "@/features/scheduling/components/time-slot-grid";
import { PAGE_DAYS, shiftWindow, type SlotWindow } from "@/features/scheduling/slot-paging";
import type { SlotLayout } from "@/lib/widget-theme";
import { SlotFrame } from "./frame";
import { groupByViewerDay } from "./group";
import { MonthCalendar } from "./month-calendar";
import { NextAvailable } from "./next-available";
import { WeekColumns } from "./week-columns";

const monthLabelFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
// The window's own dates carry no zone — pinned to UTC so a viewer far east
// of UTC never sees Tuesday's date over a week that starts on Monday.
const weekLabelFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const EMPTY_TEXT: Record<SlotLayout, string> = {
  "week-list": "No free times this week — try the next.",
  "week-columns": "No free times this week — try the next.",
  calendar: "No free times this month — try the next.",
  "next-available": "No free times in these four weeks — try later dates.",
};

/* The one place a list of start times becomes a picker, in the org's
   chosen layout (widget templates spec §2, §8): the appointment widget and
   the hourly-space flow both render this. The caller owns the window and
   the fetch; this owns navigation within the layout's rules and the
   presentation. Week list = TimeSlotGrid as it always was. */
export function SlotPicker({
  layout, slots, window: win, today, pending, orgTimeZone, regionRef, headerSlot, toolbar, emptyHint, onNavigate, onPick,
}: {
  layout: SlotLayout;
  slots: string[];
  window: SlotWindow;
  today: string;
  pending: boolean;
  orgTimeZone: string;
  regionRef?: React.Ref<HTMLDivElement>;
  headerSlot?: React.ReactNode;
  toolbar?: React.ReactNode;
  /** Replaces the layout's own empty line (the four-week first-look wording). */
  emptyHint?: string;
  onNavigate: (next: SlotWindow) => void;
  onPick: (iso: string) => void;
}) {
  const navigate = (dir: -1 | 1) => {
    const next = shiftWindow(layout, win, dir, today);
    if (next) onNavigate(next);
  };
  if (layout === "week-list") {
    return (
      <TimeSlotGrid
        slots={slots}
        fromDate={win.from}
        todayISO={today}
        pending={pending}
        orgTimeZone={orgTimeZone}
        onNavigate={(next) => onNavigate({ from: next, days: PAGE_DAYS })}
        onPick={onPick}
        regionRef={regionRef}
        emptyHint={emptyHint}
        toolbar={toolbar}
        headerSlot={headerSlot}
      />
    );
  }
  const byDay = groupByViewerDay(slots, win);
  const nav =
    layout === "calendar"
      ? { label: monthLabelFmt.format(new Date(`${win.from}T00:00:00Z`)), prevDisabled: !shiftWindow(layout, win, -1, today), onPrev: () => navigate(-1), onNext: () => navigate(1), prevLabel: "Previous month", nextLabel: "Next month" }
      : layout === "week-columns"
        ? { label: `Week of ${weekLabelFmt.format(new Date(`${win.from}T00:00:00Z`))}`, prevDisabled: !shiftWindow(layout, win, -1, today), onPrev: () => navigate(-1), onNext: () => navigate(1), prevLabel: "Previous week", nextLabel: "Next week" }
        : null;
  return (
    <SlotFrame headerSlot={headerSlot} toolbar={toolbar} nav={nav} pending={pending} empty={byDay.size === 0} emptyText={emptyHint ?? EMPTY_TEXT[layout]} regionRef={regionRef} orgTimeZone={orgTimeZone}>
      {layout === "calendar" ? (
        // Keyed by the window: a new month starts on its first free day.
        <MonthCalendar key={win.from} byDay={byDay} window={win} today={today} onPick={onPick} />
      ) : layout === "week-columns" ? (
        <WeekColumns byDay={byDay} window={win} today={today} onPick={onPick} />
      ) : (
        <NextAvailable key={win.from} byDay={byDay} today={today} onPick={onPick} onLater={() => navigate(1)} onSooner={shiftWindow(layout, win, -1, today) ? () => navigate(-1) : null} />
      )}
    </SlotFrame>
  );
}
