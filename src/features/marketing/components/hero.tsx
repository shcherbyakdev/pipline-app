import * as React from "react";
import Image from "next/image";
import { SITE } from "@/features/marketing/site";
import { HeroClaim } from "./hero-claim";
import adminWeek from "../images/admin-week.png";
import heroWash from "../images/hero-wash.webp";

/* The first viewport, centred (finsepa.com-referenced structure,
   2026-09-09): the headline entering word by word (Linear's move: fade,
   a little rise, focus), the sub, the one input (the claim bar; the nav
   carries Get started), then the admin's week rising from the hero's
   floor, cropped there like a screen coming into view. The whole hero
   sits on a full-bleed abstract wash in the brand's palette
   (scripts/landing-wash.html, ours, not a stock painting): near-white
   under the words, ridges under the product. Real screenshot
   (scripts/landing-shots.mjs). */
const WORD_MS = 60;

export function Hero({ host }: { host: string }) {
  const words = SITE.headline.split(" ");
  return (
    <section aria-labelledby="hero-heading" className="relative -mt-[73px] overflow-x-clip pt-[73px]">
      {/* the wash behind the whole hero, pulled up under the (transparent)
          nav: near-white at the top under the words, the ridges rising
          where the product does */}
      <Image src={heroWash} alt="" fill priority sizes="100vw" className="object-cover object-bottom" />
      <div aria-hidden="true" className="hero-grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-12 text-center sm:px-8 sm:pt-16 lg:pt-20">
        <h1
          id="hero-heading"
          className="text-foreground font-display max-w-[15ch] text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[64px] lg:text-[80px]"
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

        <p className="animate-fade-up text-muted-foreground mt-6 max-w-[36rem] text-[17px] leading-relaxed text-balance [animation-delay:260ms] sm:text-[19px]">
          {SITE.subheadline}
        </p>
        <HeroClaim host={host} className="animate-fade-up mt-8 w-full max-w-[520px] text-left [animation-delay:340ms]" />
      </div>

      {/* the product, rising from the hero's floor */}
      <div className="relative mt-12 w-full overflow-hidden pb-10 sm:mt-16 sm:h-[520px] sm:pb-0 lg:mt-20 lg:h-[600px]">
        <div className="hero-rise relative mx-auto w-full max-w-6xl px-4 sm:absolute sm:inset-x-0 sm:top-0 sm:px-8">
          <div className="bg-card overflow-hidden rounded-[16px] shadow-[0_24px_80px_-24px_rgb(37_34_40/0.45)] ring-1 ring-white/60 sm:rounded-t-[22px] sm:rounded-b-none">
            <Image
              src={adminWeek}
              alt={`The ${SITE.name} admin: one studio's week of bookings across Room A, Room B, the make-up room and the whole studio.`}
              priority
              sizes="(min-width: 1152px) 1088px, 100vw"
              className="h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
