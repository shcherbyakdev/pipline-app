/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function HeroSection({ section, ctx }: { section: SectionOf<"hero">; ctx: RenderContext }) {
  const src = section.imagePath ? pageImageUrl(ctx.supabaseUrl, section.imagePath) : null;
  const center = section.align === "center";
  return (
    <section className={cn("flex flex-col gap-5", center && "items-center text-center")}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="aspect-[16/9] w-full rounded-[var(--widget-radius)] object-cover" />
      ) : (
        <Ghost mode={ctx.mode} kind="image" label="Add a cover image" />
      )}
      <div className={cn("flex flex-col gap-2", center && "items-center")}>
        {section.headline.trim() ? (
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{section.headline}</h1>
        ) : (
          <Ghost mode={ctx.mode} label="Add a headline" />
        )}
        {section.subheadline.trim() ? (
          <p className="text-muted-foreground max-w-prose text-base text-pretty sm:text-lg">{section.subheadline}</p>
        ) : null}
      </div>
    </section>
  );
}
