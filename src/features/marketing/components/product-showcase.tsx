import { Check } from "lucide-react";
import { SECTIONS } from "@/features/marketing/site";
import { HeroCalendar } from "./mocks/hero-calendar";

export function ProductShowcase() {
  return (
    <section aria-labelledby="product-heading" className="border-border overflow-x-clip border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <div className="max-w-xl">
          <h2 id="product-heading" className="text-foreground text-3xl font-normal tracking-tight md:text-4xl">{SECTIONS.product.heading}</h2>
          <p className="text-muted-foreground mt-3">{SECTIONS.product.sub}</p>
        </div>
        <div className="mt-10">
          <HeroCalendar />
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {SECTIONS.product.points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm">
              <Check className="text-highlight mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="text-muted-foreground">{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
