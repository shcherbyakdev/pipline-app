"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import {
  addRequirement,
  renameRequirement,
  deleteRequirement,
  reorderRequirements,
} from "@/features/templates/actions";
import type { Requirement } from "@/features/templates/queries";
import { RequirementRow } from "./requirement-row";
import { AddRequirement } from "./add-requirement";

// Same optimistic convention as stage-list.tsx, scoped to one stage's
// requirements. See stage-list.tsx for why only moves need isPending.
type RequirementEvent =
  | { type: "add"; requirement: Requirement }
  | { type: "rename"; id: string; label: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 };

function applyEvent(reqs: Requirement[], event: RequirementEvent): Requirement[] {
  switch (event.type) {
    case "add":
      return [...reqs, event.requirement];
    case "rename":
      return reqs.map((r) => (r.id === event.id ? { ...r, label: event.label } : r));
    case "delete":
      return reqs.filter((r) => r.id !== event.id);
    case "move": {
      const index = reqs.findIndex((r) => r.id === event.id);
      const target = index + event.direction;
      if (index < 0 || target < 0 || target >= reqs.length) return reqs;
      const next = [...reqs];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((r, i) => ({ ...r, position: i }));
    }
  }
}

export function RequirementList({
  templateStageId,
  requirements,
}: {
  templateStageId: string;
  requirements: Requirement[];
}) {
  const [optimistic, dispatch] = useOptimistic(requirements, applyEvent);
  const [isPending, startTransition] = React.useTransition();

  const run = (event: RequirementEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const onMove = (id: string, direction: -1 | 1) => {
    const moved = applyEvent(optimistic, { type: "move", id, direction });
    run({ type: "move", id, direction }, () =>
      reorderRequirements({ templateStageId, requirementIds: moved.map((r) => r.id) }),
    );
  };

  return (
    <div className="flex flex-col gap-1.5 pt-1.5">
      <ol className="flex flex-col gap-1 pl-7">
        {optimistic.map((r, index) => (
          <RequirementRow
            key={`${r.id}:${r.label}`}
            requirement={r}
            isFirst={index === 0}
            isLast={index === optimistic.length - 1}
            moveDisabled={isPending}
            onRename={(label) =>
              run({ type: "rename", id: r.id, label }, () =>
                renameRequirement({ id: r.id, label }),
              )
            }
            onDelete={() => run({ type: "delete", id: r.id }, () => deleteRequirement({ id: r.id }))}
            onMove={(direction) => onMove(r.id, direction)}
          />
        ))}
      </ol>
      <AddRequirement
        onAdd={({ type, label, required, options, items, config }) =>
          run(
            {
              type: "add",
              requirement: {
                id: crypto.randomUUID(),
                type,
                label,
                required,
                config,
                position: optimistic.reduce((max, r) => Math.max(max, r.position), -1) + 1,
              },
            },
            () => addRequirement({ templateStageId, type, label, required, options, items }),
          )
        }
      />
    </div>
  );
}
