import { Check } from "lucide-react";
import { SECTIONS } from "@/features/marketing/site";
import { SectionHeader } from "./section-header";
import { HeroCalendar } from "./mocks/hero-calendar";

/* The week calendar showpiece inside a tinted stage panel — the same device
   as the hero, so the two product moments on the page share one frame. */
export function ProductShowcase() {
  return (
    <section aria-labelledby="product-heading" className="overflow-x-clip">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 md:py-28 lg:py-32">
        <SectionHeader id="product-heading" eyebrow={SECTIONS.product.eyebrow} heading={SECTIONS.product.heading} sub={SECTIONS.product.sub} />
        {/* No right padding: the grid is open on its right edge by design and
            runs off the panel, which clips it. */}
        <div className="bg-tint mt-12 overflow-hidden rounded-[1.75rem] p-4 pr-0 sm:rounded-[2.5rem] sm:p-8 sm:pr-0 md:mt-16 lg:p-12 lg:pr-0">
          <HeroCalendar />
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3 md:mt-10 md:gap-6">
          {SECTIONS.product.points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px]">
              <span className="bg-highlight/10 text-highlight mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span className="text-muted-foreground">{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
