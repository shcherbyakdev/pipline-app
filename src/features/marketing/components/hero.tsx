import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CTA, SITE } from "@/features/marketing/site";
import { HeroCalendar } from "./mocks/hero-calendar";

export function Hero() {
  return (
    // `overflow-x-clip` (not hidden): the calendar bleeds past the right edge on
    // large screens and must not create horizontal scroll, but the floating
    // cards' shadows and the copy column must stay unclipped vertically.
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16 md:pt-28 lg:min-h-[44rem] lg:pb-24">
        <div className="max-w-xl lg:max-w-[46%] lg:pr-6 xl:max-w-xl">
          <p className="text-primary text-sm font-medium">{SITE.eyebrow}</p>
          <h1 id="hero-heading" className="mt-4 text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            {SITE.headline}
          </h1>
          <p className="text-muted-foreground mt-6 text-lg text-pretty">{SITE.subheadline}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>
              {CTA.getStartedFree}
            </Link>
            <a href={SITE.anchors.how} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "group/cta h-11 px-4 text-base")}>
              {CTA.seeHow}
              <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5 motion-reduce:transition-none" />
            </a>
          </div>
          <p className="text-muted-foreground mt-4 text-sm">{SITE.heroNote}</p>
        </div>

        {/* Below lg the calendar sits under the copy and runs off the right edge
            of the page; from lg it is pinned to the right half of the viewport. */}
        <div className="mt-14 -mr-6 lg:absolute lg:top-24 lg:right-[-8vw] lg:left-1/2 lg:mt-0 lg:mr-0 xl:right-[-5vw] xl:left-[calc(50%+2rem)]">
          <HeroCalendar />
        </div>
      </div>
    </section>
  );
}
