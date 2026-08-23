"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent } from "react";
import { BellRing, Check, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./hero-calendar.module.css";

/* Hero showpiece: a month grid (August 2026) receding slightly in perspective,
   with an activity panel floating above it that plays a looping booking
   scenario — a client picks a service and a slot, the cell is held, the booking
   confirms and the cell fills, the confirmation email and reminder go out, then
   the next client arrives. Decorative (aria-hidden). Pointer movement nudges
   the tilt; the panel parallaxes more than the grid because it sits further
   out — see hero-calendar.module.css. */

type Kind = "booked" | "intro" | "blocked" | "walkin";
type Event = { kind: Kind; title: string; who: string };

// Bookings already on the calendar when the scenario starts.
const EVENTS: Record<number, Event> = {
  7: { kind: "booked", title: "Consultation", who: "Priya Nair" },
  6: { kind: "intro", title: "Intro call", who: "Tom Reyes" },
  11: { kind: "booked", title: "Consultation", who: "Aylin Kaya" },
  13: { kind: "blocked", title: "Blocked", who: "" },
  17: { kind: "booked", title: "Consultation", who: "Jonas Berg" },
  28: { kind: "walkin", title: "Walk-in", who: "Sara Lind" },
};
const TODAY = 17;

// The clients who book, one after another. Each lands on a different empty day.
type Scenario = { initials: string; name: string; service: string; length: string; day: number; when: string; kind: Kind; title: string };
const SCENARIOS: Scenario[] = [
  { initials: "MN", name: "Mia Novak", service: "Consultation", length: "60 min", day: 20, when: "Wed 20 Aug · 11:00", kind: "booked", title: "Consultation" },
  { initials: "LF", name: "Lena Fischer", service: "Intro call", length: "20 min", day: 21, when: "Fri 21 Aug · 15:30", kind: "intro", title: "Intro call" },
  { initials: "NW", name: "Noah Weber", service: "Consultation", length: "60 min", day: 27, when: "Thu 27 Aug · 09:00", kind: "booked", title: "Consultation" },
];

/* Timeline of one scenario. `step` is what the UI shows; `at` is ms from the
   scenario's start. The last step removes the panel; the next scenario begins
   NEXT_AT ms after the start (a little after the leave animation ends). */
const STEP = { intro: 0, service: 1, slot: 2, confirmed: 3, email: 4, reminder: 5, idle: 6, leave: 7 } as const;
type Step = (typeof STEP)[keyof typeof STEP];
const TIMELINE: Array<{ at: number; step: Step }> = [
  { at: 0, step: STEP.intro },
  { at: 1800, step: STEP.service },
  { at: 3400, step: STEP.slot },
  { at: 5400, step: STEP.confirmed },
  { at: 7200, step: STEP.email },
  { at: 8800, step: STEP.reminder },
  { at: 10800, step: STEP.idle },
  { at: 12600, step: STEP.leave },
];
const NEXT_AT = 13300;

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Five Monday-start weeks: Mon 27 Jul → Sun 30 Aug 2026.
type Cell = { day: number; inMonth: boolean };
const CELLS: Cell[] = [
  ...[27, 28, 29, 30, 31].map((day) => ({ day, inMonth: false })),
  ...Array.from({ length: 30 }, (_, i) => ({ day: i + 1, inMonth: true })),
];

const KIND_CLASS: Record<Kind, string> = {
  booked: "bg-linear-to-br from-(--hero-accent)/22 to-(--hero-accent-deep)/14",
  intro: "bg-linear-to-br from-(--hero-accent)/10 to-(--hero-accent-deep)/6",
  blocked: "text-muted-foreground bg-muted/60",
  walkin: "bg-muted",
};
const HATCH = {
  backgroundImage: "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--foreground) 8%, transparent) 0 3px, transparent 3px 9px)",
};

type CellState = { ev?: Event; hold?: boolean; fresh?: boolean };

function DayCell({ cell, state }: { cell: Cell; state: CellState }) {
  const { ev, hold, fresh } = state;
  const isToday = cell.inMonth && cell.day === TODAY;
  return (
    <div
      className={cn(
        styles.cell,
        "border-border relative flex flex-col justify-between border-r border-b p-2 xl:p-2.5",
        !cell.inMonth && "bg-muted/40",
        ev && KIND_CLASS[ev.kind],
        hold && styles.hold,
        fresh && styles.fill,
      )}
      style={ev?.kind === "blocked" ? HATCH : undefined}
    >
      <span
        className={cn(
          "font-mono text-[11px] leading-none tabular-nums sm:text-xs",
          !cell.inMonth && "text-muted-foreground",
          isToday && "bg-linear-to-br from-(--hero-accent) to-(--hero-accent-deep) text-(--hero-accent-foreground) -m-1 flex size-5 items-center justify-center rounded-full font-medium",
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

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Drives the scenario loop. Returns the current scenario index and step; under
 *  reduced motion it parks on the first scenario's completed state and never loops. */
function useScenario() {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<{ i: number; step: Step; done: number[] }>({ i: 0, step: STEP.intro, done: [] });

  useEffect(() => {
    if (reduced) return;
    let timers: number[] = [];
    let cancelled = false;
    const run = (i: number, done: number[]) => {
      if (cancelled) return;
      timers.forEach(clearTimeout);
      timers = TIMELINE.map(({ at, step }) => window.setTimeout(() => setState({ i, step, done }), at));
      timers.push(
        window.setTimeout(() => {
          const next = (i + 1) % SCENARIOS.length;
          // Once every client has booked, the calendar clears and the loop starts over.
          run(next, next === 0 ? [] : [...done, i]);
        }, NEXT_AT),
      );
    };
    run(0, []);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  return reduced ? { i: 0, step: STEP.reminder, done: [] } : state;
}

/** Icon + text for the status strip at a given step. Shimmer while in progress. */
function statusContent(step: Step, s: Scenario): { icon: React.ReactNode; text: React.ReactNode; tone: "shimmer" | "plain" | "muted" } {
  const first = s.name.split(" ")[0];
  const bubble = (inner: React.ReactNode, muted = false) => (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full",
        muted ? "bg-muted text-muted-foreground" : "bg-(--hero-accent)/15 text-(--hero-accent)",
      )}
    >
      {inner}
    </span>
  );
  if (step <= STEP.service)
    return { icon: bubble(<span className="text-[10px] font-semibold">{s.initials}</span>), text: `${first} is picking a time…`, tone: "shimmer" };
  if (step === STEP.slot)
    return {
      icon: bubble(<span className="bg-linear-to-br from-(--hero-accent) to-(--hero-accent-deep) size-2 animate-pulse rounded-full" />),
      text: `Checking availability · holding ${s.when.split(" · ")[1]}…`,
      tone: "shimmer",
    };
  if (step === STEP.confirmed) return { icon: bubble(<Mail className="size-3.5" />), text: "Sending confirmation email…", tone: "shimmer" };
  if (step === STEP.email) return { icon: bubble(<Mail className="size-3.5" />), text: `Confirmation sent to ${first}`, tone: "plain" };
  if (step === STEP.reminder) return { icon: bubble(<BellRing className="size-3.5" />), text: "Reminder scheduled · 24 h before", tone: "plain" };
  return { icon: bubble(<Check className="size-3.5" />, true), text: "Done. Waiting for the next booking…", tone: "muted" };
}

/** Remembers the previous value for `ms` after it changes, so the outgoing
 *  status can animate out while the new one animates in. */
function useOutgoing<T>(value: T, ms: number): T | null {
  const [seen, setSeen] = useState(value);
  const [outgoing, setOutgoing] = useState<T | null>(null);
  if (seen !== value) {
    // Derived-state adjustment during render (React's sanctioned pattern).
    setSeen(value);
    setOutgoing(seen);
  }
  useEffect(() => {
    if (outgoing === null) return;
    const t = window.setTimeout(() => setOutgoing(null), ms);
    return () => window.clearTimeout(t);
  }, [outgoing, ms]);
  return outgoing;
}

function StatusStrip({ step, s }: { step: Step; s: Scenario }) {
  // The strip's text is keyed on what it says, not the raw step, so steps that
  // share a message (intro → service) don't re-animate.
  const cur = statusContent(step, s);
  const curKey = String(cur.text);
  const prevKey = useOutgoing(curKey, 450);
  const prev = prevKey !== null ? statusContent(step === STEP.intro ? STEP.intro : ((step - 1) as Step), s) : null;
  const render = (c: ReturnType<typeof statusContent>, cls: string, key: string) => (
    <span key={key} className={cls}>
      {c.icon}
      <span
        className={cn(
          "truncate",
          c.tone === "shimmer" && styles.shimmer,
          c.tone === "plain" && "text-foreground",
          c.tone === "muted" && "text-muted-foreground",
        )}
      >
        {c.text}
      </span>
    </span>
  );
  return (
    <div className={styles.status}>
      {prev && prevKey !== curKey ? render(prev, styles.statusOut, "out-" + prevKey) : null}
      {render(cur, styles.statusIn, "in-" + curKey)}
    </div>
  );
}

function ActivityPanel({ s, step }: { s: Scenario; step: Step }) {
  const latest = Math.min(step, STEP.confirmed); // the newest message line; older ones dim
  const line = (n: Step, body: React.ReactNode, time: string) =>
    step >= n ? (
      // `.row` grows the line into place and fills forwards (opacity: 1), so the
      // dimming lives on an inner wrapper where the animation's fill can't override it.
      <div key={n} className={styles.row}>
        <div>
          <div className={cn(styles.line, "flex items-start justify-between gap-3 pb-1.5", n < latest && styles.dim)}>
            <span className="min-w-0 text-xs leading-5 sm:text-[13px]">{body}</span>
            <span className="text-muted-foreground shrink-0 font-mono text-[11px] leading-5">{time}</span>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className={cn(step === STEP.leave && styles.leave, "w-56 sm:w-72")} style={{ transformStyle: "preserve-3d" }}>
      <div className={cn(styles.lifted, styles.enter, "bg-popover border-border rounded-xl border p-3 sm:p-3.5")}>
        <div className="flex items-center gap-2.5">
          <span className="bg-(--hero-accent)/15 text-(--hero-accent) flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold">
            {s.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm leading-tight font-medium">{s.name}</span>
            <span className="text-muted-foreground block truncate text-xs">via your booking page</span>
          </span>
        </div>
        <div className="mt-3 -mb-1.5">
          {line(STEP.service, `Picked ${s.service} · ${s.length}`, "0:02")}
          {line(STEP.slot, `Chose ${s.when}`, "0:05")}
          {line(
            STEP.confirmed,
            <>
              Booking confirmed
              <span
                className={cn(
                  styles.pop,
                  "bg-linear-to-r from-(--hero-accent) to-(--hero-accent-deep) text-(--hero-accent-foreground) ml-1.5 hidden items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium sm:inline-flex",
                )}
              >
                <Check className="size-2.5" strokeWidth={3} /> No conflicts
              </span>
            </>,
            "0:06",
          )}
        </div>
      </div>
      {/* translateZ lives on the outer wrapper: the inner `.enter` animation
          animates `transform` and would otherwise overwrite the z-offset. */}
      <div className={cn(styles.lower, "mt-1.5")}>
        <div className={cn(styles.lifted, styles.enter, "bg-popover border-border flex items-center rounded-lg border px-2.5 py-2 text-xs")}>
          <StatusStrip step={step} s={s} />
        </div>
      </div>
    </div>
  );
}

export function HeroCalendar({ className }: { className?: string }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const { i, step, done } = useScenario();
  const s = SCENARIOS[i];

  // Cell state = pre-existing bookings + bookings completed earlier in this loop
  // + the current scenario's cell (held from `slot`, filled from `confirmed`).
  const cellState = (day: number): CellState => {
    if (EVENTS[day]) return { ev: EVENTS[day] };
    const earlier = SCENARIOS.find((sc, idx) => done.includes(idx) && sc.day === day);
    if (earlier) return { ev: { kind: earlier.kind, title: earlier.title, who: earlier.name } };
    if (s.day === day) {
      if (step === STEP.slot) return { hold: true };
      if (step >= STEP.confirmed) return { ev: { kind: s.kind, title: s.title, who: s.name }, fresh: true };
    }
    return {};
  };

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
      {/* Ambient light behind the glass so the blur has something to refract. */}
      <div aria-hidden="true" className={styles.ambient} />
      <div className={styles.stage}>
        <div className={cn(styles.grid, styles.window, styles.glass, "border-border bg-card/70 overflow-hidden rounded-l-lg border-t border-b border-l backdrop-blur-2xl")}>
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
          <div className="grid auto-rows-[3.75rem] grid-cols-7 sm:auto-rows-[5rem] lg:auto-rows-[5.75rem] xl:auto-rows-[6.25rem]">
            {CELLS.map((c) => (
              <DayCell key={`${c.inMonth ? "a" : "j"}${c.day}`} cell={c} state={c.inMonth ? cellState(c.day) : {}} />
            ))}
          </div>
        </div>

        {/* The activity panel floats over the (empty) top-left of the grid, so the
            cells it books into stay visible below it. Keyed by scenario so it remounts
            (and re-enters) for each client. */}
        <div className={styles.panel} style={{ "--z": "70px", left: "3%", top: "9%" } as React.CSSProperties}>
          <ActivityPanel key={i} s={s} step={step} />
        </div>
      </div>
    </div>
  );
}
