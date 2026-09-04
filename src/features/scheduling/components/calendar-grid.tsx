"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AdminBooking, RuleRow, ExceptionRow, ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { initials } from "@/features/scheduling/staff-slug";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  zonedParts, hourRange, serviceAccent, snap15, minToTime, timeToMin, hourTileState,
} from "@/features/scheduling/calendar-geometry";
import { addDaysISO } from "@/features/scheduling/slots";
import { blockTimeRange, unblockTimeRange, reopenDay } from "@/features/scheduling/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { NewBookingDialog } from "./new-booking-dialog";
import { dragInitial } from "@/features/scheduling/booking-kinds";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { INTL_LOCALES } from "@/i18n/config";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";

export const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--border) 5px, var(--border) 6px)",
};
// Shared by the header and body rows so their columns stay aligned:
// [left rail][N day columns][right time axis] — the time axis sits on the
// right like the reference design. Written out per span rather than
// interpolated: Tailwind only sees class strings it can read in the source.
const GRID_COLS: Record<DayCount, string> = {
  1: "grid-cols-[2.5rem_minmax(0,1fr)_3.5rem]",
  7: "grid-cols-[2.5rem_repeat(7,minmax(0,1fr))_3.5rem]",
};
/** How many day columns the grid draws: the Day view's one, the Week's seven. */
export type DayCount = 1 | 7;

/* Side-by-side columns for bookings that overlap in one day (the standard
   calendar treatment): sorted by start, each booking takes the first free
   column of its overlap cluster, and the cluster's column count divides the
   width — so two 9:00 bookings sit next to each other instead of stacking. */
function overlapLayout(
  items: Array<{ id: string; start: number; end: number }>,
): Map<string, { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: string[] = [];
  let colEnds: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    for (const id of cluster) out.get(id)!.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    clusterEnd = cluster.length === 0 ? it.end : Math.max(clusterEnd, it.end);
    let col = colEnds.findIndex((end) => end <= it.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[col] = Math.max(colEnds[col], it.end);
    }
    out.set(it.id, { col, cols: 1 });
    cluster.push(it.id);
  }
  flush();
  return out;
}

