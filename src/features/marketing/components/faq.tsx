import { Plus } from "lucide-react";
import { anchorId, FAQ, SECTIONS, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { H2, SECTION } from "./type";

/* The reference's FAQ: the heading in the left column, the questions as a
   disclosure list on the right with a hairline under each. The plus turns
   into a cross on open. Stacks below md. */
export function Faq() {
  return (
    <section id={anchorId(SITE.anchors.faq)} aria-labelledby="faq-heading" className={cn(SECTION, "scroll-mt-20")}>
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 sm:px-8 md:grid-cols-[1fr_1.6fr] md:gap-16">
        <Reveal>
          <h2 id="faq-heading" className={H2}>
            {SECTIONS.faq.heading}
          </h2>
        </Reveal>
        <Reveal delay={60}>
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
