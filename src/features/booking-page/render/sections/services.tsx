"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";
import { CARD, H2, PICK_CARD } from "../type";

export function ServicesSection({ section, ctx }: { section: SectionOf<"services">; ctx: RenderContext }) {
  const { selectService, requested } = usePageState();
  const tu = useTranslations("public.units");
  if (ctx.services.length === 0) return <Ghost ctx={ctx} text="services" />;
  const pick = (id: string) => {
    selectService(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cards = section.style === "cards";
  const picked = requested?.kind === "service" ? requested.id : null;
  return (
    // `id`: the cover's Book button lands here when this section is the
    // page's picker (pickers.ts).
    <section id="services" className="flex scroll-mt-6 flex-col gap-5">
      {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : cn(CARD, "flex flex-col divide-y"))}>
        {ctx.services.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => pick(s.id)}
              aria-pressed={s.id === picked}
              className={cn(
                "flex w-full flex-col gap-2 text-left",
                cards ? cn(PICK_CARD, "h-full p-5") : "wt-surface px-5 py-4 aria-pressed:bg-muted",
              )}
            >
              <span className="flex w-full items-baseline justify-between gap-4">
                <span className="font-medium">{s.name}</span>
                {section.showPrices && s.priceLabel ? <span className="shrink-0 font-medium tabular-nums">{s.priceLabel}</span> : null}
              </span>
              {s.description ? <span className="text-muted-foreground text-sm leading-relaxed">{s.description}</span> : null}
              {section.showDurations ? <span className="text-muted-foreground mt-auto text-xs tabular-nums">{tu("minutes", { count: s.durationMin })}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
