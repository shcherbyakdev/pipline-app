"use client";

import * as React from "react";
import { SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";
import { BrowserFrame, ScaledFrame } from "./browser-frame";
import { BookingPageMock } from "./mocks/booking-page-mock";

/* Full-viewport hero (spec §3.4): two-line headline, claim bar, mockup that
   mirrors the typed handle. The hero owns the handle state. */
export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  const [line1, line2] = SITE.headline;
  const words = line2.split(" ");
  const last = words.pop();

  return (
    <section
      aria-labelledby="hero-heading"
      className="bg-background relative flex min-h-[100svh] flex-col overflow-x-clip"
    >
      <div className="flex-1 shrink-0 min-h-8 sm:min-h-12 lg:min-h-16" />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-5 text-center">
        <h1
          id="hero-heading"
          className="text-foreground text-[40px] leading-[1.05] font-normal tracking-tight min-[400px]:text-[44px] sm:text-6xl lg:text-7xl xl:text-[80px]"
        >
          <span className="sr-only">{`${line1} ${line2}`}</span>
          <span aria-hidden="true">
            <span className="animate-fade-up block">{line1}</span>
            <span className="animate-fade-up block [animation-delay:100ms]">
              {words.join(" ")}{" "}
              <span className="relative inline-block">
                <span className="bg-highlight/30 absolute inset-x-[-0.05em] inset-y-[0.12em] -skew-x-6 rounded-sm" aria-hidden="true" />
                <span className="relative">{last}</span>
              </span>
            </span>
          </span>
        </h1>

        <p className="animate-fade-up text-foreground/75 mt-4 max-w-md text-sm [animation-delay:220ms] sm:mt-5 sm:text-base lg:text-lg">
          {SITE.subheadline}
        </p>

        <ClaimBar
          handle={handle}
          onHandleChange={setHandle}
          host={host}
          size="lg"
          className="animate-fade-up mt-5 max-w-xl [animation-delay:340ms] sm:mt-6"
        />

        <p className="animate-fade-up text-muted-foreground text-sm [animation-delay:460ms]">{SITE.heroNote}</p>
      </div>

      <div className="flex-1 shrink-0 min-h-10 sm:min-h-12 lg:min-h-16" />

      {/* wash under the mockup */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-[radial-gradient(60%_80%_at_50%_100%,color-mix(in_oklch,var(--highlight)_12%,transparent),transparent)]"
      />

      <div className="animate-hero-rise relative z-[1] mx-auto -mb-10 w-[92%] max-w-4xl shrink-0 [animation-delay:620ms] sm:-mb-20 sm:w-[84%] lg:-mb-32 lg:w-[72%]">
        <ScaledFrame designWidth={896}>
          <BrowserFrame url={`${host}/${handle || "your-name"}`}>
            <BookingPageMock handle={handle} />
          </BrowserFrame>
        </ScaledFrame>
      </div>
    </section>
  );
}
