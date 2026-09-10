"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { ArrowRight, Check, Clock, Copy, Inbox, Layers, Package, Wallet } from "lucide-react";
import { HOW_HEADING, HOW_LABEL, HOW_STEPS, HOW_SUB } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* How it works (semaloop.com-referenced, 2026-09-09): an ink panel pinned
   under the nav while the page scrolls four screens; five beats advance
   as invisible sentinels cross the viewport's middle. Left, one product
   card per beat (the app's own light fragments on the ink), crossfading,
   its rows entering 50ms apart once it is on, with one moment of its own
   (a count, a copied link, a paid chip); right, the five titles, the
   active one white with its line unfolding beneath (globals.css "How it
   works"). The beat change is a transition on the strong ease-out, so a
   fast scroll retargets instead of restarting; reduced motion swaps
   instantly. Under md the panel stacks the card
   above the active step alone (the other titles would eat the stage)
   and stays pinned the same way. The ink itself is a layer under the
   content that grows with the scroll as the panel arrives (the
   reference's move): a CSS scroll-driven scale from the content's box to
   near full-bleed, the ratios measured here on resize so the scrub stays
   on the compositor. */
const BEAT_VH = 80;
const GROW_INSET_X = 32; // the grown ink's margin to the viewport's sides
const GROW_INSET_Y = 56; // and to its top and bottom

/** Writes --sx/--sy on the panel: how far its ink may grow. */
function useGrowRatios(ref: React.RefObject<HTMLDivElement | null>) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--sx", Math.max(1, (window.innerWidth - GROW_INSET_X * 2) / r.width).toFixed(4));
      el.style.setProperty("--sy", Math.max(1, (window.innerHeight - GROW_INSET_Y * 2) / r.height).toFixed(4));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
}

/* Which beat the scroll is on, from the sentinels' geometry: they tile the
   section at one height each (BEAT_VH), so the first one's box answers it
   alone — how many of their tops the viewport's middle has passed, clamped
   to the five. Read on a frame, never per event.

   Geometry rather than an IntersectionObserver on each sentinel (until
   2026-09-10): that only ever spoke while the middle line was INSIDE a
   sentinel, so above the section and past its end the panel kept whatever
   it last showed — and a jump between two such places (back-to-top from
   the footer) fired no callback at all, leaving the panel on step five for
   the visitor's whole next pass through it. */
function useScrollBeat(count: number) {
  const refs = React.useRef<(HTMLElement | null)[]>([]);
  const [beat, setBeat] = React.useState(0);
  React.useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const first = refs.current[0];
      if (!first) return;
      const { top, height } = first.getBoundingClientRect();
      if (height === 0) return;
      const passed = Math.floor((window.innerHeight / 2 - top) / height);
      setBeat(Math.min(count - 1, Math.max(0, passed)));
    };
    const onFrame = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onFrame, { passive: true });
    window.addEventListener("resize", onFrame, { passive: true });
    return () => {
      window.removeEventListener("scroll", onFrame);
      window.removeEventListener("resize", onFrame);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [count]);
  const register = (i: number) => (el: HTMLElement | null) => {
    refs.current[i] = el;
  };
  return { beat, register };
}

const VISUALS: React.ComponentType<{ host: string }>[] = [VisualSpaces, VisualShare, VisualBooking, VisualChanges, VisualMorning];

