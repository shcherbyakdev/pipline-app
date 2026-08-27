/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

/** `bookHref`: the page's first step of booking (pickers.ts bookHref). */
export function HeroSection({ section, ctx, bookHref }: { section: SectionOf<"hero">; ctx: RenderContext; bookHref: string }) {
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
      <BookButton label={section.cta} href={bookHref} mode={ctx.mode} />
    </section>
  );
}

// The one-click path to booking: a plain anchor (works before hydration) to
// the page's picker — the catalogue section when there is one, else the
// widget (bookHref); each target carries `scroll-mt-6` to clear the top
// edge. Preview mode renders the same pill inert — the studio preview never
// scrolls, and the SectionFrame around it takes the click to select.
function BookButton({ label, href, mode }: { label: string | undefined; href: string; mode: "public" | "preview" }) {
  const text = label?.trim();
  if (!text) return null;
  const className = cn(buttonVariants({ size: "lg" }), "wt-primary rounded-[var(--widget-radius)] px-4");
  return mode === "public" ? (
    <a href={href} className={className}>{text}</a>
  ) : (
    <span aria-disabled className={cn(className, "cursor-default")}>{text}</span>
  );
}
