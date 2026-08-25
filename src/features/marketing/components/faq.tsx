import { Plus } from "lucide-react";
import { anchorId, FAQ, SECTIONS, SITE } from "@/features/marketing/site";
import { Eyebrow } from "./section-header";

export function Faq() {
  return (
    <section id={anchorId(SITE.anchors.faq)} aria-labelledby="faq-heading" className="scroll-mt-20">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-20 sm:px-8 md:py-28 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-20 lg:py-32">
        <div>
          <Eyebrow>{SECTIONS.faq.eyebrow}</Eyebrow>
          <h2 id="faq-heading" className="text-foreground mt-4 text-[32px] leading-[1.08] font-medium tracking-[-0.03em] text-balance sm:text-4xl md:text-[44px]">
            {SECTIONS.faq.heading}
          </h2>
        </div>
        <div className="divide-border border-border divide-y border-y">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="focus-visible:ring-highlight flex cursor-pointer list-none items-center justify-between gap-6 rounded-md text-[17px] font-medium tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="ring-border text-muted-foreground group-hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-full ring-1 transition-[transform,color] duration-300 group-open:rotate-45 motion-reduce:transition-none">
                  <Plus className="size-3.5" aria-hidden="true" />
                </span>
              </summary>
              <p className="text-muted-foreground mt-3 max-w-2xl text-[15px] leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
