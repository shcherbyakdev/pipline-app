import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { CARD } from "../type";

export function FaqSection({ section, ctx }: { section: SectionOf<"faq">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.q.trim() && i.a.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a question and its answer" />;
  return (
    <section className={cn(CARD, "flex flex-col divide-y")}>
      {items.map((item, i) => (
        // The padding sits on the summary, not the row, so the whole row is
        // the tap target (56px), not the 24px text line inside it.
        <details key={i} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="text-muted-foreground -mt-1 px-5 pb-4 whitespace-pre-line leading-relaxed">{item.a}</p>
        </details>
      ))}
    </section>
  );
}
