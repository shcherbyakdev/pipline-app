import { anchorId, FEATURES, SECTIONS, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, LEAD, SECTION, SECTION_INNER } from "./type";

/* Also in the box: six short items on one hairline, three columns, title
   and one line each. No boxes, no icons; the grouping is the hairline and
   the columns, the same idiom as the steps. Informational, so still. */
export function Features() {
  return (
    <section id={anchorId(SITE.anchors.features)} aria-labelledby="features-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="features-heading" className={H2}>
            {SECTIONS.features.heading}
          </h2>
          <p className={LEAD}>{SECTIONS.features.sub}</p>
        </Reveal>

        <ul className="border-border mt-12 grid gap-x-10 gap-y-9 border-t pt-8 sm:grid-cols-2 md:mt-14 md:pt-10 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 3) * 60} className="min-w-0">
              <h3 className="text-foreground text-[19px] leading-snug font-medium tracking-[-0.01em]">{f.title}</h3>
              <p className="text-muted-foreground mt-1.5 max-w-[34ch] text-[15px] leading-relaxed">{f.body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
