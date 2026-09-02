"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-page-draft";

/* Slim persistent header row (the Framer/Webflow pattern): draft state on the
   left, the way out — view live, discard, publish — on the right. Rendered by
   the builder above both panes, so it never disappears behind a tab or the
   section inspector. */
export function PublishBar({
  status, unpublished, neverPublished, busy, pageIssue, liveUrl, capped = null, onRetry, onPublish, onDiscard,
}: {
  status: SaveStatus; unpublished: boolean; neverPublished: boolean; busy: boolean;
  /** Page-level zod message (exactly-one-booking etc.), if any. */
  pageIssue?: string; liveUrl: string | null;
  /** The plan hides this channel from the public page: clients would see a
      not-found page. `href` is the door out (the waitlist or plans), if any. */
  capped?: { href: string | null } | null;
  onRetry: () => void; onPublish: () => void; onDiscard: () => void;
}) {
  const t = useTranslations("studio.publishBar");
  const tCommon = useTranslations("common");
  const label =
    status === "saving" ? tCommon("saving")
    : status === "saved" ? tCommon("saved")
    : status === "error" ? t("saveFailed")
    : status === "invalid" ? t("fixErrors")
    : null;
  const bad = status === "error" || status === "invalid";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {neverPublished ? (
          <Badge variant="secondary">{t("notPublished")}</Badge>
        ) : unpublished ? (
          <Badge variant="secondary">{t("unpublished")}</Badge>
        ) : (
          <Badge variant="outline">{t("live")}</Badge>
        )}
        {label ? <span role="status" className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{label}</span> : null}
        {status === "error" ? <Button size="xs" variant="ghost" onClick={onRetry}>{t("retry")}</Button> : null}
        {pageIssue ? <span className="text-destructive text-xs">{pageIssue}</span> : null}
        {capped ? (
          <span role="status" className="text-amber-700 dark:text-amber-400 text-xs">
            {t("capped")}
            {capped.href ? (
              <>
                {" "}
                <a href={capped.href} className="underline underline-offset-3">{t("liftLimit")}</a>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3">
            {t("viewLive")}
          </a>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy || !unpublished}>{t("discard")}</Button>
        <Button size="sm" variant="brand" onClick={onPublish} disabled={busy || status === "invalid" || !unpublished}>{t("publish")}</Button>
      </div>
    </div>
  );
}
