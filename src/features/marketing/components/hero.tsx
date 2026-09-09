import Link from "next/link";
import { CTA, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { BookloMark } from "./booklo-mark";
import { marketingButton } from "./marketing-button";
import { BookingWidget } from "./booking-widget";
import { PANEL } from "./type";

/* The first viewport, the reference's hero panel: one big rounded panel on
   a white-into-lavender wash, everything centred — the mark with the
   product's name for this buyer, a one-line display headline, a
   twenty-word sub, the solid periwinkle action beside the lavender ghost,
   then the product at real size: a client's booking on a studio's page,
   playing its own loop (room + gear, price computed, hold placed, deposit
   paid, confirmed). Everything enters on one short stagger. */
export function Hero({ host }: { host: string }) {
  return (
    <section aria-labelledby="hero-heading" className={cn(PANEL, "hero-wash relative overflow-hidden")}>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-14 text-center sm:px-8 sm:pt-20 lg:pt-24">
        <p className="animate-fade-up text-muted-foreground flex items-center gap-2 text-[15px] font-medium sm:text-[17px]">
          <BookloMark className="size-6 sm:size-7" />
          {SITE.eyebrow}
        </p>

        <h1
          id="hero-heading"
          className="animate-fade-up text-foreground font-display mt-5 text-[40px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance [animation-delay:60ms] sm:text-[56px] lg:text-[72px]"
        >
          {SITE.headline}
        </h1>

        <p className="animate-fade-up text-muted-foreground mt-5 max-w-[38rem] text-[17px] leading-relaxed text-balance [animation-delay:120ms] sm:text-[19px]">
          {SITE.subheadline}
        </p>

        <div className="animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3 [animation-delay:180ms]">
          <Link href={SITE.links.signup} className={marketingButton("brand", "lg")}>
            {CTA.getStarted}
          </Link>
          <a href={`/${SITE.anchors.how}`} className={marketingButton("neutral", "lg")}>
            {CTA.seeHow}
          </a>
        </div>
      </div>

      {/* the product, on the wash */}
      <div className="animate-fade-up relative mx-auto mt-12 w-full max-w-6xl px-4 pb-10 [animation-delay:280ms] sm:px-8 sm:pb-14 lg:mt-16 lg:pb-16">
        <div
          id="hero-preview"
          role="img"
          aria-label="An example booking page for a studio: a client picks a room and a lamp kit, a day and a window of hours; the price is computed, a hold is placed, the deposit is paid and the booking is confirmed."
        >
          <BookingWidget host={host} />
        </div>
      </div>
    </section>
  );
}
