"use client";

import * as React from "react";
import { BellRing, Check, ChevronLeft, ChevronRight, Globe, Lock } from "lucide-react";
import { toDisplayName } from "@/features/scheduling/handle";
import { SPACES } from "@/features/orgs/vocab";
import { cn } from "@/lib/utils";
import { BookloWordmark } from "./booklo-mark";
import { ScaledFrame } from "./browser-frame";

/* The hero showpiece: a client's view of the booking page as one card —
   provider, what's on offer, a month, the times — playing a short loop: a
   client's slot is highlighted, turns "Booked", the provider's "New booking"
   card and the reminder chip float in beside the card, then the next client
   arrives on another day. Appointments and spaces share the card; only the
   offer list, the options and the copy change. Decorative (aria-hidden); the
   name and address follow the claim bar live. Under reduced motion it parks
   on the booked state and never loops. */

export type WidgetMode = "appointments" | "spaces";

type Offer = { name: string; blurb: string; meta: string };
const OFFERS: Record<WidgetMode, Offer[]> = {
  appointments: [
    { name: "Consultation", blurb: "First session, in person or online", meta: "30 min" },
    { name: "Follow-up", blurb: "For existing clients", meta: "15 min" },
    { name: "Deep dive", blurb: "A full working session", meta: "60 min" },
  ],
  spaces: [
    { name: "Studio A", blurb: "Rehearsal room · 2 units", meta: "by the hour · 1–4 h" },
    { name: "Meeting room", blurb: "Seats 8, screen, whiteboard", meta: "by the hour" },
    { name: "Lake cabin", blurb: "Sleeps 4, self check-in", meta: "per night · min 2 nights" },
  ],
};

