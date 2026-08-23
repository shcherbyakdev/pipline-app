import type { LinkIcon, SectionOf } from "../../schema";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";

const ICON_LABEL: Record<LinkIcon, string> = {
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp",
  website: "Website", phone: "Phone", email: "Email", other: "Link",
};
const PILL = "wt-surface inline-flex h-9 items-center gap-2 rounded-[var(--widget-radius)] border px-3.5 text-sm font-medium";

export function LinksSection({ section, ctx }: { section: SectionOf<"links">; ctx: RenderContext }) {
  const items = section.items.filter((i) => i.label.trim() && i.url.trim());
  if (items.length === 0) return <Ghost mode={ctx.mode} label="Add a link" />;
  return (
    <section className="flex flex-wrap gap-2">
      {items.map((item, i) =>
        ctx.mode === "preview" ? (
          <span key={i} className={PILL}>{item.label}</span>
        ) : (
          <a
            key={i}
            href={item.url}
            // tel:/mailto: open in place; only web links get a tab.
            {...(item.url.startsWith("https://") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            aria-label={`${item.label} (${ICON_LABEL[item.icon]})`}
            className={PILL}
          >
            {item.label}
          </a>
        ),
      )}
    </section>
  );
}
