"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrgMode } from "@/features/orgs/mode";
import { linkRows } from "@/features/orgs/link-rows";
import { embedSnippet, type EmbedTitles } from "@/features/orgs/components/widget-embed-snippet";
import { bookingLink } from "@/lib/booking/url";
import { copyText } from "@/lib/clipboard";

/* Links & embeds (admin IA spec §5): every place a client can be sent —
   the whole page, one channel, one person, one service, one space — as a
   link and as a snippet. Rows come from linkRows (pure); this component only
   builds the strings and copies them. Rendered only when the org has a
   handle (the page already handles that state). */
export function LinksTable({
  appUrl,
  handle,
  mode,
  staff,
  services,
  spaces,
  titles,
}: {
  appUrl: string;
  handle: string;
  mode: OrgMode;
  staff: { slug: string; name: string }[];
  services: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
  /** The iframe titles in the org's language (public.embedTitle.*). */
  titles: EmbedTitles;
}) {
  const t = useTranslations("embed");
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const rows = linkRows({ mode, staff, services, spaces }).map((row) => ({
    ...row,
    name: "key" in row.label ? t(`rows.${row.label.key}`) : row.label.name,
  }));
  const copy = async (text: string, copied: string) => {
    if (await copyText(text)) toast.success(copied);
    else toast.error(ts("copyRefused"));
  };
  return (
    <section aria-labelledby="links-heading" className="flex flex-col gap-2">
      <h2 id="links-heading" className="text-muted-foreground text-sm font-medium">
        {t("links.title")}
      </h2>
      <p className="text-muted-foreground text-xs">{t("links.description")}</p>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-border border-b last:border-b-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{row.name}</span>
                    {row.badge ? <Badge variant="outline">{t(`badge.${row.badge}`)}</Badge> : null}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => copy(bookingLink(appUrl, handle, row.target), tc("linkCopied"))}
                      aria-label={t("links.copyLinkFor", { name: row.name })}
                    >
                      {tc("copyLink")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => copy(embedSnippet(appUrl, handle, row.target, mode, titles), t("links.embedCopied"))}
                      aria-label={t("links.copyEmbedFor", { name: row.name })}
                    >
                      {t("links.copyEmbed")}
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