export function HowItWorks({ host }: { host: string }) {
  const { beat, register } = useScrollBeat(HOW_STEPS.length);
  const panel = React.useRef<HTMLDivElement>(null);
  useGrowRatios(panel);
  return (
    <section aria-labelledby="how-heading" className="how relative mx-auto w-full max-w-6xl px-4 pt-24 sm:px-8 sm:pt-32">
      {/* the section's words, above the pinned panel: they scroll away as
          the ink arrives. The gap below them is the ink's, not theirs
          (globals.css .how-track) — it has to clear the ink's growth. */}
      <div className="mx-auto max-w-[38rem] text-center">
        <h2 id="how-heading" className="text-foreground text-[28px] leading-[1.15] font-medium tracking-[-0.02em] text-balance sm:text-[36px]">
          {HOW_HEADING}
        </h2>
        <p className="text-muted-foreground mt-4 text-[17px] leading-relaxed text-balance">{HOW_SUB}</p>
      </div>
      {/* The panel and the scroll it eats, as one box: the ink's growth is
          scrubbed by THIS box entering the viewport (globals.css), so the
          words above it never move the timeline. */}
      <div className="how-track">
      <div ref={panel} className="how-panel text-primary-foreground sticky top-20 isolate flex h-[min(640px,calc(100dvh-112px))] flex-col p-5 sm:top-24 sm:p-8 md:p-10">
        <div aria-hidden="true" className="how-bg" />
        <div className="flex items-baseline justify-between text-[14px]">
          <p className="font-medium">{HOW_LABEL}</p>
          <p className="text-primary-foreground/50 tabular-nums">
            {String(beat + 1).padStart(2, "0")} / {String(HOW_STEPS.length).padStart(2, "0")}
          </p>
        </div>

        {/* the stage row takes what the steps leave (its cards are absolute,
            so it has no height of its own) */}
        <div className="mt-4 grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-6 md:mt-0 md:grid-cols-[1fr_minmax(0,22rem)] md:grid-rows-1 md:gap-12 lg:grid-cols-[1fr_minmax(0,24rem)]">
          {/* the cards, one per beat, stacked on a hairline (the reference's rail) */}
          <div aria-hidden="true" className="relative min-h-0 md:before:absolute md:before:top-0 md:before:bottom-[-40px] md:before:left-1/2 md:before:w-px md:before:bg-white/10">
            {VISUALS.map((Visual, i) => (
              <div key={i} data-active={i === beat ? "" : undefined} className="how-visual absolute inset-0 flex items-center justify-center">
                <Visual host={host} />
              </div>
            ))}
          </div>

          {/* the steps: every one stays in the tree; under md only the
              active one is drawn, the rest read to assistive tech */}
          <ol className="self-start md:mt-8">
            {HOW_STEPS.map((s, i) => (
              <li
                key={s.title}
                data-active={i === beat ? "" : undefined}
                aria-current={i === beat ? "step" : undefined}
                className="how-step border-primary-foreground/10 grid grid-cols-[2ch_1fr] gap-x-4 py-3 not-data-active:max-md:sr-only md:border-t md:py-5 md:first:border-t-0"
              >
                <span className="text-primary-foreground/55 pt-[5px] text-[13px] tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="how-step-title text-[17px] leading-snug font-medium tracking-[-0.01em] md:text-[19px] lg:text-[21px]">{s.title}</h3>
                  <div className="how-step-body">
                    <p className="text-primary-foreground/70 min-h-0 overflow-hidden text-[15px] leading-relaxed md:text-[16px]">
                      <span className="block pt-2">{s.body}</span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* the scroll: one sentinel per beat, crossing the viewport's middle */}
      <div aria-hidden="true">
        {HOW_STEPS.map((s, i) => (
          <div key={s.title} ref={register(i)} data-beat={i} style={{ height: `${BEAT_VH}vh` }} />
        ))}
      </div>
      </div>
    </section>
  );
}

/* The five cards: the app's light fragments, fixed at 340px so the ink
   panel frames them the same on every beat. Fictional Studio Halo. */
function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("how-card bg-card text-card-foreground relative w-full max-w-[380px] rounded-[14px] text-[13px] shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)]", className)}>{children}</div>;
}
function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-border flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0", className)}>{children}</div>;
}
const RoomIcon = () => <HugeiconsIcon icon={House01Icon} size={15} className="text-muted-foreground shrink-0" aria-hidden />;

