"use client";

import * as React from "react";
import { BellRing, Check, ChevronLeft, ChevronRight, Globe, Lock, Timer } from "lucide-react";
import { SPACES } from "@/features/orgs/vocab";
import { cn } from "@/lib/utils";
import { BookloWordmark } from "./booklo-mark";
import { ScaledFrame } from "./browser-frame";

/* The hero showpiece: a client's view of a studio's booking page as one
   card (the studio, its rooms and add-ons, a month, the day's windows and
   the price) playing a short loop: a client's window is considered, the
   price is computed from the studio's rules, a hold is placed with a
   payment deadline, the deposit is paid and the booking confirms, the
   footer reports the confirmation and the reminder, then the next client
   arrives on another day with another room. Every state change is a CSS
   transition on the strong ease-out, so nothing jumps. Decorative
   (aria-hidden; the hero wraps it with a role="img" label). Under reduced
   motion it parks on the paid state and never loops. Sample bookings only;
   every name and price here is fictional. */

type Space = { name: string; blurb: string; meta: string };
const SPACE_LIST: Space[] = [
  { name: "Room A", blurb: "120 m², daylight, cyclorama", meta: "from 140 zł/h" },
  { name: "Room B", blurb: "80 m², blackout, 4 m ceiling", meta: "from 110 zł/h" },
  { name: "Whole studio", blurb: "Rooms A + B, make-up room", meta: "from 320 zł/h" },
];
type AddOn = { name: string; meta: string };
const ADD_ONS: AddOn[] = [
  { name: "Profoto B10 kit", meta: "+50 zł/h" },
  { name: "Make-up room", meta: "+40 zł/h" },
];

type Line = { label: string; amount: string };
type Scenario = {
  client: string;
  day: number;
  weekday: string;
  date: string;
  /** index into SPACE_LIST */
  space: number;
  /** indices into ADD_ONS */
  addOns: number[];
  options: string[];
  /** index into options */
  pick: number;
  lines: Line[];
  total: string;
  deposit: string;
  payBy: string;
};
const SCENARIOS: Scenario[] = [
  {
    client: "Mia Novak", day: 11, weekday: "Saturday", date: "October 11, 2026",
    space: 0, addOns: [0], options: ["8:00 to 10:00", "10:00 to 14:00", "15:00 to 19:00"], pick: 1,
    lines: [
      { label: "Room A, 4 h, 2 h+ tier", amount: "560 zł" },
      { label: "Profoto B10 kit, 4 h", amount: "200 zł" },
    ],
    total: "760 zł", deposit: "228 zł", payBy: "16:40",
  },
  {
    client: "Tom Reyes", day: 17, weekday: "Friday", date: "October 17, 2026",
    space: 2, addOns: [], options: ["8:00 to 12:00", "9:00 to 17:00", "13:00 to 19:00"], pick: 1,
    lines: [
      { label: "Whole studio, 8 h, day tier", amount: "2 400 zł" },
      { label: "3 extra people", amount: "60 zł" },
    ],
    total: "2 460 zł", deposit: "738 zł", payBy: "12:15",
  },
  {
    client: "Lena Fischer", day: 24, weekday: "Friday", date: "October 24, 2026",
    space: 1, addOns: [1], options: ["10:00 to 13:00", "14:00 to 17:00", "18:00 to 21:00"], pick: 2,
    lines: [
      { label: "Room B, 3 h, evening", amount: "360 zł" },
      { label: "Make-up room, 3 h", amount: "120 zł" },
    ],
    total: "480 zł", deposit: "144 zł", payBy: "20:05",
  },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// 35 cells: null = previous/next month, number = day; open days are bookable.
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19, 24, 25, 26]);
const DAYS: (number | null)[] = [null, null, ...Array.from({ length: 30 }, (_, i) => i + 1), null, null, null];

/* One scenario's timeline. `step` is what the card shows; `at` is ms from the
   scenario's start. The next scenario begins NEXT_AT ms after the start. */
