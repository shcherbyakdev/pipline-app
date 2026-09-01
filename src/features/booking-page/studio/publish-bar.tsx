"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-page-draft";

const STATUS_LABEL: Record<SaveStatus, string | null> = {
  idle: null, saving: "Saving…", saved: "Saved", error: "Couldn't save", invalid: "Fix errors to save",
};

/* Slim persistent header row (the Framer/Webflow pattern): draft state on the
   left, the way out — view live, discard, publish — on the right. Rendered by
   the builder above both panes, so it never disappears behind a tab or the
   section inspector. */
export function PublishBar({
  status, unpublished, neverPublished, busy, pageIssue, liveUrl, onRetry, onPublish, onDiscard,
}: {
  status: SaveStatus; unpublished: boolean; neverPublished: boolean; busy: boolean;
  /** Page-level zod message (exactly-one-booking etc.), if any. */
  pageIssue?: string; liveUrl: string | null;
  onRetry: () => void; onPublish: () => void; onDiscard: () => void;
}) {
  const label = STATUS_LABEL[status];
  const bad = status === "error" || status === "invalid";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {neverPublished ? (
          <Badge variant="secondary">Not published yet</Badge>
        ) : unpublished ? (
          <Badge variant="secondary">Unpublished changes</Badge>
        ) : (
          <Badge variant="outline">Live</Badge>
        )}
        {label ? <span role="status" className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{label}</span> : null}
        {status === "error" ? <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button> : null}
        {pageIssue ? <span className="text-destructive text-xs">{pageIssue}</span> : null}
      </div>
      <div className="flex items-center gap-2">
        {liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3">
            View live page
          </a>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy || !unpublished}>Discard changes</Button>
        <Button size="sm" variant="brand" onClick={onPublish} disabled={busy || status === "invalid" || !unpublished}>Publish</Button>
      </div>
    </div>
  );
}
