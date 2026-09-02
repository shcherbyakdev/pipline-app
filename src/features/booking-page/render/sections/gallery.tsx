/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { R_CARD } from "../type";

export function GallerySection({ section, ctx }: { section: SectionOf<"gallery">; ctx: RenderContext }) {
  if (section.images.length === 0) return <Ghost mode={ctx.mode} kind="image" label="Add photos to the gallery" />;
  return (
    <section className={cn("grid gap-3", section.columns === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {section.images.map((img, i) => (
        <img
          key={`${img.path}-${i}`}
          src={pageImageUrl(ctx.supabaseUrl, img.path)}
          alt={img.alt}
          loading="lazy"
          decoding="async"
          className={cn("aspect-square w-full object-cover", R_CARD)}
        />
      ))}
    </section>
  );
}
