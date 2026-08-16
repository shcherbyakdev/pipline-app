import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CTA, SITE } from "@/features/marketing/site";
import { BookingCardMock } from "./mocks/booking-card-mock";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-20 pb-24 md:pt-28 lg:grid-cols-2">
      <div className="max-w-xl">
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
      <div className="flex justify-center lg:justify-end">
        <BookingCardMock />
      </div>
    </section>
  );
}
