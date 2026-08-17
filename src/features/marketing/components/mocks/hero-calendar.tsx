"use client";

import { useRef } from "react";
import type { PointerEvent } from "react";
import { BellRing, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./hero-calendar.module.css";

/* Hero showpiece: a month grid (August 2026) receding slightly in perspective,
   with two cards floating above it on their own z-planes. Decorative
   (aria-hidden). Pointer movement nudges the tilt; the cards parallax more than
   the grid because they sit further out — see hero-calendar.module.css. */

type Kind = "booked" | "intro" | "blocked" | "walkin";
type Event = { kind: Kind; title: string; who?: string };

const EVENTS: Record<number, Event> = {
  4: { kind: "booked", title: "Consultation", who: "Mia Novak" },
  6: { kind: "intro", title: "Intro call", who: "Tom Reyes" },
  11: { kind: "booked", title: "Consultation", who: "Priya Nair" },
  13: { kind: "blocked", title: "Blocked" },
  17: { kind: "booked", title: "Consultation", who: "Jonas Berg" },
  20: { kind: "booked", title: "Consultation", who: "Mia Novak" },
  21: { kind: "intro", title: "Intro call", who: "Lena Fischer" },
  27: { kind: "booked", title: "Consultation", who: "Noah Weber" },
  28: { kind: "walkin", title: "Walk-in", who: "Sara Lind" },
};
const TODAY = 17;
const CONFIRMED = 20; // the cell the floating "Booking confirmed" card refers to

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Five Monday-start weeks: Mon 27 Jul → Sun 30 Aug 2026.
type Cell = { day: number; inMonth: boolean };
const CELLS: Cell[] = [
  ...[27, 28, 29, 30, 31].map((day) => ({ day, inMonth: false })),
  ...Array.from({ length: 30 }, (_, i) => ({ day: i + 1, inMonth: true })),
];

const KIND_CLASS: Record<Kind, string> = {
  booked: "bg-primary/15",
  intro: "bg-primary/[0.06]",
  blocked: "text-muted-foreground",
  walkin: "bg-muted",
};
const HATCH = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, oklch(0 0 0 / 0.05) 0 3px, transparent 3px 9px)",
};

function DayCell({ cell }: { cell: Cell }) {
  const ev = cell.inMonth ? EVENTS[cell.day] : undefined;
  const isToday = cell.inMonth && cell.day === TODAY;
  return (
    <div
      className={cn(
        "border-border relative flex flex-col justify-between border-r border-b p-2 xl:p-2.5",
        !cell.inMonth && "bg-muted/40",
        ev && KIND_CLASS[ev.kind],
        ev?.kind === "blocked" && "bg-muted/60",
        cell.inMonth && cell.day === CONFIRMED && styles.pulse,
      )}
      style={ev?.kind === "blocked" ? HATCH : undefined}
    >
      <span
        className={cn(
          "font-mono text-[11px] leading-none tabular-nums sm:text-xs",
          !cell.inMonth && "text-muted-foreground",
          isToday && "bg-primary text-primary-foreground -m-1 flex size-5 items-center justify-center rounded-full font-medium",
        )}
      >
        {cell.day}
      </span>
      {ev ? (
        <span className="min-w-0">
          <span className="hidden truncate text-[11px] leading-tight font-medium sm:block xl:text-xs">{ev.title}</span>
          {ev.who ? (
            <span className="text-muted-foreground mt-0.5 hidden truncate font-mono text-[9px] tracking-wider uppercase sm:block">
              {ev.who}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function HeroCalendar({ className }: { className?: string }) {
  const sceneRef = useRef<HTMLDivElement>(null);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = sceneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const py = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    el.style.setProperty("--px", px.toFixed(3));
    el.style.setProperty("--py", py.toFixed(3));
  };
  const onPointerLeave = () => {
    const el = sceneRef.current;
    if (!el) return;
    el.style.setProperty("--px", "0");
    el.style.setProperty("--py", "0");
  };

  return (
    <div
      ref={sceneRef}
      aria-hidden="true"
      className={cn(styles.scene, "relative", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className={styles.stage}>
        <div className={cn(styles.grid, "bg-card border-border overflow-hidden rounded-l-lg border-t border-l border-b")}>
          <div className="grid grid-cols-7">
            {DOW.map((d) => (
              <div
                key={d}
                className="border-border text-muted-foreground border-r border-b px-2 py-1.5 font-mono text-[10px] tracking-widest uppercase sm:px-2.5"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 auto-rows-[3.75rem] sm:auto-rows-[5rem] lg:auto-rows-[5.75rem] xl:auto-rows-[6.25rem]">
            {CELLS.map((c) => (
              <DayCell key={`${c.inMonth ? "a" : "j"}${c.day}`} cell={c} />
            ))}
          </div>
        </div>

        {/* Floating card: the confirmation for Wed 20, hovering over that week. */}
        <div className={styles.card} style={{ "--z": "70px", "--dur": "7s", left: "12%", top: "74%" } as React.CSSProperties}>
          <div className={cn(styles.cardInner, "bg-card border-border w-56 rounded-xl border p-3 sm:w-64 sm:p-3.5")}>
            <div className="flex items-center gap-2">
              <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className="text-xs font-medium sm:text-sm">Booking confirmed</span>
            </div>
            <div className="mt-2.5 flex items-center gap-2.5">
              <span className="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold">
                MN
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs leading-tight sm:text-sm">Mia Novak · Consultation</span>
                <span className="text-muted-foreground block truncate font-mono text-[10px] sm:text-[11px]">Wed 20 Aug · 11:00 – 12:00</span>
              </span>
            </div>
          </div>
        </div>

        {/* Floating chip: reminder for today's booking, top right. */}
        <div className={cn(styles.card, "hidden sm:block")} style={{ "--z": "44px", "--dur": "9s", "--delay": "-3s", right: "18%", top: "17%" } as React.CSSProperties}>
          <div className={cn(styles.cardInner, "bg-card border-border flex items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5")}>
            <span className="bg-primary/15 text-primary flex size-6 items-center justify-center rounded-full">
              <BellRing className="size-3.5" />
            </span>
            <span className="text-xs leading-none">
              <span className="font-medium">Reminder sent</span>
              <span className="text-muted-foreground"> · Jonas Berg, 24 h before</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
