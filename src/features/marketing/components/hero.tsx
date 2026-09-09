import * as React from "react";
import Image from "next/image";
import { SITE } from "@/features/marketing/site";
import { BlobWash } from "./booklo-mark";
import { HeroClaim } from "./hero-claim";
import adminWeek from "../images/admin-week.png";
import publicPhone from "../images/public-phone.png";

/* The first viewport, left-aligned. Linear's entrance: every word of the
   headline fades in while rising a little and coming into focus, 60ms
   apart, and the sub, the buttons and the product follow with the same
   move while the headline is still resolving. Under the headline the one
   action, the claim bar (the handle is the product's own hero object; the
   nav already carries Get started, so no second button here), then the
   product itself: the studio's
   week in the admin (a real screenshot, scripts/landing-shots.mjs) with
   the hosted booking page on a phone seated over the week's empty
   weekend columns, vertically centred, so it hides nothing that matters;
   both on the logo's own silhouette blurred into a wash (one lavender,
   one mint). */
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

      {/* the product, on the blob */}
      <div className="animate-fade-up relative mx-auto mt-14 w-full max-w-6xl px-4 pb-6 [animation-delay:440ms] sm:px-8 sm:pb-8 lg:mt-20">
        <BlobWash className="top-[-12%] left-[-6%] w-[70%] rotate-[-14deg]" />
        <BlobWash tone="space" className="right-[-10%] bottom-[-16%] w-[46%] rotate-[24deg] [animation-delay:-14s]" />
        <div className="relative">
          <div className="bg-card ring-border overflow-hidden rounded-[16px] shadow-[var(--shadow-card)] ring-1 sm:rounded-[20px]">
            <Image
              src={adminWeek}
              alt={`The ${SITE.name} admin: one studio's week of bookings across Room A, Room B, the make-up room and the whole studio.`}
              priority
              sizes="(min-width: 1152px) 1088px, 100vw"
              className="h-auto w-full"
            />
          </div>
          {/* the client's side: the hosted page on a phone, over the weekend
              columns (the rightmost sixth of the week), centred on the card */}
          <div className="bg-card ring-border absolute top-1/2 right-2 w-[40%] -translate-y-1/2 overflow-hidden rounded-[18px] shadow-[var(--shadow-lift)] ring-1 sm:-right-4 sm:w-[210px] sm:rounded-[26px] lg:-right-6 lg:w-[248px] lg:rounded-[30px]">
            <Image
              src={publicPhone}
              alt="The studio's public booking page on a phone: Room A for four hours, the month with open days, the free windows on a Tuesday."
              sizes="(min-width: 1024px) 250px, (min-width: 640px) 200px, 132px"
              className="h-auto w-full"
              style={{ aspectRatio: "390 / 600", objectFit: "cover", objectPosition: "top" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
