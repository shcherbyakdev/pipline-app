import { ChevronDown } from "lucide-react";
import { FAQ } from "@/features/marketing/site";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-20 md:py-28 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-16">
        <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">Questions, answered</h2>
        <div className="divide-y border-y">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm font-medium [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:text-foreground group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
