"use client";

import * as React from "react";
import { toast } from "sonner";
import { startChase } from "@/features/chasing/actions";
import type { ChaseListItem } from "@/features/chasing/queries";
import type { ParticipantListItem } from "@/features/participants/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

// Start + list. Sending itself is the drain's job — this panel only creates
// the chase row and shows where each chase stands. The amber "stopped"
// badge is the participant's opt-out surfacing to staff.
export function ChasePanel({
  programId,
  participants,
  units,
  chases,
}: {
  programId: string;
  participants: ParticipantListItem[];
  units: { id: string; name: string }[];
  chases: ChaseListItem[];
}) {
  const [participantId, setParticipantId] = React.useState("");
  const [unitId, setUnitId] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const start = () => {
    if (!participantId) return;
    startTransition(async () => {
      const result = await startChase({
        participantId,
        programId,
        ...(unitId ? { unitId } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Chase started — the next drain sends the link.");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">Chases</h2>
      <div className="flex items-center gap-2">
        <select
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          aria-label="Participant to chase"
          className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Choose participant…</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          aria-label="Scope of the chase"
          className="border-input h-8 max-w-40 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Whole program</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={!participantId || isPending} onClick={start}>
          Send &amp; chase
        </Button>
      </div>
      {chases.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {chases.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <span className="truncate">{c.participantName}</span>
              <span className="text-muted-foreground truncate">
                {c.unitName ? `· ${c.unitName}` : "· whole program"}
              </span>
              <Badge
                variant={c.status === "active" ? "secondary" : "outline"}
                className={
                  "ml-auto shrink-0 text-[10px]" +
                  (c.status === "stopped" ? " border-amber-500 text-amber-600" : "") +
                  (c.status === "stalled" ? " border-red-500 text-red-600" : "")
                }
              >
                {c.status === "stopped" ? "asked to stop" : c.status}
              </Badge>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {c.sendsDone}/4 sent
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                started {formatDate(c.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No chases yet — start one to automate the reminders.</p>
      )}
    </div>
  );
}
