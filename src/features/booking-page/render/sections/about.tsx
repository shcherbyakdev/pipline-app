/* eslint-disable @next/next/no-img-element -- Supabase public URLs (BrandedHeader precedent) */
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { H2 } from "../type";

export function AboutSection({ section, ctx }: { section: SectionOf<"about">; ctx: RenderContext }) {
  const src = section.photoPath ? pageImageUrl(ctx.supabaseUrl, section.photoPath) : null;
  const paragraphs = section.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <section className="flex flex-col gap-5 sm:flex-row sm:gap-8">
      {/* `wt-round`: the widget theme squares every `rounded`; the photo stays a disc. */}
      {src ? <img src={src} alt="" loading="lazy" decoding="async" className="wt-round size-24 shrink-0 rounded-full object-cover" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {section.title.trim() ? <h2 className={H2}>{section.title}</h2> : null}
        {paragraphs.length > 0 ? (
          <div className="flex max-w-[62ch] flex-col gap-3">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-muted-foreground whitespace-pre-line leading-relaxed">{p}</p>
            ))}
          </div>
        ) : (
          <Ghost mode={ctx.mode} label="Write a few lines about yourself" />
        )}
      </div>
    </section>
  );
}
