import Link from "next/link";
import { ArrowRight, MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CTA, SITE } from "@/features/marketing/site";
import { HeroCalendar } from "./mocks/hero-calendar";
import { marketingButton } from "./marketing-button";
import reveal from "./hero-reveal.module.css";

/* Headline split into words so each can reveal on its own (Linear-style). The
   split copy is aria-hidden; the visually hidden span carries the real
   heading text for the accessibility tree and for `id="hero-heading"`. */
function WordReveal({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <span key={i}>
            <span className={reveal.word} style={{ "--i": i } as React.CSSProperties}>
              {w}
            </span>
            {i < words.length - 1 ? " " : null}
          </span>
        ))}
      </span>
    </>
  );
}

export function Hero() {
  return (
    // `overflow-x-clip` (not hidden): the calendar bleeds past the right edge on
    // large screens and must not create horizontal scroll, but the floating
    // cards' shadows and the copy column must stay unclipped vertically.
    <section aria-labelledby="hero-heading" className="relative overflow-x-clip">
      <div className="mx-auto w-full max-w-6xl px-6 pt-16 pb-16 md:pt-24 lg:min-h-[44rem] lg:pb-24">
        <div className="max-w-xl lg:max-w-[46%] lg:pr-6 xl:max-w-xl">
          <h1 id="hero-heading" className="mt-4 text-4xl leading-[1.05] font-medium tracking-[-0.03em] text-balance md:text-6xl">
            <WordReveal text={SITE.headline.join(" ")} />
          </h1>
          <p className={cn(reveal.fade, "text-foreground/80 mt-6 text-lg text-pretty")} style={{ "--delay": "620ms" } as React.CSSProperties}>
            {SITE.subheadline}
          </p>
          <div className={cn(reveal.fade, "mt-8 flex flex-wrap items-center gap-x-6 gap-y-3")} style={{ "--delay": "760ms" } as React.CSSProperties}>
            <Link href={SITE.links.signup} className={marketingButton("primary", "lg")}>
              <MoveRight className="size-6" strokeWidth={1.5} aria-hidden="true" />
              <span className="flex-1 text-center">{CTA.getStartedFree}</span>
            </Link>
            <a href={SITE.anchors.how} className={marketingButton("quiet", "text", "group/cta")}>
              {CTA.seeHow}
              <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
            </a>
          </div>
          <p className={cn(reveal.fade, "text-muted-foreground mt-4 text-sm")} style={{ "--delay": "880ms" } as React.CSSProperties}>
            {SITE.heroNote}
          </p>
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
