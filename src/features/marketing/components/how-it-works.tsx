import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, PANEL } from "./type";

/* The three steps as one white panel between the hero and the dark block
   (the reference's slim strip): a centred heading, then the steps in a row,
   each opened by its number in the brand colour. Stacks below md. */
export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className={cn(PANEL, "bg-card ring-border mt-3 scroll-mt-20 ring-1 sm:mt-5")}>
      <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:px-10 sm:py-16 lg:px-16 lg:py-20">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 id="how-heading" className={H2}>
            {SECTIONS.how.heading}
          </h2>
          <p className={cn(LEAD, "mx-auto max-w-lg")}>{SECTIONS.how.sub}</p>
        </Reveal>
        <ol className="mt-12 grid gap-8 md:mt-14 md:grid-cols-3 md:gap-10">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 70} className="border-border border-t pt-6">
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
