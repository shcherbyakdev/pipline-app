"use client";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrgMode } from "@/features/orgs/mode";
import { linkRows } from "@/features/orgs/link-rows";
import { embedSnippet } from "@/features/orgs/components/widget-embed-snippet";
import { bookingLink } from "@/lib/booking/url";
import { COPY_REFUSED, copyText } from "@/lib/clipboard";

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
}: {
  appUrl: string;
  handle: string;
  mode: OrgMode;
  staff: { slug: string; name: string }[];
  services: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
}) {
  const rows = linkRows({ mode, staff, services, spaces });
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast.success(`${what} copied`);
    else toast.error(COPY_REFUSED);
  };
  return (
    <section aria-labelledby="links-heading" className="flex flex-col gap-2">
      <h2 id="links-heading" className="text-muted-foreground text-sm font-medium">
        Links &amp; embeds
      </h2>
      <p className="text-muted-foreground text-xs">
        A link opens your booking page on that thing; an embed is the snippet for it.
      </p>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-border border-b last:border-b-0">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{row.label}</span>
                    {row.badge ? <Badge variant="outline">{row.badge}</Badge> : null}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => copy(bookingLink(appUrl, handle, row.target), "Link")}
                      aria-label={`Copy link — ${row.label}`}
                    >
                      Copy link
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => copy(embedSnippet(appUrl, handle, row.target, mode), "Embed")}
                      aria-label={`Copy embed — ${row.label}`}
                    >
                      Copy embed
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