type Scenario = {
  client: string;
  initials: string;
  day: number;
  weekday: string;
  date: string;
  /** index into OFFERS[mode] */
  offer: number;
  options: string[];
  /** index into options */
  pick: number;
  /** what the provider's "New booking" card says */
  note: string;
};
const SCENARIOS: Record<WidgetMode, Scenario[]> = {
  appointments: [
    { client: "Mia Novak", initials: "MN", day: 11, weekday: "Saturday", date: "October 11, 2026", offer: 0, options: ["9:00", "10:30", "13:00", "14:30"], pick: 1, note: "Consultation · Sat 10:30" },
    { client: "Tom Reyes", initials: "TR", day: 17, weekday: "Friday", date: "October 17, 2026", offer: 1, options: ["9:00", "11:00", "15:00", "16:30"], pick: 2, note: "Follow-up · Fri 15:00" },
    { client: "Lena Fischer", initials: "LF", day: 24, weekday: "Friday", date: "October 24, 2026", offer: 2, options: ["10:00", "12:30", "14:00", "17:00"], pick: 0, note: "Deep dive · Fri 10:00" },
  ],
  spaces: [
    { client: "Mia Novak", initials: "MN", day: 11, weekday: "Saturday", date: "October 11, 2026", offer: 0, options: ["9:00 – 11:00", "13:00 – 15:00", "16:00 – 18:00"], pick: 1, note: "Studio A · Sat 13:00–15:00" },
    { client: "Tom Reyes", initials: "TR", day: 17, weekday: "Friday", date: "October 17, 2026", offer: 1, options: ["8:00 – 12:00", "12:00 – 16:00", "16:00 – 20:00"], pick: 0, note: "Meeting room · Fri 8:00–12:00" },
    { client: "Lena Fischer", initials: "LF", day: 24, weekday: "Friday", date: "October 24, 2026", offer: 2, options: ["Fri 24 – Sun 26 · 2 nights", "Fri 24 – Mon 27 · 3 nights"], pick: 0, note: "Lake cabin · 2 nights" },
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
function usePrefersReducedMotion() {
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

const SHADOW = "shadow-[0_1px_2px_rgb(26_34_56/0.05),0_18px_40px_-16px_rgb(26_34_56/0.35)]";

export function BookingWidget({ handle, host, mode }: { handle: string; host: string; mode: WidgetMode }) {
  const name = toDisplayName(handle) || "Your Name";
  const initial = name[0]?.toUpperCase() ?? "Y";
  const { i, step } = useScenario(mode);
  const s = SCENARIOS[mode][i];
  const offers = OFFERS[mode];
  const spaces = mode === "spaces";
  const hovering = step === STEP.hover;
  const booked = step >= STEP.booked && step < STEP.leave;
  const leaving = step === STEP.leave;
  const first = s.client.split(" ")[0];

  return (
    // Satellites are positioned against this wrapper (the card's box), not
    // the stage, so their outward offsets stay inside the stage's padding.
    <div className="relative mx-auto w-full max-w-[900px]">
      <div>
        <ScaledFrame designWidth={900}>
          <div
            aria-hidden="true"
            className="bg-card ring-border/70 overflow-hidden rounded-[28px] text-left shadow-[0_2px_6px_rgb(26_34_56/0.06),0_40px_90px_-40px_rgb(26_34_56/0.45)] ring-1"
          >
            {/* header: who, and where this page lives */}
            <div className="border-border flex items-center justify-between border-b px-7 py-5">
              <div className="flex items-center gap-3.5">
                <div className="bg-highlight text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-2xl text-lg font-medium">
                  {initial}
                </div>
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

            <div className="grid grid-cols-[250px_1fr_236px]">
              {/* what's on offer */}
              <div className="border-border border-r p-6">
                <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">{spaces ? SPACES.widgetGroup : "Services"}</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {offers.map((o, idx) => {
                    const sel = idx === s.offer;
                    return (
                      <li
                        key={o.name}
                        className={cn(
                          "flex items-start gap-3 rounded-xl p-3 ring-1 transition-[background-color,box-shadow] duration-500",
                          sel ? "bg-highlight/6 ring-highlight" : "ring-border",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-500",
                            sel ? "bg-highlight ring-highlight text-primary-foreground" : "ring-input",
                          )}
                        >
                          {sel ? <Check className="size-2.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground block text-sm leading-tight font-medium">{o.name}</span>
                          <span className="text-muted-foreground mt-0.5 block text-[11px]">{o.blurb}</span>
                          <span className="text-muted-foreground mt-1.5 block font-mono text-[10px] tracking-wider uppercase">{o.meta}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-muted-foreground mt-5 flex items-center gap-1.5 text-[11px]">
                  <Globe className="size-3" />
                  Europe/Warsaw · your local time
                </p>
              </div>

              {/* the month */}
              <div className="border-border border-r p-6">
                <div className="flex items-center justify-between">
                  <p className="text-foreground text-[15px] font-medium">October 2026</p>
                  <div className="flex gap-1.5">
                    <span className="bg-secondary text-muted-foreground flex size-8 items-center justify-center rounded-full">
                      <ChevronLeft className="size-3.5" />
                    </span>
                    <span className="bg-secondary text-foreground flex size-8 items-center justify-center rounded-full">
                      <ChevronRight className="size-3.5" />
                    </span>
                  </div>
                </div>
                <div className="text-muted-foreground mt-4 grid grid-cols-7 text-center font-mono text-[10px] tracking-wider uppercase">
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
                          "flex size-9 items-center justify-center rounded-full text-[13px] transition-colors duration-500",
                          d === null && "invisible",
                          !open && "text-muted-foreground/50",
                          open && !sel && "bg-highlight/10 text-highlight font-medium",
                          sel && "bg-highlight text-primary-foreground font-medium",
                        )}
                      >
                        {d ?? ""}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* the time */}
              <div className="p-6">
                <p className="text-foreground text-[17px] font-medium">{s.weekday}</p>
                <p className="text-muted-foreground text-xs">
                  {s.date}
                  {spaces ? ` · ${offers[s.offer].name}` : ""}
                </p>
                <ul className="mt-4 flex flex-col gap-2">
                  {s.options.map((t, idx) => {
                    const isPick = idx === s.pick;
                    return (
                      <li
                        key={t}
                        className={cn(
                          "flex h-10 items-center justify-center rounded-xl px-3 text-[13px] font-medium transition-[background-color,color,box-shadow,opacity] duration-400",
                          booked && isPick ? "bg-highlight text-primary-foreground" : "bg-tint text-foreground",
                          hovering && isPick && "ring-highlight ring-2 ring-inset",
                          booked && !isPick && "opacity-50",
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

            <div className="border-border bg-secondary/50 flex items-center justify-between border-t px-7 py-3">
              <span className="text-muted-foreground text-[11px] transition-opacity duration-300">
                {booked ? `Confirmation sent to ${first}` : "Pick a time — no account needed"}
              </span>
              <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase">
                Powered by
                <BookloWordmark className="text-foreground text-[12px] tracking-normal normal-case" />
              </span>
            </div>
          </div>
        </ScaledFrame>
      </div>

      {/* Satellites: what the provider sees the moment the client books.
          md+ only — on phones they'd cover the card. */}
      {step >= STEP.notify ? (
        <div
          aria-hidden="true"
          className={cn("animate-fade-up absolute bottom-8 -left-3 hidden w-60 transition-opacity duration-500 md:block lg:-left-24", leaving && "opacity-0")}
        >
          <div className={cn("bg-card ring-border animate-float rounded-xl p-3 ring-1", SHADOW)}>
            <div className="flex items-center gap-2.5">
              <span className="bg-highlight/12 text-highlight flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                {s.initials}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] leading-tight font-medium">New booking · {s.client}</span>
                <span className="text-muted-foreground mt-0.5 block truncate font-mono text-[10px]">{s.note}</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      {step >= STEP.remind ? (
        <div
          aria-hidden="true"
          className={cn("animate-fade-up absolute -top-5 -right-3 hidden transition-opacity duration-500 md:block lg:-right-16", leaving && "opacity-0")}
        >
          <div className={cn("bg-card ring-border animate-float-slow flex items-center gap-2 rounded-full py-2 pr-4 pl-2 text-xs ring-1", SHADOW)}>
            <span className="bg-highlight/12 text-highlight flex size-6 shrink-0 items-center justify-center rounded-full">
              <BellRing className="size-3.5" />
            </span>
            <span className="font-medium">Reminder scheduled</span>
            <span className="text-muted-foreground font-mono text-[10px]">24 h before</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