function VisualSpaces() {
  return (
    <Card>
      <Row className="justify-between">
        <span className="font-medium">Spaces</span>
        <span className="how-count-5 text-muted-foreground tabular-nums" />
      </Row>
      {[
        ["Room A", "140 zł / h"],
        ["Room B", "110 zł / h"],
        ["Make-up room", "60 zł / h"],
      ].map(([n, p]) => (
        <Row key={n}>
          <RoomIcon />
          <span className="flex-1">{n}</span>
          <span className="text-muted-foreground tabular-nums">{p}</span>
        </Row>
      ))}
      <Row>
        <Layers className="text-muted-foreground size-[15px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">
          Whole studio
          <span className="text-muted-foreground block text-[12px]">Room A + Room B + Make-up room</span>
        </span>
        <span className="text-muted-foreground tabular-nums">320 zł / h</span>
      </Row>
      <Row>
        <Package className="text-muted-foreground size-[15px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">
          Profoto B10 kit
          <span className="text-muted-foreground block text-[12px]">2 units, shared between rooms</span>
        </span>
        <span className="text-muted-foreground tabular-nums">50 zł / h</span>
      </Row>
    </Card>
  );
}

function VisualShare({ host }: { host: string }) {
  return (
    <Card>
      <div className="px-4 pt-4 pb-3">
        <p className="text-muted-foreground text-[12px]">Your booking page</p>
        <div className="bg-secondary mt-2 flex items-center gap-2 rounded-lg px-3 py-2">
          <span className="flex-1 truncate font-medium">{host}/studio-halo</span>
          <span className="relative grid size-4 shrink-0 place-items-center">
            <Copy className="how-copy text-muted-foreground col-start-1 row-start-1 size-4" strokeWidth={1.75} aria-hidden="true" />
            <Check className="how-copied col-start-1 row-start-1 size-4 text-[#0f7a3d]" strokeWidth={2.25} aria-hidden="true" />
          </span>
        </div>
      </div>
      <div className="border-border border-t px-4 pt-3 pb-4">
        <p className="text-muted-foreground text-[12px]">On your own site</p>
        <pre className="text-muted-foreground mt-2 overflow-hidden font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {`<script src="https://${host}/embed.js"\n  data-page="studio-halo" async></script>`}
        </pre>
      </div>
    </Card>
  );
}

function VisualBooking() {
  return (
    <Card>
      <div className="px-4 pt-4 pb-3">
        <p className="font-medium">Room A · 2 h</p>
        <p className="text-muted-foreground">Wed 7 Oct, 15:00–17:00</p>
      </div>
      <Row className="justify-between">
        <span>2 h × 140 zł</span>
        <span className="tabular-nums">280 zł</span>
      </Row>
      <Row className="justify-between">
        <span>Deposit, 50%</span>
        <span className="flex items-center gap-2 tabular-nums">
          140 zł
          <span className="how-paid bg-success/15 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium text-[#0f7a3d]">
            <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
            Paid
          </span>
        </span>
      </Row>
      <Row className="text-muted-foreground justify-between text-[12px]">
        <span>Held until</span>
        <span>Tue 6 Oct, 12:00</span>
      </Row>
    </Card>
  );
}

function VisualChanges() {
  return (
    <Card>
      <Row className="justify-between">
        <span className="flex items-center gap-2">
          <ArrowRight className="text-brand-text size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          Moved to Thu 8 Oct, 11:00
        </span>
        <span className="text-muted-foreground tabular-nums">fee 40 zł</span>
      </Row>
      <Row className="justify-between">
        <span className="flex items-center gap-2">
          <Clock className="text-brand-text size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          30 min over
        </span>
        <span className="text-muted-foreground tabular-nums">+70 zł</span>
      </Row>
      <Row className="justify-between">
        <span className="font-medium">Balance to pay</span>
        <span className="how-count-110 font-medium tabular-nums" />
      </Row>
    </Card>
  );
}

function VisualMorning() {
  return (
    <Card>
      <Row className="justify-between">
        <span className="font-medium">Friday 9 Oct</span>
        <span className="text-muted-foreground tabular-nums">08:00</span>
      </Row>
      <Row>
        <Clock className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">2 holds expire today</span>
      </Row>
      <Row>
        <Inbox className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">1 request waiting</span>
      </Row>
      <Row>
        <Wallet className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="flex-1">Balance due, Anna Kowalska</span>
        <span className="text-muted-foreground tabular-nums">110 zł</span>
      </Row>
    </Card>
  );
}
