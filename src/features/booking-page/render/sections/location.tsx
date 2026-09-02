import { HTTPS_RE, type SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { H2 } from "../type";

export function LocationSection({ section, ctx }: { section: SectionOf<"location">; ctx: RenderContext }) {
  const address = section.address.trim();
  // Never render a non-https href, even though the schema already rejects
  // bad URLs and only validated documents render publicly.
  const maps = HTTPS_RE.test(section.mapsUrl.trim()) ? section.mapsUrl.trim() : "";
  if (!address && !maps) return <Ghost mode={ctx.mode} label="Add your address" />;
  const link = "w-fit text-sm font-medium underline underline-offset-3";
  return (
    <section className="flex flex-col gap-3">
      <h2 className={H2}>Where to find us</h2>
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
