import { Check } from "lucide-react";
import { SECTIONS } from "@/features/marketing/site";
import { CalendarMock } from "./mocks/calendar-mock";

export function ProductShowcase() {
  return (
    <section aria-labelledby="product-heading" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <div className="max-w-xl">
          <h2 id="product-heading" className="text-3xl font-medium tracking-[-0.03em] md:text-4xl">{SECTIONS.product.heading}</h2>
          <p className="text-muted-foreground mt-3">{SECTIONS.product.sub}</p>
        </div>
        <div className="mt-10">
          <CalendarMock />
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {SECTIONS.product.points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm">
              <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
