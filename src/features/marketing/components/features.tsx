import Link from "next/link";
import { ArrowRight, CalendarClock, Languages, Layers, Link2, Receipt, Sunrise, Tag, Wallet, type LucideIcon } from "lucide-react";
import { CTA, FEATURES, FEATURES_LABEL, SITE, type FeatureIcon } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { RevealSection } from "./reveal";

/* What it does, under the product: a small label, then eight lines in two
   columns, each a small glyph beside a title and one sentence, hairlines
   between rows, then the one action with the early-access note beside
   it. No boxes. The label, the lines and the action enter the way the
   hero copy does (fade, a little rise, focus), 60ms apart, once the
   section scrolls into view. */
const ROW_MS = 60;
const ICON: Record<FeatureIcon, LucideIcon> = {
  price: Tag,
  deposit: Wallet,
  change: CalendarClock,
  charge: Receipt,
  studio: Layers,
  morning: Sunrise,
  link: Link2,
  language: Languages,
};

export function Features() {
  return (
    <RevealSection aria-labelledby="features-label" className="mx-auto w-full max-w-[46rem] px-5 pt-20 sm:px-8 sm:pt-28">
      <h2 id="features-label" className="animate-fade-up text-foreground text-[13px] font-medium">
        {FEATURES_LABEL}
      </h2>
      <ul className="border-border mt-4 grid border-t sm:grid-cols-2 sm:gap-x-10">
        {FEATURES.map((f, i) => {
          const Icon = ICON[f.icon];
          return (
            <li
              key={f.title}
              className="animate-fade-up border-border grid grid-cols-[16px_1fr] gap-x-3 border-b py-5"
              style={{ animationDelay: `${(i + 1) * ROW_MS}ms` }}
            >
              <Icon className="text-brand-text mt-[3px] size-4" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-foreground text-[15px] leading-snug font-medium">{f.title}</h3>
                <p className="text-muted-foreground mt-1 text-[15px] leading-relaxed">{f.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p
        className="animate-fade-up mt-8 flex flex-wrap items-center gap-x-4 gap-y-2"
        style={{ animationDelay: `${(FEATURES.length + 1) * ROW_MS}ms` }}
      >
        <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
          {CTA.getStarted}
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
        <span className="text-muted-foreground text-[13px]">{SITE.heroNote}</span>
      </p>
    </RevealSection>
  );
}
