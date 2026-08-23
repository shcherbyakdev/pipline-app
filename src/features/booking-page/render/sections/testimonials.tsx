import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function TestimonialsSection({ section, ctx }: { section: SectionOf<"testimonials">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.quote.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a client quote" />;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {items.map((item, i) => (
        <figure key={i} className="flex flex-col gap-3 rounded-[var(--widget-radius)] border p-4">
          <blockquote className="text-pretty leading-relaxed">“{item.quote.trim()}”</blockquote>
          {item.author.trim() ? <figcaption className="text-muted-foreground text-sm">— {item.author.trim()}</figcaption> : null}
        </figure>
      ))}
    </section>
  );
}
