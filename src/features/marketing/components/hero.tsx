"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { HERO_TABS, SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";
import { BookingWidget, type WidgetMode } from "./booking-widget";

/* The first viewport, the way gumloop.com and main's landing do it: a
   centred two-line headline at weight 500, the sub, the claim bar as the
   one action, three check-marked truths; then the product at real size on
   a soft grey stage, with an Appointments / Spaces switch sitting on the
   stage's top edge that flips the booking-page card between the two things
   the page books. The switch's ink pill is one clip-path-revealed copy of
   the row, so it glides between the options with background and label
   colour moving as one element; the card below enters from the chosen
   tab's side. The hero owns the handle and the switch. Everything enters
   on one short stagger. */

type View = { mode: WidgetMode; from: "none" | "left" | "right" };

export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  const [view, setView] = React.useState<View>({ mode: "appointments", from: "none" });
  const mode = view.mode;
  const [line1, line2] = SITE.headline;

  /* The pill's clip, measured from the active button (natural widths, no
     equal-column compromise). useLayoutEffect sets it before paint; the
     ResizeObserver keeps it honest across font swaps and zoom. */
  const listRef = React.useRef<HTMLDivElement>(null);
  const [clip, setClip] = React.useState<string | null>(null);
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const btn = list.querySelector<HTMLElement>(`button[data-mode="${mode}"]`);
      if (!btn) return;
      const right = list.clientWidth - btn.offsetLeft - btn.offsetWidth;
      const bottom = list.clientHeight - btn.offsetTop - btn.offsetHeight;
      setClip(`inset(${btn.offsetTop}px ${right}px ${bottom}px ${btn.offsetLeft}px round 9999px)`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [mode]);

  return (
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-14 text-center sm:px-8 lg:pt-16">
        <h1
          id="hero-heading"
          className="text-foreground text-[32px] leading-[1.06] font-medium tracking-[-0.03em] text-balance min-[430px]:text-[36px] sm:max-w-[16ch] sm:text-[52px] lg:text-[60px]"
        >
          <span className="animate-fade-up block">{line1}</span>
          <span className="animate-fade-up block [animation-delay:60ms]">{line2}</span>
        </h1>

        <p className="animate-fade-up text-muted-foreground mt-5 max-w-[36rem] text-[17px] leading-relaxed text-balance [animation-delay:120ms] sm:text-lg">
          {SITE.subheadline}
        </p>

        <ClaimBar
          handle={handle}
          onHandleChange={setHandle}
          host={host}
          idleNote={SITE.heroNote}
          size="lg"
          className="animate-fade-up mt-8 max-w-[520px] text-left [animation-delay:180ms]"
        />

        <ul aria-label="What the page guarantees" className="animate-fade-up text-muted-foreground mt-6 flex flex-wrap justify-center gap-x-[18px] gap-y-2 text-[14px] [animation-delay:240ms]">
          {SITE.truths.map((t) => (
            <li key={t} className="flex items-center gap-[7px] whitespace-nowrap">
              <Check className="text-kind-space size-4" strokeWidth={3} aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      </div>

      {/* the stage */}
      <div className="animate-fade-up relative mx-auto mt-14 w-full max-w-6xl px-5 [animation-delay:320ms] sm:px-8 lg:mt-16">
        {/* The switch, straddling the stage's top edge. Toggle buttons rather
            than a full tablist: two options, both always visible. The real
            buttons all wear the inactive style; the ink pill is the
            aria-hidden active-styled copy after them, revealed by an
            animated clip. */}
        <div className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 justify-center">
          <div ref={listRef} className="bg-card ring-input relative flex gap-1 rounded-full p-1 ring-1 shadow-[var(--shadow-card)]">
            {HERO_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                data-mode={t.id}
                aria-pressed={mode === t.id}
                aria-controls="hero-preview"
                onClick={() => setView((v) => (v.mode === t.id ? v : { mode: t.id, from: t.id === "spaces" ? "right" : "left" }))}
                className="focus-visible:ring-ring text-muted-foreground rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-[color,transform] duration-200 ease-strong outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
              >
                {t.label}
              </button>
            ))}
            <div
              aria-hidden="true"
              className="bg-primary text-primary-foreground pointer-events-none absolute inset-0 flex gap-1 rounded-full p-1 transition-[clip-path] duration-[250ms] ease-in-out-strong motion-reduce:transition-none"
              style={clip ? { clipPath: clip } : { visibility: "hidden" }}
            >
              {HERO_TABS.map((t) => (
                <span key={t.id} className="px-4 py-1.5 text-[13.5px] font-medium whitespace-nowrap">
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          id="hero-preview"
          role="img"
          aria-label={
            mode === "spaces"
              ? "An example booking page for spaces: a client picks a studio, a day and a window of hours, and is booked; the confirmation and the reminder follow."
              : "An example booking page for appointments: a client picks a service, a day and a time, and is booked; the confirmation and the reminder follow."
          }
          className="bg-secondary relative rounded-[28px] px-4 pt-12 pb-5 sm:px-8 sm:pt-14 sm:pb-8 lg:px-12 lg:pt-16 lg:pb-12"
        >
          <BookingWidget handle={handle} host={host} mode={mode} enterFrom={view.from === "none" ? null : view.from} />
        </div>
      </div>
    </section>
  );
}
