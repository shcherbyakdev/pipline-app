import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";
import { SectionHeader } from "./section-header";

/* Three steps as cards on one dotted line. The line is drawn behind the row
   and only shows in the gaps between cards, so the numbers read as a sequence
   rather than a list. Below md the cards stack and the line runs down the
   left, under the numerals. */
export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 md:py-28 lg:py-32">
        <SectionHeader id="how-heading" eyebrow={SECTIONS.how.eyebrow} heading={SECTIONS.how.heading} sub={SECTIONS.how.sub} />
        <ol className="relative mt-12 grid gap-4 md:mt-16 md:grid-cols-3 md:gap-6">
          <span
            aria-hidden="true"
            className="bg-[repeating-linear-gradient(to_right,var(--highlight)_0_3px,transparent_3px_9px)] absolute inset-x-6 top-[2.35rem] hidden h-0.5 opacity-60 md:block"
          />
          {STEPS.map((s) => (
            <li key={s.number} className="bg-card ring-border relative rounded-2xl p-6 ring-1 sm:p-7">
              <span className="text-highlight font-mono text-xs tracking-[0.14em]">{s.number}</span>
              <h3 className="text-foreground mt-6 text-lg font-medium tracking-tight text-balance">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
