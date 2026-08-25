import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";
import { SectionHeader } from "./section-header";
import { Reveal } from "./reveal";
import { StepMock } from "./mocks/step-mocks";

/* Three steps as cards on one dotted line. Each card opens with a fragment
   of that step (sand header, numeral in its corner) and the line is drawn
   behind the row at the numerals' height, so it only shows in the gaps —
   the numbers read as a sequence, which they are. Below md the cards stack
   and the line is dropped. */
export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 md:py-24 lg:py-28">
        <SectionHeader id="how-heading" eyebrow={SECTIONS.how.eyebrow} heading={SECTIONS.how.heading} sub={SECTIONS.how.sub} />
        <ol className="relative mt-12 grid gap-4 md:mt-16 md:grid-cols-3 md:gap-6">
          <span
            aria-hidden="true"
            className="bg-[repeating-linear-gradient(to_right,var(--highlight)_0_3px,transparent_3px_9px)] absolute inset-x-6 top-[1.55rem] hidden h-0.5 opacity-60 md:block"
          />
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.number} delay={i * 90} className="bg-card ring-border relative overflow-hidden rounded-2xl ring-1">
              <div aria-hidden="true" className="bg-secondary border-border relative h-44 border-b">
                <span className="text-highlight absolute top-4 left-5 font-mono text-xs tracking-[0.14em]">{s.number}</span>
                <StepMock n={i + 1} />
              </div>
              <div className="p-6 sm:p-7">
                <h3 className="text-foreground text-lg font-medium tracking-tight text-balance">{s.title}</h3>
                <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
