import { useTranslations } from "next-intl";
import { allowedLinkUrl, type SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

const PILL = "bg-card hover:bg-muted inline-flex h-10 items-center gap-2 rounded-[var(--widget-radius)] border px-4 text-sm font-medium transition-colors duration-150";

export function LinksSection({ section, ctx }: { section: SectionOf<"links">; ctx: RenderContext }) {
  const t = useTranslations("public.links");
  const items = section.items.filter((i) => i.label.trim() && i.url.trim());
  if (items.length === 0) return <Ghost ctx={ctx} text="link" />;
  return (
    <section className="flex flex-wrap gap-2">
      {items.map((item, i) => {
        // Belt-and-braces: the schema already rejects bad URLs and only
        // validated documents render publicly, but the anchor itself must
        // not trust its input either — never render a non-allowlisted href.
        const inert = ctx.mode === "preview" || !allowedLinkUrl(item.url, item.icon);
        return inert ? (
          <span key={i} className={PILL}>{item.label}</span>
        ) : (
          <a
            key={i}
            href={item.url}
            // tel:/mailto: open in place; only web links get a tab.
            {...(item.url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            aria-label={`${item.label} (${t(item.icon)})`}
            className={PILL}
          >
            {item.label}
          </a>
        );
      })}
    </section>
  );
}
