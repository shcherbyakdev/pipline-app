"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Link2Off } from "lucide-react";
import { issuePortalLink, revokePortalLink } from "@/features/clients/actions";
import type { ClientLink } from "@/features/clients/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INTL_LOCALES } from "@/i18n/config";

// Deterministic across server/client: the app's locale + UTC (links-panel
// precedent — toLocaleDateString varies by runtime and breaks hydration).
const formatDate = (iso: string, intlLocale: string) =>
  new Intl.DateTimeFormat(intlLocale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

// Issue + list + revoke. The raw URL exists only in issuePortalLink's
// return value — rendered once here, never fetchable again. Rotation =
// issue a new link, then revoke the old one.
export function PortalLinksPanel({ clientId, links }: { clientId: string; links: ClientLink[] }) {
  const t = useTranslations("clients.portal");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const intlLocale = INTL_LOCALES[useLocale()];
  const fmt = (iso: string) => formatDate(iso, intlLocale);
  const [freshUrl, setFreshUrl] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const issue = () =>
    startTransition(async () => {
      const result = await issuePortalLink({ clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFreshUrl(result.url);
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tc("linkCopied"));
    } catch {
      toast.error(te("clients.copyFailed"));
    }
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokePortalLink({ id });
      if (!result.ok) toast.error(result.error);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">{t("title")}</h2>
        <Button size="sm" variant="secondary" disabled={isPending} onClick={issue}>
          {t("issue")}
        </Button>
      </div>
      {freshUrl ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
          <Input readOnly value={freshUrl} className="h-7 font-mono text-xs" aria-label={t("newLinkAria")} />
          <Button size="sm" variant="ghost" onClick={() => copy(freshUrl)} aria-label={tc("copyLink")}>
            <Copy className="size-3.5" />
          </Button>
          <p className="text-muted-foreground shrink-0 text-[10px]">{t("shownOnce")}</p>
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <Badge variant={l.status === "active" ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                {t(`status.${l.status}`)}
              </Badge>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {t("issued", { date: fmt(l.createdAt) })}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {t("expires", { date: fmt(l.expiresAt) })}
              </span>
              {l.lastUsedAt ? (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {t("used", { date: fmt(l.lastUsedAt) })}
                </span>
              ) : null}
              {l.status === "active" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-6"
                  aria-label={t("revokeAria", { date: fmt(l.createdAt) })}
                  onClick={() => revoke(l.id)}
                >
                  <Link2Off className="size-3" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      )}
    </div>
  );
}
