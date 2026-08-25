"use client";

import * as React from "react";
import { BellRing } from "lucide-react";
import { HERO_TABS, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { ClaimBar } from "./claim-bar";
import { BrowserFrame, ScaledFrame } from "./browser-frame";
import { BookingPageMock, type MockMode } from "./mocks/booking-page-mock";

/* Full-viewport hero: two-line headline (the second line — the promise — in
   the accent), claim bar, and a tinted stage panel holding the booking-page
   mockup that mirrors the typed handle. A dotted line runs from the bar down
   to a tab pill sitting on the stage's top edge — Appointments / Spaces —
   which flips the mockup between the two things the page books. Two
   satellite cards float over the stage's edges: what happens once the page
   is live. The hero owns the handle and the tab state. */
export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  const [mode, setMode] = React.useState<MockMode>("appointments");
  const [line1, line2] = SITE.headline;

  return (
    // Fills the first viewport from md up; on phones the content is shorter
    // than the screen, so the spacers stay at their minimums instead of
    // stretching the connector.
    <section aria-labelledby="hero-heading" className="relative flex flex-col overflow-x-clip md:min-h-[calc(100svh-4rem)]">
      <div className="min-h-10 flex-1 shrink-0 sm:min-h-14 lg:min-h-20" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 text-center">
        <h1
          id="hero-heading"
          className="text-foreground text-[42px] leading-[1.02] font-medium tracking-[-0.035em] min-[400px]:text-[46px] sm:text-6xl lg:text-7xl xl:text-[80px]"
        >
          <span className="sr-only">{`${line1} ${line2}`}</span>
          <span aria-hidden="true">
            <span className="animate-fade-up block">{line1}</span>
            <span className="animate-fade-up text-highlight block [animation-delay:100ms]">{line2}</span>
          </span>
        </h1>

        <p className="animate-fade-up text-muted-foreground mt-5 max-w-lg text-base text-balance [animation-delay:220ms] sm:mt-6 sm:text-lg">
          {SITE.subheadline}
        </p>

        <ClaimBar
          handle={handle}
          onHandleChange={setHandle}
          host={host}
          idleNote={SITE.heroNote}
          size="lg"
          className="animate-fade-up mt-7 max-w-xl [animation-delay:340ms] sm:mt-8"
        />
      </div>

      {/* The typed name flows down into the page: a dotted connector from the
          claim bar to the tab pill on the stage. Decorative. */}
      <div aria-hidden="true" className="animate-fade-up flex min-h-12 flex-1 shrink-0 justify-center [animation-delay:560ms] sm:min-h-16">
        <span className="w-0.5 bg-[repeating-linear-gradient(to_bottom,var(--highlight)_0_3px,transparent_3px_9px)] opacity-60" />
      </div>

      <div className="animate-hero-rise relative mx-auto w-[94%] max-w-6xl shrink-0 [animation-delay:620ms]">
        {/* Tab pill, straddling the stage's top edge. Toggle buttons rather
            than a full tablist: two options, both always visible. */}
        <div className="absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 justify-center">
          <div className="bg-card ring-border flex gap-1 rounded-full p-1 ring-1 shadow-[0_1px_2px_rgb(26_34_56/0.05),0_12px_32px_-16px_rgb(26_34_56/0.3)]">
            {HERO_TABS.map((t) => {
              const active = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={active}
                  aria-controls="hero-preview"
                  onClick={() => setMode(t.id)}
                  className={cn(
                    "focus-visible:ring-highlight rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    active ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id="hero-preview"
          className="bg-tint relative overflow-hidden rounded-[1.75rem] px-4 pt-10 sm:rounded-[2.5rem] sm:px-10 sm:pt-14 lg:px-16 lg:pt-16"
        >
          {/* Stage texture: a cobalt glow top-left, a warm one top-right, and
              a dot grid that fades out before the mockup — the panel reads as
              a surface, not a flat fill. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_60%_at_12%_0%,color-mix(in_oklab,var(--highlight)_18%,transparent),transparent_70%),radial-gradient(45%_55%_at_96%_8%,oklch(0.9_0.06_40/0.6),transparent_70%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(color-mix(in_oklab,var(--foreground)_24%,transparent)_1px,transparent_1.5px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_72%)]"
          />

          {/* Negative bottom margin lets the mockup run past the panel's edge,
              where the panel's overflow clips it — the page continues below
              the fold of the stage. */}
          <div className="relative mx-auto -mb-10 w-full max-w-[896px] sm:-mb-16 lg:-mb-20">
            <ScaledFrame designWidth={896}>
              <BrowserFrame url={`${host}/${handle || "your-name"}`}>
                <BookingPageMock handle={handle} mode={mode} />
              </BrowserFrame>
            </ScaledFrame>
          </div>

          {/* Satellites: a booking landing, a reminder queued. md+ only — on
              phones they'd cover the mockup. */}
          <div aria-hidden="true" className="animate-float absolute top-[68%] left-3 hidden w-56 md:block lg:left-6">
            <div className="bg-card ring-border rounded-xl p-3 ring-1 shadow-[0_1px_2px_rgb(26_34_56/0.05),0_18px_40px_-16px_rgb(26_34_56/0.35)]">
              <div className="flex items-center gap-2.5">
                <span className="bg-highlight/12 text-highlight flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
                  MN
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-tight font-medium">New booking</span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {mode === "spaces" ? "Mia Novak · Studio A · Sat 13:00–15:00" : "Mia Novak · Fri 10:30 · Consultation"}
                  </span>
                </span>
              </div>
            </div>
          </div>
          <div aria-hidden="true" className="animate-float-slow absolute top-[17%] right-3 hidden md:block lg:right-6">
            <div className="bg-card ring-border flex items-center gap-2 rounded-full py-2 pr-4 pl-2 text-xs ring-1 shadow-[0_1px_2px_rgb(26_34_56/0.05),0_18px_40px_-16px_rgb(26_34_56/0.35)]">
              <span className="bg-highlight/12 text-highlight flex size-6 shrink-0 items-center justify-center rounded-full">
                <BellRing className="size-3.5" />
              </span>
              <span className="font-medium">Reminder scheduled</span>
              <span className="text-muted-foreground font-mono text-[10px]">24 h before</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
