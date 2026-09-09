import * as React from "react";
import Link from "next/link";
import { CTA, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { BlobWash } from "./booklo-mark";
import { BookingWidget } from "./booking-widget";

/* The first viewport, left-aligned. The headline acts out its own last
   word: the opening words rise from behind the baseline one after the
   other, then the final word drops in from above and settles with a small
   rebound, and its full stop lands last. Under it the sub, the ink action
   beside the lavender ghost, then the product at real size, pushed off the
   grid to the right on wide screens, with the logo's own silhouette
   blurred into a wash behind it (one lavender, one mint). */
const RISE_MS = 110;
const DROP_AT = 420;
const DOT_AT = 1300;

export function Hero({ host }: { host: string }) {
  const words = SITE.headline.split(" ");
  const last = words.length - 1;
  // The final word and its trailing punctuation, animated separately.
  const [, lastWord = "", mark = ""] = words[last].match(/^(.*?)([.!?,]*)$/) ?? [];
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-8 sm:pt-16 lg:pt-20">
        <h1
          id="hero-heading"
          className="text-foreground font-display max-w-[17ch] text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[64px] lg:text-[80px]"
        >
          {words.slice(0, last).map((w, i) => (
            <React.Fragment key={i}>
              <span className="hw">
                <span className="hw-in" style={{ animationDelay: `${i * RISE_MS}ms` }}>
                  {w}
                </span>
              </span>{" "}
            </React.Fragment>
          ))}
          <span className="hw">
            <span className="hw-drop" style={{ animationDelay: `${DROP_AT}ms` }}>
              {lastWord}
              {mark ? (
                <span className="hw-dot" style={{ animationDelay: `${DOT_AT}ms` }}>
                  {mark}
                </span>
              ) : null}
            </span>
          </span>
        </h1>

        <div className="mt-7 flex flex-col gap-7 md:flex-row md:items-end md:justify-between md:gap-12">
          <p className="animate-fade-up text-muted-foreground max-w-[34rem] text-[17px] leading-relaxed text-balance [animation-delay:700ms] sm:text-[19px]">
            {SITE.subheadline}
          </p>
          <div className="animate-fade-up flex shrink-0 items-center gap-3 [animation-delay:800ms]">
            <Link href={SITE.links.signup} className={marketingButton("primary", "lg")}>
              {CTA.getStarted}
            </Link>
            <a href={`/${SITE.anchors.how}`} className={marketingButton("neutral", "lg")}>
              {CTA.seeHow}
            </a>
          </div>
        </div>
      </div>

      {/* the product, on the blob */}
      <div className="animate-fade-up relative mx-auto mt-14 w-full max-w-6xl px-4 [animation-delay:900ms] sm:px-8 lg:mt-20">
        <BlobWash className="top-[-12%] left-[-6%] w-[70%] rotate-[-14deg]" />
        <BlobWash tone="space" className="right-[-10%] bottom-[-18%] w-[46%] rotate-[24deg] [animation-delay:-14s]" />
        <div
          id="hero-preview"
          role="img"
          aria-label="An example booking page for a studio: a client picks a room and a lamp kit, a day and a window of hours; the price is computed, a hold is placed, the deposit is paid and the booking is confirmed."
          className="relative lg:translate-x-[4%]"
        >
          <BookingWidget host={host} />
        </div>
      </div>
    </section>
  );
}
