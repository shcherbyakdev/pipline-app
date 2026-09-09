import { BellRing, CheckCheck, Code2, Languages, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { anchorId, FEATURES, SECTIONS, SITE, type FeatureIcon } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, SECTION } from "./type";

/* Everything else, as the reference's grid: a centred heading, then six
   white cards in three columns, each a brand-coloured glyph, a title and
   one sentence. Informational, so still. Two columns on tablets, one on
   phones. */
const ICON: Record<FeatureIcon, LucideIcon> = {
  "no-account": UserRound,
  guard: ShieldCheck,
  approve: CheckCheck,
  notify: BellRing,
  language: Languages,
  embed: Code2,
};

export function Features() {
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="features-heading" className={H2}>
            {SECTIONS.features.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-lg")}>{SECTIONS.features.sub}</p>
        </Reveal>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 md:mt-14 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = ICON[f.icon];
            return (
              <Reveal as="li" key={f.icon} delay={(i % 3) * 60} className="bg-card ring-border flex min-w-0 flex-col rounded-[24px] p-6 ring-1 sm:p-7">
                <span className="bg-brand/10 text-brand-text flex size-10 items-center justify-center rounded-full" aria-hidden="true">
                  <Icon className="size-5" strokeWidth={2} />
                </span>
                <h3 className="text-foreground mt-6 text-[19px] leading-snug font-medium tracking-[-0.01em]">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-[15px] leading-relaxed">{f.body}</p>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
