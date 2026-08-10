"use client";

import * as React from "react";
import { toast } from "sonner";
import { assignUnit, createParticipant } from "@/features/participants/actions";
import type { ParticipantListItem } from "@/features/participants/queries";

const NEW_SENTINEL = "__new__";

// Compact per-row control. Optimistic value; server truth reconciles via
// revalidatePath. Inline "New…" prompts for a name (window.prompt keeps v1
// minimal — no dialog dependency in the hot row path).
export function AssignParticipant({
  unitId,
  unitName,
  participants,
  value,
}: {
  unitId: string;
  unitName: string;
  participants: ParticipantListItem[];
  value: string | null;
}) {
  const [optimistic, setOptimistic] = React.useState(value);
  const [, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    if (next === NEW_SENTINEL) {
      const name = window.prompt("New participant name")?.trim();
      if (!name) return;
      startTransition(async () => {
        const created = await createParticipant({ name });
        if (!created.ok) {
          toast.error(created.error);
          return;
        }
        setOptimistic(created.id);
        const assigned = await assignUnit({ unitId, participantId: created.id });
        if (!assigned.ok) {
          // The participant now exists but isn't assigned — the select would
          // otherwise show a dangling id with no matching option. Revert to
          // the last known-good value and say so explicitly.
          setOptimistic(value);
          toast.error("Participant created, but assigning failed. Pick them from the list.");
        }
      });
      return;
    }
    const participantId = next === "" ? null : next;
    setOptimistic(participantId);
    startTransition(async () => {
      const result = await assignUnit({ unitId, participantId });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't save. Try again.");
        // A failed action doesn't revalidate, so there's no server-truth
        // re-render to reset optimistic state — the control must revert itself.
        setOptimistic(value);
      }
    });
  };

  return (
    <select
      value={optimistic ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Assign participant for ${unitName}`}
      className="border-input text-muted-foreground h-7 max-w-36 shrink-0 truncate rounded-md border bg-transparent px-1.5 text-xs"
    >
      <option value="">Unassigned</option>
      {participants.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
      <option value={NEW_SENTINEL}>+ New participant…</option>
    </select>
  );
}
