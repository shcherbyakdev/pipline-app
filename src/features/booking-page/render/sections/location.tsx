import type { SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

export function LocationSection({ section, ctx }: { section: SectionOf<"location">; ctx: RenderContext }) {
  const address = section.address.trim();
  const maps = section.mapsUrl.trim();
  if (!address && !maps) return <Ghost mode={ctx.mode} label="Add your address" />;
  const link = "text-sm font-medium underline underline-offset-3";
  return (
    <section className="flex flex-col gap-2 rounded-[var(--widget-radius)] border p-4">
      <h2 className="text-sm font-semibold">Where to find us</h2>
      {address ? <address className="text-muted-foreground whitespace-pre-line not-italic leading-relaxed">{address}</address> : null}
      {maps ? (
        ctx.mode === "preview" ? (
          <span className={link}>Open in Maps ↗</span>
        ) : (
          <a href={maps} target="_blank" rel="noopener noreferrer" className={link}>Open in Maps ↗</a>
        )
      ) : null}
    </section>
  );
}
