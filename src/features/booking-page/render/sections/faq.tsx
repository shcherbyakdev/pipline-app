import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function FaqSection({ section, ctx }: { section: SectionOf<"faq">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.q.trim() && i.a.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a question and its answer" />;
  return (
    <section className="flex flex-col divide-y rounded-[var(--widget-radius)] border">
      {items.map((item, i) => (
        <details key={i} className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="text-muted-foreground mt-2 whitespace-pre-line leading-relaxed">{item.a}</p>
        </details>
      ))}
    </section>
  );
}
