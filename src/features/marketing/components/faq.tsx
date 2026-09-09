import { Plus } from "lucide-react";
import { anchorId, FAQ, SECTIONS, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, SECTION, SECTION_INNER } from "./type";

/* The questions as one narrow disclosure list under a left-aligned
   heading, a hairline under each. The plus turns into a cross on open. */
export function Faq() {
  return (
    <section id={anchorId(SITE.anchors.faq)} aria-labelledby="faq-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className={SECTION_INNER}>
        <Reveal>
          <h2 id="faq-heading" className={H2}>
            {SECTIONS.faq.heading}
          </h2>
        </Reveal>
        <Reveal delay={60} className="mt-10 max-w-3xl md:mt-12">
          {FAQ.map((item) => (
            <details key={item.question} className="group border-border border-b py-5 first:pt-0">
              <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                {item.question}
                <Plus className="text-brand-text size-4 shrink-0 transition-transform duration-200 ease-strong group-open:rotate-45 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <p className="text-muted-foreground mt-3 max-w-2xl text-[15px] leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
