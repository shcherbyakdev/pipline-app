"use client";

import * as React from "react";
import { BellRing, Check, ChevronLeft, ChevronRight, Globe, Lock } from "lucide-react";
import { toDisplayName } from "@/features/scheduling/handle";
import { SPACES } from "@/features/orgs/vocab";
import { cn } from "@/lib/utils";
import { BookloWordmark } from "./booklo-mark";
import { ScaledFrame } from "./browser-frame";

/* The hero showpiece: a client's view of the booking page as one card
   (provider, what's on offer, a month, the times) playing a short loop: a
   client's slot is considered, turns "Booked", the footer reports the
   confirmation and the scheduled reminder, then the next client arrives on
   another day. Appointments and spaces share the card; only the offer
   list, the options and the copy change, and the channel's colour marks
   the open days and the chosen offer. Nothing floats: everything the loop
   shows happens inside the card. Every state change is a CSS transition
   on the strong ease-out, so a mode switch mid-loop retargets cleanly.
   Decorative (aria-hidden); the name and address follow the claim bar
   live. Under reduced motion it parks on the reminded state and never
   loops. Sample bookings only; every name here is fictional. */

export type WidgetMode = "appointments" | "spaces";

type Offer = { name: string; blurb: string; meta: string };
const OFFERS: Record<WidgetMode, Offer[]> = {
  appointments: [
    { name: "Consultation", blurb: "First session, in person or online", meta: "30 min" },
    { name: "Follow-up", blurb: "For existing clients", meta: "15 min" },
    { name: "Deep dive", blurb: "A full working session", meta: "60 min" },
  ],
  spaces: [
    { name: "Studio A", blurb: "Rehearsal room, 2 units", meta: "by the hour, 1 to 4 h" },
    { name: "Meeting room", blurb: "Seats 8, screen, whiteboard", meta: "by the hour" },
    { name: "Lake cabin", blurb: "Sleeps 4, self check-in", meta: "per night, 2 nights min" },
  ],
};

type Scenario = {
  client: string;
  day: number;
  weekday: string;
  date: string;
  /** index into OFFERS[mode] */
  offer: number;
  options: string[];
  /** index into options */
  pick: number;
};
const SCENARIOS: Record<WidgetMode, Scenario[]> = {
  appointments: [
    { client: "Mia Novak", day: 11, weekday: "Saturday", date: "October 11, 2026", offer: 0, options: ["9:00", "10:30", "13:00", "14:30"], pick: 1 },
    { client: "Tom Reyes", day: 17, weekday: "Friday", date: "October 17, 2026", offer: 1, options: ["9:00", "11:00", "15:00", "16:30"], pick: 2 },
    { client: "Lena Fischer", day: 24, weekday: "Friday", date: "October 24, 2026", offer: 2, options: ["10:00", "12:30", "14:00", "17:00"], pick: 0 },
  ],
  spaces: [
    { client: "Mia Novak", day: 11, weekday: "Saturday", date: "October 11, 2026", offer: 0, options: ["9:00 to 11:00", "13:00 to 15:00", "16:00 to 18:00"], pick: 1 },
    { client: "Tom Reyes", day: 17, weekday: "Friday", date: "October 17, 2026", offer: 1, options: ["8:00 to 12:00", "12:00 to 16:00", "16:00 to 20:00"], pick: 0 },
    { client: "Lena Fischer", day: 24, weekday: "Friday", date: "October 24, 2026", offer: 2, options: ["Fri 24 to Sun 26, 2 nights", "Fri 24 to Mon 27, 3 nights"], pick: 0 },
  ],
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// 35 cells: null = previous/next month, number = day; open days are bookable.
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19, 24, 25, 26]);
const DAYS: (number | null)[] = [null, null, ...Array.from({ length: 30 }, (_, i) => i + 1), null, null, null];

/* One scenario's timeline. `step` is what the card shows; `at` is ms from the
   scenario's start. The next scenario begins NEXT_AT ms after the start. */
const STEP = { idle: 0, hover: 1, booked: 2, notify: 3, remind: 4, leave: 5 } as const;
type Step = (typeof STEP)[keyof typeof STEP];
const TIMELINE: Array<{ at: number; step: Step }> = [
  { at: 0, step: STEP.idle },
  { at: 1400, step: STEP.hover },
  { at: 2400, step: STEP.booked },
  { at: 3500, step: STEP.notify },
  { at: 4900, step: STEP.remind },
  { at: 8000, step: STEP.leave },
];
const NEXT_AT = 8700;

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

/** Drives the loop. Restarts from the first scenario whenever the mode
 *  changes; under reduced motion parks on scenario 0's reminded state. */
function useScenario(mode: WidgetMode) {
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
      timers.push(window.setTimeout(() => run((i + 1) % SCENARIOS[mode].length), NEXT_AT));
    };
    run(0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [mode, reduced]);

  return reduced ? { i: 0, step: STEP.remind } : state;
}

/* The channel's colour: appointments blue, spaces green. Used for the open
   days, the chosen offer's check and the avatar; the booked slot itself is
   ink, like every control. */
const KIND = {
  appointments: { soft: "bg-kind-time-soft", text: "text-kind-time-text", fill: "bg-kind-time" },
  spaces: { soft: "bg-kind-space-soft", text: "text-kind-space-text", fill: "bg-kind-space" },
} as const;

