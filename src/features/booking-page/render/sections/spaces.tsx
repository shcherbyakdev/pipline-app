"use client";
/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */

import { cn } from "@/lib/utils";
import { formatOfferingPrice, stayHint } from "@/features/rentals/pricing";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";

/* The org's rental offerings as cards (services.tsx's twin). Offerings come
   live from ctx — every active one, catalogue order; the section only owns
   presentation (style, which meta to show) and the photos, keyed by
   offering id. A click hands the offering to the booking widget. */
export function SpacesSection({ section, ctx }: { section: SectionOf<"spaces">; ctx: RenderContext }) {
  const { selectOffering } = usePageState();
  if (ctx.offerings.length === 0) return <Ghost mode={ctx.mode} label="Add a space and it shows here" />;
  const photoFor = new Map(section.photos.map((p) => [p.offeringId, p.path] as const));
  const pick = (id: string) => {
    selectOffering(id);
    // The preview sits inside the admin page: no scrolling there. The spaces
    // widget when the page has one (split booking), else the combined one.
    if (ctx.mode === "public") {
      (document.getElementById("book-spaces") ?? document.getElementById("book"))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const cards = section.style === "cards";
  return (
    // `id`: the cover's Book button lands here when this section is the
    // page's picker (pickers.ts) and there is no Services section.
    <section id="spaces" className="flex scroll-mt-6 flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : "flex flex-col divide-y rounded-[var(--widget-radius)] border")}>
        {ctx.offerings.map((o) => {
          const photo = photoFor.get(o.id);
          const meta = [section.showPrices ? formatOfferingPrice(o, ctx.org.currency) : null, section.showStay ? stayHint(o) : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => pick(o.id)}
                className={cn(
                  "wt-surface flex w-full text-left",
                  cards ? "h-full flex-col items-start gap-2 rounded-[var(--widget-radius)] border p-4" : "items-center gap-3 px-4 py-3",
                )}
              >
                {photo ? (
                  <img
                    src={pageImageUrl(ctx.supabaseUrl, photo)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={cn("shrink-0 rounded-[var(--widget-radius)] object-cover", cards ? "aspect-[4/3] w-full" : "size-16")}
                  />
                ) : null}
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{o.name}</span>
                  {o.description ? <span className="text-muted-foreground text-sm">{o.description}</span> : null}
                  {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
