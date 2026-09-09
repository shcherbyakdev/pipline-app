import * as React from "react";
import Image from "next/image";
import { SITE } from "@/features/marketing/site";
import { HeroClaim } from "./hero-claim";
import adminWeek from "../images/admin-week.png";
import publicPhone from "../images/public-phone.png";
import heroWash from "../images/hero-wash.webp";

/* The page (interfacecraft.dev-referenced, 2026-09-09): a short rule, the
   title in the serif entering word by word (Linear's move: fade, a little
   rise, focus), the sub in the system face, the one input, then the
   product: a full-width band of the abstract wash in the dark theme's
   tokens seen through fluted glass (ribs, a travelling swell, grain; globals.css "Hero glass") with
   the admin's week rising from its floor and cropped there, and the live
   page on a phone seated over the week's empty weekend columns. Real
   screenshots (scripts/landing-shots.mjs); the wash is ours
   (scripts/landing-wash.html). */
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

      {/* the product, in the glass band */}
      <div className="animate-fade-up relative mt-16 w-full overflow-hidden pt-10 pb-10 [animation-delay:440ms] sm:mt-24 sm:h-[560px] sm:pt-14 sm:pb-0 lg:h-[640px] lg:pt-16">
        <Image src={heroWash} alt="" fill priority sizes="100vw" className="object-cover object-bottom" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="hero-swell absolute inset-y-0 left-0" />
        </div>
        <div aria-hidden="true" className="hero-ribs pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="hero-grain pointer-events-none absolute inset-0" />
        <div className="hero-rise relative mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="bg-card overflow-hidden rounded-[16px] shadow-[0_32px_90px_-24px_rgb(0_0_0/0.7)] ring-1 ring-white/15 sm:rounded-t-[22px] sm:rounded-b-none">
            <Image
              src={adminWeek}
              alt={`The ${SITE.name} admin: one studio's week of bookings across Room A, Room B, the make-up room and the whole studio.`}
              priority
              sizes="(min-width: 1152px) 1088px, 100vw"
              className="h-auto w-full"
            />
          </div>
          {/* the live page on a phone, over the weekend columns (the
              rightmost sixth of the week), so it hides no booking */}
          <div className="bg-card absolute top-[14%] right-2 w-[40%] overflow-hidden rounded-[18px] shadow-[0_24px_60px_-16px_rgb(0_0_0/0.7)] ring-1 ring-white/15 sm:top-[10%] sm:-right-4 sm:w-[210px] sm:rounded-[26px] lg:-right-6 lg:w-[248px] lg:rounded-[30px]">
            <Image
              src={publicPhone}
              alt="The studio's live booking page on a phone: Room A for four hours, the month with open days, the free windows on a Tuesday."
              sizes="(min-width: 1024px) 248px, (min-width: 640px) 210px, 40vw"
              className="h-auto w-full"
              style={{ aspectRatio: "390 / 600", objectFit: "cover", objectPosition: "top" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
