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
    <RevealSection aria-labelledby="features-label" className="mx-auto w-full max-w-[48rem] px-5 pt-24 pb-24 sm:px-8 sm:pt-32 sm:pb-32">
      <h2 id="features-label" className="animate-fade-up text-foreground text-[14px] font-medium">
        {FEATURES_LABEL}
      </h2>
      <ul className="border-border mt-6 grid border-t sm:grid-cols-2 sm:gap-x-14">
        {FEATURES.map((f, i) => {
          const Icon = ICON[f.icon];
          return (
            <li
              key={f.title}
              className="animate-fade-up border-border grid grid-cols-[16px_1fr] gap-x-3 border-b py-6"
              style={{ animationDelay: `${(i + 1) * ROW_MS}ms` }}
            >
              <Icon className="text-brand-text mt-[5px] size-4" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0">
                <h3 className="text-foreground text-[17px] leading-snug font-medium">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-[15px] leading-relaxed">{f.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {/* the closing action, with room around it: the page ends on this */}
      <p
        className="animate-fade-up mt-14 flex flex-wrap items-center gap-x-5 gap-y-3 sm:mt-16"
        style={{ animationDelay: `${(FEATURES.length + 1) * ROW_MS}ms` }}
      >
        <Link href={SITE.links.signup} className={marketingButton("primary", "lg")}>
          {CTA.getStarted}
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </Link>
        <span className="text-muted-foreground text-[15px]">{SITE.heroNote}</span>
      </p>
    </RevealSection>
  );
}
