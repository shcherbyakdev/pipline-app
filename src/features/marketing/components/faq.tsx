import { ChevronDown } from "lucide-react";
import { FAQ } from "@/features/marketing/site";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-3xl px-6 py-20 md:py-28">
        <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Questions, answered</h2>
        <div className="mt-10 divide-y border-y">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
