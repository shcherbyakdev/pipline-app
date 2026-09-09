import * as React from "react";
import Image from "next/image";
import { SITE } from "@/features/marketing/site";
import { HeroClaim } from "./hero-claim";
import { HeroStory } from "./hero-story";
import adminWeek from "../images/admin-week.png";

/* The page (interfacecraft.dev-referenced, 2026-09-09): a short rule, the
   title in the serif entering word by word (Linear's move: fade, a little
   rise, focus), the sub in the system face, the one input, then the
   product: the admin's week (a real screenshot, scripts/landing-shots.mjs)
   on the plain ground, rising into view, with the story of one booking
   played over it in CSS (hero-story.tsx). */
const WORD_MS = 60;

export function Hero({ host }: { host: string }) {
  const words = SITE.headline.split(" ");
  return (
    <section aria-labelledby="hero-heading" className="overflow-x-clip">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-20 text-center sm:px-8 sm:pt-28">
        <span aria-hidden="true" className="bg-border animate-fade-up mb-9 h-px w-16" />
        <h1
          id="hero-heading"
          className="text-foreground font-serif max-w-[14ch] text-[40px] leading-[1.05] font-normal tracking-[-0.025em] text-balance sm:text-[50px]"
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
        <p className="animate-fade-up text-muted-foreground mt-5 max-w-[30rem] text-[17px] leading-relaxed text-balance [animation-delay:260ms]">
          {SITE.subheadline}
        </p>
        <HeroClaim host={host} className="animate-fade-up mt-8 w-full max-w-[440px] text-left [animation-delay:340ms]" />
      </div>

      {/* the product */}
      <div className="hero-rise mx-auto mt-16 w-full max-w-5xl px-4 sm:mt-24 sm:px-8">
        <div className="relative">
          <div className="bg-card ring-border overflow-hidden rounded-[16px] shadow-[0_24px_60px_-28px_rgb(37_34_40/0.25)] ring-1 sm:rounded-[22px]">
            <Image
              src={adminWeek}
              alt={`The ${SITE.name} admin: one studio's week of bookings across Room A, Room B, the make-up room and the whole studio.`}
              priority
              sizes="(min-width: 1152px) 1088px, 100vw"
              className="h-auto w-full"
            />
          </div>
          <HeroStory />
        </div>
      </div>
    </section>
  );
}
