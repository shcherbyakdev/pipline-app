import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { CARD } from "../type";

export function FaqSection({ section, ctx }: { section: SectionOf<"faq">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.q.trim() && i.a.trim());
  if (items.length === 0) return <Ghost ctx={ctx} text="faq" />;
  return (
    <section className={cn(CARD, "flex flex-col divide-y")}>
      {items.map((item, i) => (
        // The padding sits on the summary, not the row, so the whole row is
        // the tap target (56px), not the 24px text line inside it.
        <details key={i} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <HugeiconsIcon icon={PlusSignIcon} size={16} aria-hidden className="text-muted-foreground shrink-0 transition-transform duration-150 ease-strong group-open:rotate-45" />
          </summary>
          <p className="text-muted-foreground -mt-1 px-5 pb-4 whitespace-pre-line leading-relaxed">{item.a}</p>
        </details>
      ))}
    </section>
  );
}