export function CalendarGrid({
  startDate, dayCount, timeZone, staff, editStaffId, blockable, preferSpace, defaultStaffId,
  bookings, rules, exceptions, services, spaces,
}: {
  /** The leftmost column's date: the Monday of a week, or the day itself. */
  startDate: string;
  dayCount: DayCount;
  timeZone: string;
  // Team (multi-staff): the org's ACTIVE members. One of them (the solo case)
  // ⇒ no colours, no initials — this is the pre-team calendar.
  staff: StaffRow[];
  // The one person whose real hours the week draws (the solo org, or a
  // one-person scope) — hours and overrides belong to ONE person, so
  // blocking is only meaningful then. Null on an "everyone" or a space
  // week: `rules` are then the scope's union and `exceptions` empty.
  editStaffId: string | null;
  // False on a space scope: Block / Unblock / Reopen are a person's actions
  // and stay off the popover rather than toasting a hint about team members.
  blockable: boolean;
  // A space scope's space — a drag on its week books it (bookings-scope.ts
  // scopedSpace); null lets dragInitial's own order apply.
  preferSpace: string | null;
  // Who a walk-in created from this grid belongs to by default.
  defaultStaffId: string;
  bookings: AdminBooking[];
  rules: RuleRow[];
  exceptions: ExceptionRow[];
  services: ServiceRow[];
  // Active spaces — a drag on an org without services pre-fills the first hourly one.
  spaces: OfferingOption[];
}) {
  const t = useTranslations("bookings");
  const tSpaces = useTranslations("spaces");
  const intlLocale = INTL_LOCALES[useLocale()];
  // "Mon" in the admin's language; noon UTC pins the calendar date.
  const weekdayFmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short", timeZone: "UTC" });
  const weekday = (d: string) => weekdayFmt.format(new Date(`${d}T12:00:00Z`));
  const isTeam = staff.length > 1;
  const requireOneStaff = () => {
    toast.info(t("week.pickOneToBlock"));
  };
  const days = Array.from({ length: dayCount }, (_, i) => addDaysISO(startDate, i));
  const windowsByDay = days.map((d) => effectiveWindows(d, rules, exceptions));
  // Rentals R1: a multi-day stay has no place on an hour grid — it would
  // stretch a card over the whole column (or several). Split it out into an
  // all-day chip row under the day headers; only appointments stay timed.
  // H2: an hourly rental is a timed event just like an appointment (it has
  // a start/end within one day), so it joins `timed` too — only nights/days
  // stays (multi-day, no clock time) go to the all-day chip row.
  const timed = bookings.filter((b) => b.rentalUnitId === null || b.rangeMode === "hours");
  const rentals = bookings.filter((b) => b.rentalUnitId !== null && b.rangeMode !== "hours");
  // Confirmed bookings may legally sit outside open hours (admin-created)
  // or fall outside them after availability shrinks — widen the range so
  // they're never clipped off-grid (finding: invisible off-hours bookings).
  // Only rows that actually draw a card widen the range: `byDay` keys off
  // the org-zone START date, so a booking that began before the week is
  // never rendered and must not stretch the grid either (the overlap fetch
  // can now hand us one).
  const bookingSpans = timed.flatMap((b) => {
    const s = zonedParts(new Date(b.startsAt), timeZone);
    if (!days.includes(s.date)) return [];
    const e = zonedParts(new Date(b.endsAt), timeZone);
    return [{ startMin: s.minutes, endMin: e.date === s.date ? e.minutes : 24 * 60 }];
  });
  const { startHour, endHour } = hourRange(windowsByDay, bookingSpans);
  const totalMin = (endHour - startHour) * 60;
  const pct = (min: number) => ((min - startHour * 60) / totalMin) * 100;

  // Now-line: client clock, re-evaluated every minute. Seeded in useEffect so
  // server and first client render match (no hydration mismatch).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date());
    const seed = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => {
      clearTimeout(seed);
      clearInterval(t);
    };
  }, []);
  const nowParts = now ? zonedParts(now, timeZone) : null;

  const [selected, setSelected] = React.useState<AdminBooking | null>(null);

  const router = useRouter();
  const [busy, startBusy] = React.useTransition();
  // `dragged` distinguishes a real drag (its span is the wanted length) from
  // a click, which selects the default slot below and lets the dialog follow
  // whichever service gets picked.
  type Selection = { date: string; startMin: number; endMin: number; dragged: boolean };
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  // The slot a click books and the hover ghost previews: one hour, always —
  // the grid reads in hours, and the dialog still follows whichever service
  // gets picked. Clamped to the visible grid.
  const clampEnd = (startMin: number) => Math.min(startMin + 60, endHour * 60);
  // Where the ghost sits while the pointer roams free grid (no selection).
  const [hover, setHover] = React.useState<{ date: string; startMin: number } | null>(null);

  // Keyboard path: the hour tiles are buttons under a roving tabindex —
  // one Tab stop for the whole grid, arrows move it, Enter selects the
  // default slot at that hour (same as a click), Shift+↑/↓ resizes the
  // selection like a drag. `focusCell` names the one tile with tabIndex 0.
  const [focusCell, setFocusCell] = React.useState<{ di: number; h: number }>({ di: 0, h: startHour });
  const gridBodyRef = React.useRef<HTMLDivElement>(null);
  const focusTile = (di: number, h: number) => {
    setFocusCell({ di, h });
    gridBodyRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cal-tile="${di}:${h}"]`)
      ?.focus();
  };
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const tile = (e.target as HTMLElement).closest?.("[data-cal-tile]");
    if (!tile) return;
    const [di, h] = (tile.getAttribute("data-cal-tile") ?? "").split(":").map(Number);
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && selection && selection.date === days[di]) {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 15 : -15;
      setSelection({
        ...selection,
        endMin: Math.min(Math.max(selection.endMin + delta, selection.startMin + 15), endHour * 60),
        dragged: true,
      });
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    focusTile(
      Math.min(Math.max(di + m[0], 0), 6),
      Math.min(Math.max(h + m[1], startHour), endHour - 1),
    );
  };
  const dayHasExceptions = (d: string) => exceptions.some((e) => e.date === d);
  // How many minutes of the selection fall inside open windows — drives
  // which popover actions make sense: "Block time" needs some open time,
  // "Unblock time" needs some blocked time.
  const openMinutesIn = (sel: { date: string; startMin: number; endMin: number }) =>
    (windowsByDay[days.indexOf(sel.date)] ?? []).reduce(
      (sum, w) =>
        sum +
        Math.max(
          0,
          Math.min(timeToMin(w.endTime), sel.endMin) - Math.max(timeToMin(w.startTime), sel.startMin),
        ),
      0,
    );

  // Escape clears an in-progress or pending selection. Event-driven state
  // change (inside the keydown callback, not the effect body directly) —
  // same idiom as command-menu.tsx's Cmd-K listener — so the
  // set-state-in-effect lint rule doesn't fire.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelection(null);
      // If focus was in the popover it is about to unmount with it —
      // hand focus back to the grid's roving tile instead of <body>.
      if ((document.activeElement as HTMLElement | null)?.closest?.("[data-cal-popover]")) {
        document.querySelector<HTMLButtonElement>('[data-cal-tile][tabindex="0"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away clears the selection (the popover has no Dismiss button).
  // Day columns are exempt — pointerdown there replaces the selection —
  // and so is the create dialog, which must not unmount mid-flow.
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (createOpen) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-cal-popover]") || t.closest("[data-cal-column]")) return;
      setSelection(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [createOpen]);

  const blockSelected = () => {
    if (!selection) return;
    if (!editStaffId) return requireOneStaff();
    startBusy(async () => {
      const result = await blockTimeRange({
        staffId: editStaffId,
        date: selection.date,
        startTime: minToTime(selection.startMin),
        endTime: minToTime(selection.endMin),
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("week.timeBlocked"));
      setSelection(null);
      router.refresh();
    });
  };

  const unblockSelected = () => {
    if (!selection) return;
    if (!editStaffId) return requireOneStaff();
    startBusy(async () => {
      const result = await unblockTimeRange({
        staffId: editStaffId,
        date: selection.date,
        startTime: minToTime(selection.startMin),
        endTime: minToTime(selection.endMin),
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("week.timeUnblocked"));
      setSelection(null);
      router.refresh();
    });
  };

  const reopenSelected = (date: string) => {
    if (!editStaffId) return requireOneStaff();
    startBusy(async () => {
      const result = await reopenDay({ staffId: editStaffId, date });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("week.dayReopened"));
      setSelection(null);
      router.refresh();
    });
  };

  const byDay = (date: string) =>
    timed.filter((b) => zonedParts(new Date(b.startsAt), timeZone).date === date);

  // Overlap columns per booking, computed once per render (a week of chips
  // is a small key space). Ends mirror the chip's own clamped end.
  const chipLayout = React.useMemo(() => {
    const m = new Map<string, { col: number; cols: number }>();
    for (const d of days) {
      const items = byDay(d).map((b) => {
        const s = zonedParts(new Date(b.startsAt), timeZone);
        const e = zonedParts(new Date(b.endsAt), timeZone);
        const endMin = e.date === d ? Math.min(e.minutes, endHour * 60) : endHour * 60;
        // A zero/negative visible span still occupies a column: floor at 15.
        return { id: b.id, start: s.minutes, end: Math.max(endMin, s.minutes + 15) };
      });
      for (const [id, v] of overlapLayout(items)) m.set(id, v);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- byDay derives from timed
  }, [days, timed, timeZone, endHour]);

  // A stay shows a chip on every day it covers, first to last (org zone).
  const rentalsOn = (date: string) =>
    rentals.filter(
      (b) =>
        zonedParts(new Date(b.startsAt), timeZone).date <= date &&
        date <= zonedParts(new Date(b.endsAt), timeZone).date,
    );

  // What a selection would prefill into New booking — computed once and
  // shared by the popover's gate and the dialog's mount (same inputs both
  // places; no reason to run dragInitial twice).
  const dragPrefill = selection
    ? dragInitial(selection, services, spaces, windowsByDay[days.indexOf(selection.date)] ?? [], preferSpace)
    : null;

  return (
    // The grid fills whatever height `main` gives the page (the page root
    // is flex-1) instead of scrolling inside a capped box — rows are
    // percent-positioned, so they compress/stretch with the viewport like
    // the reference. min-h is the graceful floor: below it the page
    // scrolls rather than crushing the rows.
    <div className="flex min-h-[520px] flex-1 flex-col overflow-x-auto">
      <div className={cn("flex min-h-0 flex-1 flex-col", dayCount === 7 && "min-w-[840px]")}>
        {/* header row: weekday over the date, today marked by a filled disc
            on the number alone (Google Calendar's signature). The week
            arrows live in the page toolbar now — nothing but days here. */}
        <div className={cn("grid shrink-0 pb-2", GRID_COLS[dayCount])}>
          <div />
          {days.map((d) => {
            const isToday = nowParts?.date === d;
            return (
              <div
                key={d}
                className={cn(
                  "flex items-center gap-1.5 py-2",
                  // Seven columns read as a row of centred headings; one
                  // column is a page, and its date belongs at the margin.
                  dayCount === 1 ? "justify-start" : "justify-center",
                )}
              >
                <span className="text-muted-foreground text-xs">{weekday(d)}</span>
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {Number(d.slice(8, 10))}
                </span>
              </div>
            );
          })}
          <div />
        </div>
        {/* all-day row: rental stays, one chip per covered day. Hidden
            entirely when the week has none, so appointment-only orgs keep
            the grid they had. */}
        {rentals.length === 0 ? null : (
          <div className={cn("grid shrink-0 gap-x-1.5 pb-2", GRID_COLS[dayCount])}>
            <div />
            {days.map((d) => (
              <div key={d} className="flex flex-col gap-0.5">
                {rentalsOn(d).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelected(b)}
                    className={cn(
                      "w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px]",
                      // A request is a ghost: it holds the slot but nobody has
                      // said yes yet (0062). Dashed BOX + a lighter fill —
                      // the dashed left rule already means "space". No
                      // `opacity` on top: it faded the muted client-name line
                      // below 4.5:1 (QA), and the two signals here suffice.
                      b.status === "pending" ? "border-dashed bg-card/50" : "bg-card",
                    )}
                    style={{ borderLeft: `3px solid ${serviceAccent(b.rentalOfferingId ?? "")}` }}
                  >
                    {b.serviceName}
                    {b.status === "pending" ? <span className="sr-only"> · {t("status.pending")}</span> : null}
                  </button>
                ))}
              </div>
            ))}
            <div />
          </div>
        )}
        {/* body row: left rail, 7 day columns, right time axis. The grid
            reads as discrete rounded hour tiles with gutters (reference
            style) — the tiles are visual only; cards, selection, and
            pointer math stay percent-positioned on the continuous column. */}
        <div ref={gridBodyRef} onKeyDown={onGridKeyDown} className={cn("grid min-h-0 flex-1 gap-x-1.5", GRID_COLS[dayCount])}>
          <div />
          {days.map((d, di) => (
          <div
            key={d}
            data-cal-column
            className="relative"
            onPointerDown={(e) => {
              // Cards and the popover handle themselves; hour tiles are
              // buttons too (keyboard path) but a pointer on them still
              // starts a selection here.
              if ((e.target as HTMLElement).closest("[data-cal-card],[data-cal-popover]")) return;
              // Capture on the column itself so drag-move keeps firing here
              // even if the pointer strays outside the column bounds —
              // avoids a stuck `dragging` from a pointerup that lands
              // elsewhere (chosen over a window pointerup listener).
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              const raw = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin);
              // Clamp so an extreme drag (pointer released past the grid
              // edge) can't produce a selection start outside the grid.
              const min = Math.min(Math.max(raw, startHour * 60), endHour * 60 - 15);
              setSelection({ date: d, startMin: min, endMin: min + 15, dragged: false });
              setDragging(true);
              setHover(null);
            }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (dragging && selection && selection.date === d) {
                const raw = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin) + 15;
                // Same clamp for the drag-derived end.
                const min = Math.min(Math.max(raw, startHour * 60 + 15), endHour * 60);
                const endMin = Math.max(min, selection.startMin + 15);
                // Moving within the first 15-min cell is still a click; once
                // the span grows past it, the drag owns the length for good.
                setSelection({ ...selection, endMin, dragged: selection.dragged || endMin > selection.startMin + 15 });
              } else if (selection === null) {
                const raw = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin);
                const min = Math.min(Math.max(raw, startHour * 60), endHour * 60 - 15);
                // Re-render only when the ghost actually moves a step.
                setHover((h) => (h && h.date === d && h.startMin === min ? h : { date: d, startMin: min }));
              }
            }}
            onPointerUp={() => {
              setDragging(false);
              // A click books the default slot the hover ghost promised —
              // not a 15-minute sliver.
              setSelection((sel) =>
                sel && !sel.dragged ? { ...sel, endMin: clampEnd(sel.startMin) } : sel,
              );
            }}
            onPointerLeave={() => setHover((h) => (h?.date === d ? null : h))}
          >
            {Array.from({ length: endHour - startHour }, (_, i) => {
              const h = startHour + i;
              const tile = hourTileState(windowsByDay[di], h);
              return (
                <button
                  key={i}
                  type="button"
                  data-cal-tile={`${di}:${h}`}
                  tabIndex={focusCell.di === di && focusCell.h === h ? 0 : -1}
                  aria-label={`${weekday(d)} ${Number(d.slice(8, 10))}, ${String(h).padStart(2, "0")}:00${tile.fullyClosed ? ` (${t("week.closedHours")})` : ""}`}
                  onFocus={() => setFocusCell({ di, h })}
                  onClick={(e) => {
                    // Keyboard activation only (detail 0) — a pointer click's
                    // selection is already made by the column's pointer
                    // handlers and must not be snapped back to the hour.
                    if (e.detail !== 0) return;
                    const start = Math.min(h * 60, endHour * 60 - 15);
                    setSelection({ date: d, startMin: start, endMin: clampEnd(start), dragged: false });
                  }}
                  className={cn(
                    "absolute inset-x-0 cursor-pointer rounded-md outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    tile.fullyClosed ? "bg-muted/15" : "bg-muted/40",
                  )}
                  style={{
                    top: `calc(${pct(h * 60)}% + 2px)`,
                    height: `calc(${pct((h + 1) * 60) - pct(h * 60)}% - 4px)`,
                    ...(tile.fullyClosed ? HATCH : {}),
                  }}
                >
                  {/* exact blocked slices inside a partially open hour —
                      without these, a sub-hour block is invisible */}
                  {!tile.fullyClosed &&
                    tile.closed.map((c, ci) => (
                      <div
                        key={ci}
                        className="absolute inset-x-0 rounded-sm bg-muted/30"
                        style={{
                          ...HATCH,
                          // tile-local offsets: the tile spans [h*60, (h+1)*60]
                          top: `${((c.startMin - h * 60) / 60) * 100}%`,
                          height: `${((c.endMin - c.startMin) / 60) * 100}%`,
                        }}
                      />
                    ))}
                </button>
              );
            })}
            {/* Hover ghost: the exact slot a click would select, drawn UNDER
                the booking cards (they're z-10) so occupied time visibly
                stays occupied — the ghost only shows through free grid. */}
            {hover?.date === d && selection === null ? (
              // Kind-time periwinkle, not chrome grey: grey means closed or
              // blocked on this grid; colour names a bookable kind — and the
              // ghost previews an appointment.
              <div
                aria-hidden
                className="border-kind-time/60 bg-kind-time-soft/80 pointer-events-none absolute inset-x-0 rounded-md border"
                style={{
                  top: `${pct(hover.startMin)}%`,
                  height: `${pct(clampEnd(hover.startMin)) - pct(hover.startMin)}%`,
                }}
              >
                <span className="text-kind-time-text absolute top-0.5 left-1.5 text-[11px] font-medium tabular-nums">
                  {minToTime(hover.startMin)}–{minToTime(clampEnd(hover.startMin))}
                </span>
              </div>
            ) : null}
            {nowParts?.date === d &&
            nowParts.minutes >= startHour * 60 &&
            nowParts.minutes <= endHour * 60 ? (
              // Rendered only while "now" is inside the visible hour range —
              // out-of-hours it would position past 100% and overflow the
              // grid, spawning a phantom scrollbar.
              <div className="absolute inset-x-0 z-20 border-t-2 border-primary" style={{ top: `${pct(nowParts.minutes)}%` }} />
            ) : null}
            {byDay(d).map((b) => {
              const s = zonedParts(new Date(b.startsAt), timeZone);
              const e = zonedParts(new Date(b.endsAt), timeZone);
              // Next-day bookings clamp to the grid bottom; same-day
              // bookings that still overrun endHour (shouldn't happen now
              // that hourRange accounts for bookings, but kept as a
              // defensive clamp) mirror that same clip.
              const endMin = e.date === d ? Math.min(e.minutes, endHour * 60) : endHour * 60;
              const compact = endMin - s.minutes < 30;
              const isSpace = b.rentalUnitId !== null;
              const lay = chipLayout.get(b.id) ?? { col: 0, cols: 1 };
              return (
                <button
                  key={b.id}
                  type="button"
                  data-cal-card
                  onClick={() => setSelected(b)}
                  className={cn(
                    "absolute z-10 overflow-hidden rounded-md border p-1.5 text-left text-xs shadow-sm hover:shadow",
                    lay.cols === 1 && "inset-x-0",
                    // A pending request holds the slot but isn't confirmed —
                    // it reads as a ghost of the booking it would become.
                    // Dashed border + translucent fill only: an added
                    // `opacity` dropped the muted client-name line to 4.16:1.
                    b.status === "pending" ? "border-dashed bg-card/50" : "bg-card",
                  )}
                  style={{
                    // Overlapping bookings share the day side-by-side.
                    ...(lay.cols > 1
                      ? {
                          left: `calc(${(lay.col * 100) / lay.cols}% + ${lay.col === 0 ? 0 : 1}px)`,
                          width: `calc(${100 / lay.cols}% - 1px)`,
                        }
                      : null),
                    top: `${pct(s.minutes)}%`,
                    height: `${Math.max(pct(endMin) - pct(s.minutes), 1.5)}%`,
                    // A team reads its calendar by person first, so the accent
                    // becomes theirs; a solo org keeps the per-service hue it
                    // has always had. Colour alone never carries the
                    // space/appointment distinction — dashed vs. solid does.
                    borderLeft: `3px ${isSpace ? "dashed" : "solid"} ${
                      (isTeam ? b.staffColor : null) ??
                      serviceAccent(b.serviceId ?? b.rentalOfferingId ?? "")
                    }`,
                  }}
                >
                  {/* Solo keeps the bare title it always had — the chip row
                      is a team-only addition, markup included. */}
                  {isTeam && b.staffName ? (
                    <span className="flex items-center gap-1">
                      <span
                        title={b.staffName}
                        style={{ background: b.staffColor ?? undefined }}
                        className="shrink-0 rounded-sm px-1 py-0.5 text-[10px] leading-none font-semibold text-white/95"
                      >
                        {initials(b.staffName)}
                      </span>
                      <span className="truncate font-medium">
                        {isSpace ? (
                          <>
                            <HugeiconsIcon icon={House01Icon} size={12} className="inline-block shrink-0 align-[-1px]" aria-hidden />
                            <span className="sr-only">{tSpaces("badge")} · </span>{" "}
                          </>
                        ) : null}
                        {b.serviceName}
                      </span>
                    </span>
                  ) : (
                    <span className="font-medium">
                      {isSpace ? (
                        <>
                          <HugeiconsIcon icon={House01Icon} size={12} className="inline-block shrink-0 align-[-1px]" aria-hidden />
                          <span className="sr-only">{tSpaces("badge")} · </span>{" "}
                        </>
                      ) : null}
                      {b.serviceName}
                    </span>
                  )}
                  {compact ? null : (
                    <>
                      <span className="block truncate text-muted-foreground">{b.clientName}</span>
                      <span className="block text-muted-foreground">
                        {minToTime(s.minutes)}–{minToTime(e.minutes)}
                      </span>
                    </>
                  )}
                  {/* The word, not just the dashes: a sliver of a card has no
                      room for it on screen but still owes it to a reader. */}
                  {b.status === "pending" ? (
                    <span className={cn("text-muted-foreground", compact ? "sr-only" : "block")}>{t("status.pending")}</span>
                  ) : null}
                </button>
              );
            })}
            {selection?.date === d ? (
              <div
                className="absolute inset-x-0 z-20 rounded-md border border-primary bg-primary/10"
                style={{ top: `${pct(selection.startMin)}%`, height: `${pct(selection.endMin) - pct(selection.startMin)}%` }}
              >
                {!dragging ? (() => {
                  const openMin = openMinutesIn(selection);
                  const touchesOpen = openMin > 0;
                  const touchesBlocked = openMin < selection.endMin - selection.startMin;
                  return (
                    <div
                      data-cal-popover
                      className={cn(
                        "absolute top-full z-30 mt-1 flex w-max items-center gap-1 rounded-lg border bg-popover p-1 shadow-md",
                        // keep the row inside the grid near the week's edge
                        di >= 5 ? "right-0" : "left-0",
                      )}
                    >
                      <span className="px-1.5 text-xs tabular-nums text-muted-foreground">
                        {minToTime(selection.startMin)}–{minToTime(selection.endMin)}
                      </span>
                      {dragPrefill ? (
                        <Button size="sm" className="h-7" onClick={() => setCreateOpen(true)}>
                          {t("new.title")}
                        </Button>
                      ) : null}
                      {blockable && touchesOpen ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={blockSelected} disabled={busy}>
                          {t("week.block")}
                        </Button>
                      ) : null}
                      {blockable && touchesBlocked ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={unblockSelected} disabled={busy}>
                          {t("week.unblock")}
                        </Button>
                      ) : null}
                      {blockable && dayHasExceptions(d) ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => reopenSelected(d)} disabled={busy}>
                          {t("week.reopenDay")}
                        </Button>
                      ) : null}
                    </div>
                  );
                })() : null}
              </div>
            ) : null}
          </div>
          ))}
          {/* time axis (right edge, like the reference): one label per
              hour row, centered on its tile */}
          <div className="relative">
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div
                key={i}
                className="absolute left-1.5 -translate-y-1/2 text-[11px] text-muted-foreground"
                style={{ top: `${pct((startHour + i) * 60 + 30)}%` }}
              >
                {minToTime((startHour + i) * 60)}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* One quiet line under the grid: what the hatch means, and that the
          grid is drawable — the two things a new provider can't guess. */}
      <div className="text-subtle flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs">
        <span className="flex items-center gap-1.5">
          {/* Denser, darker pitch than the grid's own hatch: a 20px sample
              needs more contrast than a full cell to read at a glance. */}
          <span
            aria-hidden
            className="border-border h-3.5 w-5 shrink-0 rounded-[3px] border"
            style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 3px, var(--input) 3px, var(--input) 4px)" }}
          />
          {t("week.closedHours")}
        </span>
        <span>{blockable ? t("week.hintBlockable") : t("week.hint")}</span>
      </div>
      {/* Screen-reader narration for the pointer-free path: what got
          selected and how to act on it. */}
      <div aria-live="polite" className="sr-only">
        {selection && !dragging
          ? t("week.selected", { start: minToTime(selection.startMin), end: minToTime(selection.endMin), date: selection.date })
          : ""}
      </div>
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        staff={staff}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
      {selection && createOpen ? (
        <NewBookingDialog
          open
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setSelection(null); }}
          services={services}
          spaces={spaces}
          staff={staff}
          defaultStaffId={defaultStaffId}
          timeZone={timeZone}
          initial={dragPrefill ?? undefined}
        />
      ) : null}
    </div>
  );
}
