"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import {
  addStage,
  renameStage,
  deleteStage,
  reorderStages,
} from "@/features/templates/actions";
import type { Stage } from "@/features/templates/queries";
import { StageRow } from "./stage-row";
import { AddStage } from "./add-stage";
import { RequirementList } from "./requirement-list";

// Project convention (see features/README.md): useOptimistic over the
// server-provided array; every mutation applies optimistically inside a
// transition, calls the Server Action, and toasts on failure. The action's
// revalidatePath re-renders the server truth, which resets optimistic state.
type StageEvent =
  | { type: "add"; id: string; name: string }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 };

function applyEvent(stages: Stage[], event: StageEvent): Stage[] {
  switch (event.type) {
    case "add": {
      const position = stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      return [...stages, { id: event.id, name: event.name, position, requirements: [] }];
    }
    case "rename":
      return stages.map((s) => (s.id === event.id ? { ...s, name: event.name } : s));
    case "delete":
      return stages.filter((s) => s.id !== event.id);
    case "move": {
      const index = stages.findIndex((s) => s.id === event.id);
      const target = index + event.direction;
      if (index < 0 || target < 0 || target >= stages.length) return stages;
      const next = [...stages];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, position: i }));
    }
  }
}

export function StageList({ templateId, stages }: { templateId: string; stages: Stage[] }) {
  const [optimistic, dispatch] = useOptimistic(stages, applyEvent);
  // isPending guards the move arrows only (see onMove): reorder is the one
  // mutation that derives its payload from a snapshot of `optimistic` taken
  // in an event-handler closure, so a second move fired before the first
  // move's transition re-renders would compute from stale pre-first-move
  // order and persist the wrong result. Add/rename/delete key off a single
  // stage id and don't depend on array order, so they don't need this guard.
  const [isPending, startTransition] = React.useTransition();

  const run = (event: StageEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const onMove = (id: string, direction: -1 | 1) => {
    const moved = applyEvent(optimistic, { type: "move", id, direction });
    run({ type: "move", id, direction }, () =>
      reorderStages({ templateId, stageIds: moved.map((s) => s.id) }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">
        Stages ({optimistic.length})
      </h2>
      <ol className="flex flex-col gap-1">
        {optimistic.map((stage, index) => (
          // Keyed remount: when the server-truth name changes (a successful
          // rename re-renders with new server data), a fresh key remounts
          // StageRow so its local input state re-derives from `stage.name`
          // — the sanctioned alternative to syncing local state from props
          // in an effect (react-hooks/set-state-in-effect).
          <li key={`${stage.id}:${stage.name}`} className="flex flex-col">
            <StageRow
              stage={stage}
              isFirst={index === 0}
              isLast={index === optimistic.length - 1}
              moveDisabled={isPending}
              onRename={(name) =>
                run({ type: "rename", id: stage.id, name }, () =>
                  renameStage({ id: stage.id, name }),
                )
              }
              onDelete={() =>
                run({ type: "delete", id: stage.id }, () => deleteStage({ id: stage.id }))
              }
              onMove={(direction) => onMove(stage.id, direction)}
            />
            <RequirementList templateStageId={stage.id} requirements={stage.requirements} />
          </li>
        ))}
      </ol>
      {optimistic.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No stages yet — add the first step of this workflow.
        </p>
      ) : null}
      <AddStage
        onAdd={(name) =>
          run({ type: "add", id: crypto.randomUUID(), name }, () =>
            addStage({ templateId, name }),
          )
        }
      />
    </div>
  );
}
