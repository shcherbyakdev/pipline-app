import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HTTPS_RE, type SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { H2 } from "../type";

export function LocationSection({ section, ctx }: { section: SectionOf<"location">; ctx: RenderContext }) {
  const t = useTranslations("public.location");
  const address = section.address.trim();
  // Never render a non-https href, even though the schema already rejects
  // bad URLs and only validated documents render publicly.
  const maps = HTTPS_RE.test(section.mapsUrl.trim()) ? section.mapsUrl.trim() : "";
  if (!address && !maps) return <Ghost ctx={ctx} text="address" />;
  const link = "inline-flex w-fit items-center gap-1 text-sm font-medium underline-offset-3 hover:underline";
  const body = (
    <>
      {t("openMaps")}
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden className="shrink-0" />
    </>
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className={H2}>{t("title")}</h2>
      {address ? <address className="text-muted-foreground whitespace-pre-line not-italic leading-relaxed">{address}</address> : null}
      {maps ? (
        ctx.mode === "preview" ? (
          <span className={link}>{body}</span>
        ) : (
          <a href={maps} target="_blank" rel="noopener noreferrer" className={link}>{body}</a>
        )
      ) : null}
    </section>
  );
}
