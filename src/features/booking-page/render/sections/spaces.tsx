"use client";
/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatOfferingPrice, stayHint } from "@/features/rentals/pricing";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";
import { CARD, H2, PICK_CARD } from "../type";

/* The org's rental offerings as cards (services.tsx's twin). Offerings come
   live from ctx — every active one, catalogue order; the section only owns
   presentation (style, which meta to show) and the photos, keyed by
   offering id. A click hands the offering to the booking widget. */
export function SpacesSection({ section, ctx }: { section: SectionOf<"spaces">; ctx: RenderContext }) {
  const { selectOffering, requested } = usePageState();
  const tu = useTranslations("public.units");
  if (ctx.offerings.length === 0) return <Ghost mode={ctx.mode} label="Add a space and it shows here" />;
  const photoFor = new Map(section.photos.map((p) => [p.offeringId, p.path] as const));
  const pick = (id: string) => {
    selectOffering(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cards = section.style === "cards";
  const picked = requested?.kind === "offering" ? requested.id : null;
  return (
    // `id`: the cover's Book button lands here when this section is the
    // page's picker (pickers.ts) and there is no Services section.
    <section id="spaces" className="flex scroll-mt-6 flex-col gap-5">
      {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : cn(CARD, "flex flex-col divide-y"))}>
        {ctx.offerings.map((o) => {
          const photo = photoFor.get(o.id);
          const price = section.showPrices ? formatOfferingPrice(o, ctx.org.currency, tu) : null;
          const stay = section.showStay ? stayHint(o, tu) : null;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => pick(o.id)}
                aria-pressed={o.id === picked}
                className={cn(
                  "flex w-full text-left",
                  cards ? cn(PICK_CARD, "h-full flex-col gap-3 p-4") : "wt-surface items-center gap-4 px-5 py-4 aria-pressed:bg-muted",
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
                <span className={cn("flex min-w-0 flex-1 flex-col gap-1.5", cards && "px-1 pb-1")}>
                  <span className="font-medium">{o.name}</span>
                  {o.description ? <span className="text-muted-foreground text-sm leading-relaxed">{o.description}</span> : null}
                  {/* "120 zł / hour" is too long to share a line with a name in a
                      half-width card: price leads the last line, the stay range trails. */}
                  {price || stay ? (
                    <span className="mt-auto flex items-baseline justify-between gap-3 pt-1">
                      {price ? <span className="font-medium tabular-nums">{price}</span> : <span />}
                      {stay ? <span className="text-muted-foreground text-xs tabular-nums">{stay}</span> : null}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
