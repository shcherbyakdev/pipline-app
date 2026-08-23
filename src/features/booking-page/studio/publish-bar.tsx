"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "./use-page-draft";

const STATUS_LABEL: Record<SaveStatus, string | null> = {
  idle: null, saving: "Saving…", saved: "Saved", error: "Couldn't save", invalid: "Fix errors to save",
};

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
    <div className="bg-card flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {neverPublished ? (
            <Badge variant="secondary">Not published yet</Badge>
          ) : unpublished ? (
            <Badge variant="secondary">Unpublished changes</Badge>
          ) : (
            <Badge variant="outline">Live</Badge>
          )}
          {label ? <span role="status" className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{label}</span> : null}
          {status === "error" ? <Button size="xs" variant="ghost" onClick={onRetry}>Retry</Button> : null}
        </div>
        {liveUrl ? (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-3">
            View live page
          </a>
        ) : null}
      </div>
      {pageIssue ? <p className="text-destructive text-xs">{pageIssue}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onPublish} disabled={busy || status === "invalid" || !unpublished}>Publish</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy || !unpublished}>Discard changes</Button>
      </div>
    </div>
  );
}
