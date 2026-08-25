"use client";

import * as React from "react";
import { SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";
import { BrowserFrame, ScaledFrame } from "./browser-frame";
import { BookingPageMock } from "./mocks/booking-page-mock";

/* Full-viewport hero: two-line headline (the second line — the promise — in
   the accent), claim bar, and a tinted stage panel holding the booking-page
   mockup that mirrors the typed handle. A dotted line runs from the bar into
   the stage: the name you type becomes the page below. The hero owns the
   handle state. */
export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
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

        <p className="animate-fade-up text-muted-foreground mt-5 max-w-md text-base text-balance [animation-delay:220ms] sm:mt-6 sm:text-lg">
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
          claim bar to the stage. Decorative. */}
      <div aria-hidden="true" className="animate-fade-up flex min-h-12 flex-1 shrink-0 justify-center [animation-delay:560ms] sm:min-h-16">
        <span className="w-0.5 bg-[repeating-linear-gradient(to_bottom,var(--highlight)_0_3px,transparent_3px_9px)] opacity-60" />
      </div>

      <div className="animate-hero-rise relative mx-auto w-[94%] max-w-6xl shrink-0 [animation-delay:620ms]">
        <div className="bg-tint overflow-hidden rounded-[1.75rem] px-4 pt-6 sm:rounded-[2.5rem] sm:px-10 sm:pt-12 lg:px-16 lg:pt-16">
          {/* Negative bottom margin lets the mockup run past the panel's edge,
              where the panel's overflow clips it — the page continues below
              the fold of the stage. */}
          <div className="mx-auto -mb-12 w-full max-w-[896px] sm:-mb-24 lg:-mb-32">
            <ScaledFrame designWidth={896}>
              <BrowserFrame url={`${host}/${handle || "your-name"}`}>
                <BookingPageMock handle={handle} />
              </BrowserFrame>
            </ScaledFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
