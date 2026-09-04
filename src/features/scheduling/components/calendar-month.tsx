"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import type { AdminBooking, ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { serviceAccent, timeToMin } from "@/features/scheduling/calendar-geometry";
import { byDate, monthGrid, monthStart } from "@/features/scheduling/month-grid";
import { INTL_LOCALES } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { HATCH } from "./calendar-grid";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { NewBookingDialog } from "./new-booking-dialog";

// ponytail: a fixed three, not measured against the row's real height. Rows
// are ~1/5th of the calendar's viewport height, which fits three chips and
// the "+n more" line at every size we ship; measure only if a row ever has
// to be shorter than that.
const MAX_CHIPS = 3;

/* The month: the same bookings as the week grid, read a month at a time.
   No hour axis and no open-hours shading — a month is for "how full is it",
   not "is 14:00 free", and the day and week views answer the second one a
   click away. The day number links into that day, chips open the same
   detail dialog the grid opens, and the free space under them books on
   that date — the month's answer to the week grid's drag. */
export function CalendarMonth({
  monthDate,
  today,
  timeZone,
  bookings,
  staff,
  services,
  spaces,
  defaultStaffId,
  preferSpace,
  windowsByDate,
  scopeSuffix,
}: {
  /** Any date in the month being shown. */
  monthDate: string;
  /** Today in the ORG's zone — resolved on the server, so no client clock. */
  today: string;
  timeZone: string;
  bookings: AdminBooking[];
  staff: StaffRow[];
  // Everything a walk-in booked from a cell needs — the same set the week
  // grid hands its own NewBookingDialog.
  services: ServiceRow[];
  spaces: OfferingOption[];
  defaultStaffId: string;
  preferSpace: string | null;
  /** Every grid date's open windows (the scope's union). An empty list is a
      closed day: hatched like the week grid's closed hours, and a booking
      started there gets the same outside-hours hint the week gives. */
  windowsByDate: Record<string, DayWindow[]>;
  /** "&show=…" or "" — a day link keeps the lens the month was read under. */
  scopeSuffix: string;
}) {
  // Built here rather than passed in: a function prop cannot cross the
  // server/client boundary (the Timeline takes its hrefs the same way).
  const dayHref = (date: string) => `/bookings?view=day&date=${date}${scopeSuffix}`;
  // A cell click starts on the day's first open minute; a closed day has none
  // to offer, so it falls back to the hour most businesses open on.
  const openFrom = (date: string) => {
    const first = windowsByDate[date]?.[0];
    return first ? timeToMin(first.startTime) : 9 * 60;
  };
  const t = useTranslations("bookings");
  const tSpaces = useTranslations("spaces");
  const intlLocale = INTL_LOCALES[useLocale()];
  const [selected, setSelected] = React.useState<AdminBooking | null>(null);
  // The date a cell click is booking on; null when the dialog is closed. The
  // dialog is mounted per opening (the timeline idiom) so every open starts
  // clean.
  const [createOn, setCreateOn] = React.useState<string | null>(null);

  const first = monthStart(monthDate);
  const dates = monthGrid(monthDate);
  const cells = byDate(bookings, timeZone);
  // "Mon" in the admin's language; noon UTC pins the calendar date.
  const weekdayFmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat(intlLocale, { hour: "2-digit", minute: "2-digit", timeZone });
  const dateFmt = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "long", timeZone: "UTC" });
  const isTeam = staff.length > 1;

  return (
    <div className="flex min-h-[520px] flex-1 flex-col overflow-x-auto">
      <div className="flex min-h-0 min-w-[840px] flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-7 pb-2">
          {dates.slice(0, 7).map((d) => (
            <div key={d} className="text-muted-foreground px-1 text-center text-xs">
              {weekdayFmt.format(new Date(`${d}T12:00:00Z`))}
            </div>
          ))}
        </div>
        {/* One row per week, all equal — the grid fills whatever height the
            page has left, like the week's hour rows. */}
        <div
          className="grid min-h-0 flex-1 gap-1"
          style={{ gridTemplateRows: `repeat(${dates.length / 7}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: dates.length / 7 }, (_, row) => (
            <div key={row} className="grid min-h-0 grid-cols-7 gap-1">
              {dates.slice(row * 7, row * 7 + 7).map((d) => {
                const inMonth = d.slice(0, 7) === first.slice(0, 7);
                const isToday = d === today;
                const all = cells.get(d) ?? [];
                const shown = all.slice(0, MAX_CHIPS);
                const hidden = all.length - shown.length;
                return (
                  <div
                    key={d}
                    className={cn(
                      "flex min-h-0 flex-col gap-0.5 rounded-lg border p-1",
                      inMonth ? "bg-card" : "bg-secondary/40",
                    )}
                    // Closed days wear the week grid's hatch, so "we are
                    // shut" reads the same at both zoom levels. It stays
                    // bookable: an admin booking ignores hours by design.
                    style={(windowsByDate[d]?.length ?? 0) === 0 ? HATCH : undefined}
                  >
                    <Link
                      href={dayHref(d)}
                      className="focus-visible:ring-ring/40 self-start rounded-full outline-none focus-visible:ring-2"
                    >
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          isToday && "bg-primary text-primary-foreground",
                          !isToday && !inMonth && "text-muted-foreground",
                        )}
                      >
                        {Number(d.slice(8, 10))}
                      </span>
                    </Link>
                    <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                      {shown.map((b) => {
                        const isSpace = b.rentalUnitId !== null;
                        const accent =
                          (isTeam ? b.staffColor : null) ??
                          serviceAccent(b.serviceId ?? b.rentalOfferingId ?? "");
                        return (
                          <button
                            key={`${d}-${b.id}`}
                            type="button"
                            onClick={() => setSelected(b)}
                            className={cn(
                              // Same signals as a card on the grid: a dashed
                              // edge means a space, a lighter fill means
                              // nobody has said yes yet (0062).
                              "focus-visible:ring-ring/40 flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[11px] outline-none focus-visible:ring-2",
                              isSpace ? "border-dashed" : "border-transparent",
                              b.status === "pending" ? "bg-card/50" : "bg-secondary",
                            )}
                          >
                            <span aria-hidden style={{ background: accent }} className="size-1.5 shrink-0 rounded-full" />
                            {isSpace ? (
                              <>
                                <HugeiconsIcon icon={House01Icon} size={11} className="shrink-0" aria-hidden />
                                <span className="sr-only">{tSpaces("badge")} · </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground shrink-0 tabular-nums">
                                {timeFmt.format(new Date(b.startsAt))}
                              </span>
                            )}
                            <span className="truncate">{b.serviceName}</span>
                            {b.status === "pending" ? <span className="sr-only"> · {t("status.pending")}</span> : null}
                          </button>
                        );
                      })}
                      {hidden > 0 ? (
                        <Link
                          href={dayHref(d)}
                          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/40 rounded px-1 text-[11px] outline-none focus-visible:ring-2"
                        >
                          {t("month.more", { count: hidden })}
                        </Link>
                      ) : null}
                    </div>
                    {/* Whatever is left of the cell books on this day. A
                        sibling button, not a click handler on the cell: the
                        number and the chips are interactive already, and
                        nesting them inside one would break both. It shrinks
                        as chips fill the cell — a full day is what the day
                        view is for. */}
                    <button
                      type="button"
                      aria-label={t("month.addOn", { date: dateFmt.format(new Date(`${d}T12:00:00Z`)) })}
                      onClick={() => setCreateOn(d)}
                      className="text-muted-foreground/0 hover:text-muted-foreground focus-visible:ring-ring/40 hover:bg-secondary/60 flex min-h-4 flex-1 items-start rounded text-[11px] outline-none transition-colors focus-visible:ring-2"
                    >
                      <span aria-hidden className="px-1">+</span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="text-muted-foreground flex shrink-0 items-center gap-2 pt-2 text-xs">
        <span aria-hidden style={HATCH} className="size-3 rounded-[3px] border" />
        <span>{t("month.closed")}</span>
      </div>
      {createOn === null ? null : (
        <NewBookingDialog
          open
          onOpenChange={(o) => { if (!o) setCreateOn(null); }}
          services={services}
          spaces={spaces}
          staff={staff}
          defaultStaffId={defaultStaffId}
          timeZone={timeZone}
          initial={
            preferSpace !== null
              ? { kind: "space", offeringId: preferSpace, date: createOn }
              : {
                  kind: "service",
                  date: createOn,
                  // The day's first open hour — 09:00 on a closed day, where
                  // the dialog will say so. `dragged: false` keeps the end
                  // following the picked service's own length.
                  startMin: openFrom(createOn),
                  dragEndMin: openFrom(createOn) + 60,
                  dragged: false,
                  windows: windowsByDate[createOn] ?? [],
                }
          }
        />
      )}
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        staff={staff}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
