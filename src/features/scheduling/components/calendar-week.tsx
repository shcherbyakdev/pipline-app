"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { NewBookingDialog } from "./new-booking-dialog";
import { dragInitial } from "@/features/scheduling/booking-kinds";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { SPACES } from "@/features/orgs/vocab";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--border) 5px, var(--border) 6px)",
};
// Shared by the header and body rows so their columns stay aligned:
// [left rail][7 day columns][right time axis] — the time axis sits on the
// right like the reference design.
const GRID_COLS = "grid-cols-[2.5rem_repeat(7,minmax(0,1fr))_3.5rem]";

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

export function CalendarWeek({
  weekStart, timeZone, staff, editStaffId, blockable, preferSpace, defaultStaffId,
  bookings, rules, exceptions, services, spaces, prevHref, nextHref,
}: {
  weekStart: string;
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
  prevHref: string;
  nextHref: string;
}) {
  const isTeam = staff.length > 1;
  const requireOneStaff = () => {
    toast.info("Pick one team member to block time.");
  };
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
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
  type Selection = { date: string; startMin: number; endMin: number };
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
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
      if (e.key === "Escape") setSelection(null);
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
      else toast.success("Time blocked.");
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
      else toast.success("Time unblocked.");
      setSelection(null);
      router.refresh();
    });
  };

  const reopenSelected = (date: string) => {
    if (!editStaffId) return requireOneStaff();
    startBusy(async () => {
      const result = await reopenDay({ staffId: editStaffId, date });
      if (!result.ok) toast.error(result.error);
      else toast.success("Day reopened — weekly hours restored.");
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
      <div className="flex min-h-0 min-w-[840px] flex-1 flex-col">
        {/* header row: week arrows live inside the grid, like the reference */}
        <div className={cn("grid shrink-0 pb-2", GRID_COLS)}>
          <Link
            href={prevHref}
            aria-label="Previous week"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "size-7 self-center justify-self-center p-0",
            )}
          >
            <ChevronLeft className="size-4" />
          </Link>
          {days.map((d, i) => {
            const isToday = nowParts?.date === d;
            return (
              <div key={d} className="flex items-center justify-center py-2">
                <span
                  className={cn(
                    "flex items-baseline gap-1.5 rounded-md px-2.5 py-1",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  <span className={cn("text-xs", isToday ? "text-primary-foreground/75" : "text-muted-foreground")}>
                    {DAY_LABELS[(i + 1) % 7]}
                  </span>
                  <span className="text-sm font-semibold">{Number(d.slice(8, 10))}</span>
                </span>
              </div>
            );
          })}
          <Link
            href={nextHref}
            aria-label="Next week"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "size-7 self-center justify-self-center p-0",
            )}
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        {/* all-day row: rental stays, one chip per covered day. Hidden
            entirely when the week has none, so appointment-only orgs keep
            the grid they had. */}
        {rentals.length === 0 ? null : (
          <div className={cn("grid shrink-0 gap-x-1.5 pb-2", GRID_COLS)}>
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
                    {b.status === "pending" ? <span className="sr-only"> · Pending</span> : null}
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
        <div className={cn("grid min-h-0 flex-1 gap-x-1.5", GRID_COLS)}>
          <div />
          {days.map((d, di) => (
          <div
            key={d}
            data-cal-column
            className="relative"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return; // cards handle themselves
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
              setSelection({ date: d, startMin: min, endMin: min + 15 });
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (!dragging || !selection || selection.date !== d) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const raw = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin) + 15;
              // Same clamp for the drag-derived end.
              const min = Math.min(Math.max(raw, startHour * 60 + 15), endHour * 60);
              setSelection({ ...selection, endMin: Math.max(min, selection.startMin + 15) });
            }}
            onPointerUp={() => setDragging(false)}
          >
            {Array.from({ length: endHour - startHour }, (_, i) => {
              const h = startHour + i;
              const tile = hourTileState(windowsByDay[di], h);
              return (
                <div
                  key={i}
                  className={cn(
                    "group absolute inset-x-0 cursor-pointer rounded-md transition-colors",
                    tile.fullyClosed ? "bg-muted/15" : "bg-muted/40",
                    // hover affordance goes quiet while a selection exists —
                    // otherwise its ring + plus stack under the selection
                    // outline as visual noise
                    selection === null &&
                      "hover:bg-primary/5 hover:ring-1 hover:ring-inset hover:ring-primary",
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
                  {/* hover affordance: click/drag here starts a booking */}
                  {selection === null ? (
                    <Plus className="pointer-events-none absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                  ) : null}
                </div>
              );
            })}
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
                        className="shrink-0 rounded-sm px-1 py-0.5 text-[9px] leading-none font-semibold text-white/95"
                      >
                        {initials(b.staffName)}
                      </span>
                      <span className="truncate font-medium">
                        {isSpace ? (
                          <>
                            <HugeiconsIcon icon={House01Icon} size={12} className="inline-block shrink-0 align-[-1px]" aria-hidden />
                            <span className="sr-only">{SPACES.badge} · </span>{" "}
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
                          <span className="sr-only">{SPACES.badge} · </span>{" "}
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
                    <span className={cn("text-muted-foreground", compact ? "sr-only" : "block")}>Pending</span>
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
                          New booking
                        </Button>
                      ) : null}
                      {blockable && touchesOpen ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={blockSelected} disabled={busy}>
                          Block
                        </Button>
                      ) : null}
                      {blockable && touchesBlocked ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={unblockSelected} disabled={busy}>
                          Unblock
                        </Button>
                      ) : null}
                      {blockable && dayHasExceptions(d) ? (
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => reopenSelected(d)} disabled={busy}>
                          Reopen day
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
                {`${String(startHour + i).padStart(2, "0")}:00`}
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
          Closed hours
        </span>
        <span>Drag across open hours to add a booking{blockable ? " or block time" : ""}.</span>
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
