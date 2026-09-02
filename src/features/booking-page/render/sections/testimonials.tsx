import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { CARD } from "../type";

export function TestimonialsSection({ section, ctx }: { section: SectionOf<"testimonials">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.quote.trim());
  if (items.length === 0) return <Ghost ctx={ctx} text="testimonial" />;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {items.map((item, i) => (
        <figure key={i} className={cn(CARD, "flex flex-col gap-4 p-6")}>
          <blockquote className="text-[17px] leading-relaxed text-pretty">“{item.quote.trim()}”</blockquote>
          {item.author.trim() ? <figcaption className="text-muted-foreground mt-auto text-sm font-medium">{item.author.trim()}</figcaption> : null}
        </figure>
      ))}
    </section>
  );
}
