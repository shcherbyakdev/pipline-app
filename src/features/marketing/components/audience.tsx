import { Check } from "lucide-react";
import { AUDIENCE } from "@/features/marketing/site";
import { Eyebrow } from "./section-header";
import { Reveal } from "./reveal";

/* The beat between the hero and the walkthrough: who this is for, as a wrap
   of pills rather than a paragraph, and the three things the page removes. */
export function Audience() {
  return (
    <section aria-labelledby="audience-heading" className="border-border bg-secondary/50 border-y">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 md:py-20 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16">
        <Reveal>
          <Eyebrow>{AUDIENCE.eyebrow}</Eyebrow>
          <h2
            id="audience-heading"
            className="text-foreground mt-4 text-[32px] leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-4xl md:text-[44px]"
          >
            {AUDIENCE.heading}
          </h2>
          <p className="text-muted-foreground mt-4 max-w-md text-base leading-relaxed sm:text-[17px]">{AUDIENCE.sub}</p>
        </Reveal>
        <Reveal delay={120} className="mt-10 lg:mt-0">
          <ul className="flex flex-wrap gap-2">
            {AUDIENCE.groups.map((g) => (
              <li key={g} className="bg-card ring-border text-foreground rounded-full px-4 py-2 text-sm ring-1">
                {g}
              </li>
            ))}
          </ul>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {AUDIENCE.proofs.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-[15px]">
                <span className="bg-highlight/10 text-highlight flex size-5 shrink-0 items-center justify-center rounded-full">
                  <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="text-muted-foreground">{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
