import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* The three steps: a left-aligned heading, then the steps in a row under
   one hairline, each opened by its number in the brand colour. Stacks
   below md. */
export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="how-heading" className={H2}>
            {SECTIONS.how.heading}
          </h2>
          <p className={LEAD}>{SECTIONS.how.sub}</p>
        </Reveal>
        <ol className="border-border mt-12 grid gap-8 border-t pt-8 md:mt-16 md:grid-cols-3 md:gap-10 md:pt-10">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 70}>
              <p className="text-brand-text font-mono text-[13px] tabular-nums">0{i + 1}</p>
              <h3 className="text-foreground mt-3 text-[21px] leading-snug font-medium tracking-[-0.015em] text-balance">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{s.body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
