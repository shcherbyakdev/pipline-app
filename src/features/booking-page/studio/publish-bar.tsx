"use client";

import { ExternalLink, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-page-draft";

/* One control in the page's top-right corner instead of a row of them: the
   page's state IS the button. Live is a green pill that opens the live page —
   published and safe, so there is nothing to do and nothing to read; an edit
   turns it into Publish, a failed save into a retry. Each state fades in over
   the one before it (tw-animate), so the corner morphs rather than reflows. */
export function PublishBar({
  status, unpublished, busy, pageIssue, liveUrl, capped = null, onRetry, onPublish, onDiscard,
}: {
  status: SaveStatus; unpublished: boolean; busy: boolean;
  /** Page-level zod message (exactly-one-booking etc.), if any. */
  pageIssue?: string; liveUrl: string | null;
  /** The plan hides this channel from the public page: clients would see a
      not-found page. `href` is the door out (the waitlist or plans), if any. */
  capped?: { href: string | null } | null;
  onRetry: () => void; onPublish: () => void; onDiscard: () => void;
}) {
  const t = useTranslations("studio.publishBar");
  const morph = "animate-in fade-in-0 zoom-in-95 duration-200 ease-strong";
  const pill = cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors", morph);
  const green = "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400";
  const dot = <span aria-hidden className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />;
  const state =
    status === "error" ? (
      <Button key="error" size="sm" variant="outline" onClick={onRetry} className={cn("text-destructive", morph)}>
        <RotateCw aria-hidden />
        {t("saveFailed")}
      </Button>
    ) : status === "invalid" ? (
      <span key="invalid" role="status" className={cn(pill, "bg-destructive/10 text-destructive")}>
        {t("fixErrors")}
      </span>
    ) : unpublished ? (
      <Button key="publish" size="sm" variant="brand" onClick={onPublish} disabled={busy} className={morph}>
        {t("publish")}
      </Button>
    ) : liveUrl ? (
      <a key="live" href={liveUrl} target="_blank" rel="noopener noreferrer" className={cn(pill, green, "hover:bg-emerald-500/20 dark:hover:bg-emerald-400/20")}>
        {dot}
        {t("live")}
        <ExternalLink aria-hidden className="size-3 opacity-60" />
        <span className="sr-only">{t("viewLive")}</span>
      </a>
    ) : (
      // Published, but the public page isn't reachable (no handle, or capped):
      // the same tag without a link to a page that would 404.
      <span key="live-flat" role="status" className={cn(pill, green)}>
        {dot}
        {t("live")}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
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
      {unpublished ? (
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>{t("discard")}</Button>
      ) : null}
      {state}
    </div>
  );
}
