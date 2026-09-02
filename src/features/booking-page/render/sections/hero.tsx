/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import { BookButton } from "../book-button";
import type { RenderContext } from "../context";
import { CrossLink } from "../cross-link";
import { Ghost } from "../ghost";
import { bookHref, type Pickers } from "../pickers";
import { H1, LEAD, R_CARD } from "../type";

/* The cover: headline, sub, Book and (when the org has another channel)
   the outlined way to it, then the cover image. Text first — the image is
   the cover's support, not its subject. */
export function HeroSection({ section, ctx, pickers, crossLink, ctaHidden = false }: { section: SectionOf<"hero">; ctx: RenderContext; pickers: Pickers; crossLink: RenderContext["crossLink"]; ctaHidden?: boolean }) {
  const src = section.imagePath ? pageImageUrl(ctx.supabaseUrl, section.imagePath) : null;
  const center = section.align === "center";
  return (
    <section className={cn("flex flex-col gap-6", center && "items-center text-center")}>
      <div className={cn("flex flex-col gap-3", center && "items-center")}>
        {section.headline.trim() ? (
          <h1 className={H1}>{section.headline}</h1>
        ) : (
          <Ghost ctx={ctx} text="headline" />
        )}
        {section.subheadline.trim() ? <p className={cn(LEAD, "max-w-[44ch]")}>{section.subheadline}</p> : null}
      </div>
      {!ctaHidden || crossLink ? (
        <div className={cn("flex flex-wrap items-center gap-2", center && "justify-center")}>
          {/* Suppressed when the booking step renders above this section — the
              anchor would scroll backwards (PageRenderer decides). */}
          {ctaHidden ? null : <BookButton label={section.cta} href={bookHref(pickers)} mode={ctx.mode} />}
          <CrossLink link={crossLink} mode={ctx.mode} variant="button" />
        </div>
      ) : null}
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className={cn("aspect-[16/9] w-full object-cover", R_CARD)} />
      ) : (
        <Ghost ctx={ctx} kind="image" text="cover" />
      )}
    </section>
  );
}
