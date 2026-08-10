"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Link2Off } from "lucide-react";
import { issueLink, revokeLink } from "@/features/participants/actions";
import type { ParticipantListItem, ProgramLink } from "@/features/participants/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Issue + list + revoke. The raw URL exists only in issueLink's return
// value — rendered once here, never fetchable again.
export function LinksPanel({
  programId,
  participants,
  links,
}: {
  programId: string;
  participants: ParticipantListItem[];
  links: ProgramLink[];
}) {
  const [participantId, setParticipantId] = React.useState("");
  const [freshUrl, setFreshUrl] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const issue = () => {
    if (!participantId) return;
    startTransition(async () => {
      const result = await issueLink({ participantId, programId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFreshUrl(result.url);
    });
  };

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokeLink({ id });
      if (!result.ok) toast.error(result.error ?? "Couldn't revoke. Try again.");
    });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">Participant links</h2>
      <div className="flex items-center gap-2">
        <select
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          aria-label="Participant to issue a link for"
          className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Choose participant…</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={!participantId || isPending} onClick={issue}>
          Issue link
        </Button>
      </div>
      {freshUrl ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
          <Input readOnly value={freshUrl} className="h-7 font-mono text-xs" aria-label="New link (shown once)" />
          <Button size="sm" variant="ghost" onClick={() => copy(freshUrl)} aria-label="Copy link">
            <Copy className="size-3.5" />
          </Button>
          <p className="text-muted-foreground shrink-0 text-[10px]">Shown once — copy it now.</p>
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <span className="truncate">{l.participantName}</span>
              <span className="text-muted-foreground truncate">
                {l.unitName ? `· ${l.unitName}` : "· whole program"}
              </span>
              <Badge
                variant={l.status === "active" ? "secondary" : "outline"}
                className="ml-auto shrink-0 text-[10px]"
              >
                {l.status}
              </Badge>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                exp {new Date(l.expiresAt).toLocaleDateString()}
              </span>
              {l.lastUsedAt ? (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  used {new Date(l.lastUsedAt).toLocaleDateString()}
                </span>
              ) : null}
              {l.status === "active" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Revoke link for ${l.participantName}`}
                  onClick={() => revoke(l.id)}
                >
                  <Link2Off className="size-3" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No links yet — issue one to a participant.</p>
      )}
    </div>
  );
}