const EASE = "transition-[background-color,color,box-shadow,opacity] duration-300 ease-strong motion-reduce:transition-none";

export function BookingWidget({ handle, host, mode, enterFrom = null }: { handle: string; host: string; mode: WidgetMode; enterFrom?: "left" | "right" | null }) {
  const name = toDisplayName(handle) || "Your Name";
  const initial = name[0]?.toUpperCase() ?? "Y";
  const { i, step } = useScenario(mode);
  const s = SCENARIOS[mode][i];
  const offers = OFFERS[mode];
  const spaces = mode === "spaces";
  const k = KIND[mode];
  const hovering = step === STEP.hover;
  const booked = step >= STEP.booked && step < STEP.leave;
  const notified = step >= STEP.notify && step < STEP.leave;
  const reminded = step >= STEP.remind && step < STEP.leave;
  const first = s.client.split(" ")[0];

  return (
    <div className="relative mx-auto w-full max-w-[900px]">
      <ScaledFrame designWidth={900}>
        <div aria-hidden="true" className="bg-card ring-input overflow-hidden rounded-[24px] text-left shadow-[var(--shadow-card)] ring-1">
          {/* header: who, and where this page lives. No hairline: the panels
              below carry the separation. */}
          <div className="flex items-center justify-between px-7 pt-5 pb-4">
            <div className="flex items-center gap-3.5">
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold", k.soft, k.text, EASE)}>{initial}</div>
              <div className="min-w-0">
                <p className="text-foreground truncate text-[17px] leading-tight font-medium">{name}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">{spaces ? "Book a space" : "Book a session"}</p>
              </div>
            </div>
            <span className="bg-secondary text-muted-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px]">
              <Lock className="size-3" />
              {host}/{handle || "your-name"}
            </span>
          </div>

          {/* keyed by mode so a switch mounts fresh, entering from the chosen
              tab's side (or with the page's fade on first mount) */}
          <div
            key={mode}
            className={cn(
              "grid grid-cols-[250px_1fr_236px] gap-2.5 px-3 pb-3",
              enterFrom === "right" ? "animate-enter-right" : enterFrom === "left" ? "animate-enter-left" : "animate-fade-up",
            )}
          >
            {/* what's on offer: a soft panel; the chosen offer is a white row
                lifted off it, so the loop's selection visibly travels */}
            <div className="bg-secondary rounded-[16px] p-4">
              <p className="text-muted-foreground px-2 pt-1 text-[12px] leading-none font-medium">{spaces ? SPACES.widgetGroup : "Services"}</p>
              <ul className="mt-3 flex flex-col gap-1">
                {offers.map((o, idx) => {
                  const sel = idx === s.offer;
                  return (
                    <li key={o.name} className={cn("flex items-start gap-3 rounded-[12px] p-3", sel && "bg-card shadow-[var(--shadow-lift)]", EASE)}>
                      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", sel ? cn(k.fill, "text-on-kind") : "bg-card ring-input ring-1 ring-inset", EASE)}>
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
                        open && !sel && cn(k.soft, k.text, "font-medium"),
                        sel && "bg-foreground text-background font-medium",
                      )}
                    >
                      {d ?? ""}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* the time: keyed by scenario so a new client's day enters fresh.
                Times are white pills floating on the panel; the pick books as
                an ink pill. */}
            <div key={i} className="bg-secondary animate-fade-up rounded-[16px] p-5">
              <p className="text-foreground text-[17px] font-medium">{s.weekday}</p>
              <p className="text-muted-foreground text-xs">
                {s.date}
                {spaces ? `, ${offers[s.offer].name}` : ""}
              </p>
              <ul className="mt-4 flex flex-col gap-2">
                {s.options.map((t, idx) => {
                  const isPick = idx === s.pick;
                  return (
                    <li
                      key={t}
                      className={cn(
                        "flex h-10 items-center justify-center rounded-full px-3 text-[13px] font-medium",
                        EASE,
                        booked && isPick ? "bg-foreground text-background" : "bg-card text-foreground shadow-[var(--shadow-lift)]",
                        hovering && isPick && "ring-foreground ring-[1.5px] ring-inset",
                        booked && !isPick && "opacity-40",
                      )}
                    >
                      {booked && isPick ? (
                        <span className="animate-pop flex items-center gap-1.5">
                          <Check className="size-3.5" strokeWidth={3} />
                          Booked
                        </span>
                      ) : (
                        t
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* footer: what happened, and for whom, told inside the card. On the
              card's own white; no hairline. */}
          <div className="flex h-12 items-center justify-between px-7 pb-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={cn("text-muted-foreground shrink-0 text-[12px]", EASE, notified && "text-foreground font-medium")}>
                {notified ? `New booking, ${s.client}` : booked ? `Confirmation sent to ${first}` : "Pick a time, no account needed"}
              </span>
              <span
                className={cn(
                  "bg-secondary flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-[11px] transition-[opacity,transform] duration-300 ease-strong motion-reduce:transition-none",
                  reminded ? "opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                <span className={cn("flex size-4 items-center justify-center rounded-full", k.soft, k.text)}>
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
