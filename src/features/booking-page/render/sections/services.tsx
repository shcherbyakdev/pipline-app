"use client";

import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";

export function ServicesSection({ section, ctx }: { section: SectionOf<"services">; ctx: RenderContext }) {
  const { selectService } = usePageState();
  if (ctx.services.length === 0) return <Ghost mode={ctx.mode} label="Add a service and it shows here" />;
  const pick = (id: string) => {
    selectService(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cards = section.style === "cards";
  return (
    // `id`: the cover's Book button lands here when this section is the
    // page's picker (pickers.ts).
    <section id="services" className="flex scroll-mt-6 flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : "flex flex-col divide-y rounded-[var(--widget-radius)] border")}>
        {ctx.services.map((s) => {
          const meta = [section.showDurations ? `${s.durationMin} min` : null, section.showPrices ? s.priceLabel : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => pick(s.id)}
                className={cn(
                  "wt-surface flex w-full flex-col items-start gap-1 text-left",
                  cards ? "h-full rounded-[var(--widget-radius)] border p-4" : "px-4 py-3",
                )}
              >
                <span className="font-medium">{s.name}</span>
                {s.description ? <span className="text-muted-foreground text-sm">{s.description}</span> : null}
                {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
