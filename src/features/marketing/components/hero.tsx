import * as React from "react";
import { SITE } from "@/features/marketing/site";
import { HeroClaim } from "./hero-claim";
import { HeroStage } from "./hero-stage";

/* The first viewport, left-aligned. Linear's entrance: every word of the
   headline fades in while rising a little and coming into focus, 60ms
   apart, and the sub, the buttons and the product follow with the same
   move while the headline is still resolving. Under the headline the one
   action, the claim bar (the handle is the product's own hero object; the
   nav already carries Get started, so no second button here), then the
   product on its stage (hero-stage.tsx). */
const WORD_MS = 60;

export function Hero({ host }: { host: string }) {
  const words = SITE.headline.split(" ");
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-8 sm:pt-16 lg:pt-20">
        <h1
          id="hero-heading"
          className="text-foreground font-display max-w-[17ch] text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[64px] lg:text-[80px]"
        >
          {words.map((w, i) => (
            <React.Fragment key={i}>
              <span className="hw" style={{ animationDelay: `${i * WORD_MS}ms` }}>
                {w}
              </span>
              {i < words.length - 1 ? " " : null}
            </React.Fragment>
          ))}
        </h1>

        <div className="mt-7 flex flex-col gap-7 md:flex-row md:items-start md:justify-between md:gap-12">
          <p className="animate-fade-up text-muted-foreground max-w-[34rem] text-[17px] leading-relaxed text-balance [animation-delay:260ms] sm:text-[19px]">
            {SITE.subheadline}
          </p>
          <HeroClaim host={host} className="animate-fade-up w-full max-w-[480px] shrink-0 [animation-delay:340ms] md:w-[440px] lg:w-[480px]" />
        </div>
      </div>

      {/* the product, on its stage */}
      <div className="animate-fade-up mx-auto mt-12 w-full max-w-6xl px-4 [animation-delay:440ms] sm:px-8 lg:mt-16">
        <HeroStage host={host} />
      </div>
    </section>
  );
}