const STEP = { idle: 0, hover: 1, hold: 2, paid: 3, notify: 4, remind: 5, leave: 6 } as const;
type Step = (typeof STEP)[keyof typeof STEP];
const TIMELINE: Array<{ at: number; step: Step }> = [
  { at: 0, step: STEP.idle },
  { at: 1400, step: STEP.hover },
  { at: 2400, step: STEP.hold },
  { at: 4200, step: STEP.paid },
  { at: 5000, step: STEP.notify },
  { at: 6200, step: STEP.remind },
  { at: 9200, step: STEP.leave },
];
const NEXT_AT = 9900;

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Drives the loop; under reduced motion parks on scenario 0's paid state. */
function useScenario() {
  const reduced = usePrefersReducedMotion();
  const [state, setState] = React.useState<{ i: number; step: Step }>({ i: 0, step: STEP.idle });

  React.useEffect(() => {
    if (reduced) return;
    let timers: number[] = [];
    let cancelled = false;
    const run = (i: number) => {
      if (cancelled) return;
      timers.forEach(clearTimeout);
      timers = TIMELINE.map(({ at, step }) => window.setTimeout(() => setState({ i, step }), at));
      timers.push(window.setTimeout(() => run((i + 1) % SCENARIOS.length), NEXT_AT));
    };
    run(0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  return reduced ? { i: 0, step: STEP.remind } : state;
}

const EASE = "transition-[background-color,color,box-shadow,opacity] duration-300 ease-strong motion-reduce:transition-none";

export function BookingWidget({ host }: { host: string }) {
  const { i, step } = useScenario();
  const s = SCENARIOS[i];
  const hovering = step === STEP.hover;
  const picked = step >= STEP.hold && step < STEP.leave;
  const held = step === STEP.hold;
  const paid = step >= STEP.paid && step < STEP.leave;
  const notified = step >= STEP.notify && step < STEP.leave;
  const reminded = step >= STEP.remind && step < STEP.leave;
  const first = s.client.split(" ")[0];

  return (
    <div className="relative mx-auto w-full max-w-[960px]">
      <ScaledFrame designWidth={960}>
        <div aria-hidden="true" className="bg-card ring-input overflow-hidden rounded-[24px] text-left shadow-[var(--shadow-card)] ring-1">
          {/* header: the studio, and where this page lives */}
          <div className="flex items-center justify-between px-7 pt-5 pb-4">
            <div className="flex items-center gap-3.5">
              <div className="bg-kind-space-soft text-kind-space-text flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold">H</div>
              <div className="min-w-0">
                <p className="text-foreground truncate text-[17px] leading-tight font-medium">Studio Halo</p>
                <p className="text-muted-foreground mt-0.5 text-xs">Book a room, the whole studio or gear</p>
              </div>
            </div>
            <span className="bg-secondary text-muted-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px]">
              <Lock className="size-3" />
              {host}/studio-halo
            </span>
          </div>

          <div className="grid grid-cols-[250px_1fr_268px] gap-2.5 px-3 pb-3">
            {/* the rooms and the add-ons: a soft panel; the chosen row is a
                white card lifted off it, so the loop's selection visibly
                travels */}
            <div className="bg-secondary rounded-[16px] p-4">
              <p className="text-muted-foreground px-2 pt-1 text-[12px] leading-none font-medium">{SPACES.widgetGroup}</p>
              <ul className="mt-3 flex flex-col gap-1">
                {SPACE_LIST.map((o, idx) => {
                  const sel = idx === s.space;
                  return (
                    <li key={o.name} className={cn("flex items-start gap-3 rounded-[12px] p-3", sel && "bg-card shadow-[var(--shadow-lift)]", EASE)}>
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", sel ? "bg-kind-space text-on-kind" : "bg-card ring-input ring-1 ring-inset", EASE)}>
                        {sel ? <Check className="size-2.5" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block text-sm leading-tight font-medium">{o.name}</span>
                        <span className="text-muted-foreground mt-0.5 block text-[11px]">{o.blurb}</span>
                        <span className="text-muted-foreground mt-1.5 block font-mono text-[10.5px]">{o.meta}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground mt-4 px-2 text-[12px] leading-none font-medium">Add-ons</p>
              <ul className="mt-2 flex flex-col gap-1">
                {ADD_ONS.map((a, idx) => {
                  const on = s.addOns.includes(idx);
                  return (
                    <li key={a.name} className={cn("flex items-center gap-3 rounded-[12px] px-3 py-2.5", on && "bg-card shadow-[var(--shadow-lift)]", EASE)}>
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[5px]", on ? "bg-foreground text-background" : "bg-card ring-input ring-1 ring-inset", EASE)}>
                        {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
                      </span>
                      <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
                      <span className="text-muted-foreground font-mono text-[10.5px]">{a.meta}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-muted-foreground mt-4 flex items-center gap-1.5 px-2 pb-1 text-[11px]">
                <Globe className="size-3" />
                Europe/Warsaw, your local time
              </p>
            </div>

            {/* the month: same panel, white controls floating on it */}
            <div className="bg-secondary rounded-[16px] p-5">
              <div className="flex items-center justify-between">
                <p className="text-foreground text-[16px] font-medium">October 2026</p>
                <div className="flex gap-1.5">
                  <span className="bg-card text-muted-foreground shadow-[var(--shadow-lift)] flex size-8 items-center justify-center rounded-full">
                    <ChevronLeft className="size-3.5" />
                  </span>
                  <span className="bg-card text-foreground shadow-[var(--shadow-lift)] flex size-8 items-center justify-center rounded-full">
                    <ChevronRight className="size-3.5" />
                  </span>
                </div>
              </div>
              <div className="text-muted-foreground mt-4 grid grid-cols-7 text-center font-mono text-[10.5px]">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 justify-items-center gap-y-1.5">
                {DAYS.map((d, idx) => {
                  const open = d !== null && OPEN.has(d);
                  const sel = d === s.day;
                  return (
                    <span
                      key={idx}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full text-[13px]",
                        EASE,
                        d === null && "invisible",
                        !open && "text-subtle",
                        open && !sel && "bg-kind-space-soft text-kind-space-text font-medium",
                        sel && "bg-foreground text-background font-medium",
                      )}
                    >
                      {d ?? ""}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* the window and the price: keyed by scenario so a new client's
                day enters fresh. Windows are white pills floating on the
                panel; the pick becomes ink. Under them the price the rules
                computed, and the one control, which reports the hold and then
                the paid deposit. */}
            <div key={i} className="bg-secondary animate-fade-up flex flex-col rounded-[16px] p-5">
              <p className="text-foreground text-[17px] font-medium">{s.weekday}</p>
              <p className="text-muted-foreground text-xs">
                {s.date}, {SPACE_LIST[s.space].name}
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {s.options.map((t, idx) => {
                  const isPick = idx === s.pick;
                  return (
                    <li
                      key={t}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-full px-3 text-[13px] font-medium",
                        EASE,
                        picked && isPick ? "bg-foreground text-background" : "bg-card text-foreground shadow-[var(--shadow-lift)]",
                        hovering && isPick && "ring-foreground ring-[1.5px] ring-inset",
                        picked && !isPick && "opacity-40",
                      )}
                    >
                      {t}
                    </li>
                  );
                })}
              </ul>

              <div className={cn("mt-4 flex flex-col gap-1.5 text-[12px]", EASE, hovering || picked ? "opacity-100" : "opacity-40")}>
                {s.lines.map((l) => (
                  <div key={l.label} className="text-muted-foreground flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{l.label}</span>
                    <span className="text-foreground shrink-0 font-mono tabular-nums">{l.amount}</span>
                  </div>
                ))}
                <div className="border-border text-foreground flex items-baseline justify-between gap-3 border-t pt-1.5 font-medium">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{s.total}</span>
                </div>
                <div className="text-muted-foreground flex items-baseline justify-between gap-3">
                  <span>Deposit 30%, pay within 4 h</span>
                  <span className="text-foreground shrink-0 font-mono tabular-nums">{s.deposit}</span>
                </div>
              </div>

              <div
                className={cn(
                  "mt-5 flex h-10 items-center justify-center gap-1.5 rounded-full pt-px text-[13px] font-medium",
                  EASE,
                  paid ? "bg-kind-space text-on-kind" : held ? "bg-kind-stay-soft text-kind-stay-text" : "bg-brand text-white",
                )}
              >
                {paid ? (
                  <span className="animate-pop flex items-center gap-1.5">
                    <Check className="size-3.5" strokeWidth={3} />
                    Deposit paid, confirmed
                  </span>
                ) : held ? (
                  <span className="animate-pop flex items-center gap-1.5">
                    <Timer className="size-3.5" strokeWidth={2.5} />
                    Held, pay by {s.payBy}
                  </span>
                ) : (
                  "Hold and pay deposit"
                )}
              </div>
            </div>
          </div>

          {/* footer: what happened, and for whom, told inside the card. */}
          <div className="flex h-12 items-center justify-between px-7 pb-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={cn("text-muted-foreground shrink-0 text-[12px]", EASE, notified && "text-foreground font-medium")}>
                {notified ? `Confirmed, ${s.client}, ${s.deposit} received` : held ? `Hold placed for ${first}` : paid ? `Deposit from ${first}` : "Pick a window, no account needed"}
              </span>
              <span
                className={cn(
                  "bg-secondary flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-[11px] transition-[opacity,transform] duration-300 ease-strong motion-reduce:transition-none",
                  reminded ? "opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                <span className="bg-kind-space-soft text-kind-space-text flex size-4 items-center justify-center rounded-full">
                  <BellRing className="size-2.5" />
                </span>
                <span className="font-medium">Reminder scheduled</span>
                <span className="text-muted-foreground font-mono text-[10px]">24 h before</span>
              </span>
            </div>
            <span className="text-subtle flex items-center gap-1.5 text-[11px]">
              Powered by
              <BookloWordmark className="text-foreground text-[13px]" />
            </span>
          </div>
        </div>
      </ScaledFrame>
    </div>
  );
}
