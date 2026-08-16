"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { AdminBooking, RuleRow, ExceptionRow, ServiceRow } from "@/features/scheduling/queries";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  zonedParts, hourRange, serviceAccent, snap15, minToTime, hourTileState,
} from "@/features/scheduling/calendar-geometry";
import { addDaysISO } from "@/features/scheduling/slots";
import { blockTimeRange, reopenDay } from "@/features/scheduling/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BookingDetailDialog } from "./booking-detail-dialog";
import { CreateBookingDialog } from "./create-booking-dialog";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--border) 5px, var(--border) 6px)",
};
// Shared by the header and body rows so their columns stay aligned:
// [left rail][7 day columns][right time axis] — the time axis sits on the
// right like the reference design.
const GRID_COLS = "grid-cols-[2.5rem_repeat(7,minmax(0,1fr))_3.5rem]";

export function CalendarWeek({
  weekStart, timeZone, bookings, rules, exceptions, services, prevHref, nextHref,
}: {
  weekStart: string;
  timeZone: string;
  bookings: AdminBooking[];
  rules: RuleRow[];
  exceptions: ExceptionRow[];
  services: ServiceRow[];
  prevHref: string;
  nextHref: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const windowsByDay = days.map((d) => effectiveWindows(d, rules, exceptions));
  // Confirmed bookings may legally sit outside open hours (admin-created)
  // or fall outside them after availability shrinks — widen the range so
  // they're never clipped off-grid (finding: invisible off-hours bookings).
  const bookingSpans = bookings.map((b) => {
    const s = zonedParts(new Date(b.startsAt), timeZone);
    const e = zonedParts(new Date(b.endsAt), timeZone);
    return { startMin: s.minutes, endMin: e.date === s.date ? e.minutes : 24 * 60 };
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

  const blockSelected = () => {
    if (!selection) return;
    startBusy(async () => {
      const result = await blockTimeRange({
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

  const reopenSelected = (date: string) => {
    startBusy(async () => {
      const result = await reopenDay({ date });
      if (!result.ok) toast.error(result.error);
      else toast.success("Day reopened — weekly hours restored.");
      setSelection(null);
      router.refresh();
    });
  };

  const byDay = (date: string) =>
    bookings.filter((b) => zonedParts(new Date(b.startsAt), timeZone).date === date);

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
        {/* body row: left rail, 7 day columns, right time axis. The grid
            reads as discrete rounded hour tiles with gutters (reference
            style) — the tiles are visual only; cards, selection, and
            pointer math stay percent-positioned on the continuous column. */}
        <div className={cn("grid min-h-0 flex-1 gap-x-1.5", GRID_COLS)}>
          <div />
          {days.map((d, di) => (
          <div
            key={d}
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
                    "absolute inset-x-0 rounded-md",
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
                </div>
              );
            })}
            {nowParts?.date === d ? (
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
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelected(b)}
                  className="absolute inset-x-0 z-10 overflow-hidden rounded-md border bg-card p-1.5 text-left text-xs shadow-sm hover:shadow"
                  style={{
                    top: `${pct(s.minutes)}%`,
                    height: `${Math.max(pct(endMin) - pct(s.minutes), 1.5)}%`,
                    borderLeft: `3px solid ${serviceAccent(b.serviceId)}`,
                  }}
                >
                  <span className="font-medium">{b.serviceName}</span>
                  {compact ? null : (
                    <>
                      <span className="block truncate text-muted-foreground">{b.clientName}</span>
                      <span className="block text-muted-foreground">
                        {minToTime(s.minutes)}–{minToTime(e.minutes)}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
            {selection?.date === d ? (
              <div
                className="absolute inset-x-0 z-20 rounded-md border border-primary bg-primary/10"
                style={{ top: `${pct(selection.startMin)}%`, height: `${pct(selection.endMin) - pct(selection.startMin)}%` }}
              >
                {!dragging ? (
                  <div className="absolute left-0 top-full z-30 mt-1 flex w-max flex-col gap-1 rounded-md border bg-popover p-2 text-sm shadow-md">
                    <span className="text-xs text-muted-foreground">
                      {minToTime(selection.startMin)}–{minToTime(selection.endMin)}
                    </span>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>New booking</Button>
                    <Button size="sm" variant="ghost" onClick={blockSelected} disabled={busy}>Block time</Button>
                    {dayHasExceptions(d) ? (
                      <Button size="sm" variant="ghost" onClick={() => reopenSelected(d)} disabled={busy}>
                        Reopen day (restore weekly hours)
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>Dismiss</Button>
                  </div>
                ) : null}
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
      <BookingDetailDialog
        booking={selected}
        timeZone={timeZone}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
      {selection ? (
        <CreateBookingDialog
          open={createOpen}
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setSelection(null); }}
          date={selection.date}
          startMin={selection.startMin}
          timeZone={timeZone}
          services={services}
          windows={windowsByDay[days.indexOf(selection.date)] ?? []}
        />
      ) : null}
    </div>
  );
}
