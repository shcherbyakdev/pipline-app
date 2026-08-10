"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { addUnit, renameUnit, deleteUnit, setUnitStageStatus } from "@/features/programs/actions";
import type { ProgramStage, Unit } from "@/features/programs/queries";
import { UnitRow } from "./unit-row";
import { AddUnit } from "./add-unit";

// Project convention (see features/README.md): useOptimistic over the
// server-provided array; every mutation applies optimistically inside a
// transition, calls the Server Action, and toasts on failure. The action's
// revalidatePath re-renders the server truth, which resets optimistic state.
type UnitEvent =
  | { type: "add"; id: string; name: string; externalRef?: string; stages: Unit["stages"] }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "setStage"; unitId: string; unitStageId: string; done: boolean };

function applyEvent(units: Unit[], event: UnitEvent): Unit[] {
  switch (event.type) {
    case "add":
      return [
        ...units,
        {
          id: event.id,
          name: event.name,
          externalRef: event.externalRef ?? null,
          assignedParticipantId: null,
          stages: event.stages,
        },
      ];
    case "rename":
      return units.map((u) => (u.id === event.id ? { ...u, name: event.name } : u));
    case "delete":
      return units.filter((u) => u.id !== event.id);
    case "setStage":
      return units.map((u) =>
        u.id === event.unitId
          ? {
              ...u,
              stages: u.stages.map((s) =>
                s.unitStageId === event.unitStageId ? { ...s, done: event.done } : s,
              ),
            }
          : u,
      );
  }
}

export function UnitList({
  programId,
  units,
  stages,
}: {
  programId: string;
  units: Unit[];
  stages: ProgramStage[];
}) {
  const [optimistic, dispatch] = useOptimistic(units, applyEvent);
  const [, startTransition] = React.useTransition();

  const stageMeta: Record<string, { name: string; hasRequirements: boolean }> =
    Object.fromEntries(stages.map((s) => [s.id, { name: s.name, hasRequirements: s.hasRequirements }]));

  const run = (event: UnitEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const cells = optimistic.flatMap((u) => u.stages);
  const doneCells = cells.filter((c) => c.done).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Units ({optimistic.length})</h2>
        {cells.length > 0 ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {doneCells} of {cells.length} stages done ·{" "}
            {Math.round((doneCells / cells.length) * 100)}%
          </p>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1">
        {optimistic.map((unit) => (
          <UnitRow
            // Keyed remount: when the server-truth name changes (a
            // successful rename re-renders with new server data), a fresh
            // key remounts UnitRow so its local input state re-derives from
            // `unit.name` — the sanctioned alternative to syncing local state
            // from props in an effect (react-hooks/set-state-in-effect).
            key={`${unit.id}:${unit.name}`}
            unit={unit}
            programId={programId}
            stageMeta={stageMeta}
            onRename={(name) =>
              run({ type: "rename", id: unit.id, name }, () =>
                renameUnit({ id: unit.id, name }),
              )
            }
            onDelete={() =>
              run({ type: "delete", id: unit.id }, () => deleteUnit({ id: unit.id }))
            }
            onToggleStage={(unitStageId, done) =>
              run({ type: "setStage", unitId: unit.id, unitStageId, done }, () =>
                setUnitStageStatus({ id: unitStageId, done }),
              )
            }
          />
        ))}
      </ol>
      {optimistic.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No units yet — add the people or things moving through this program.
        </p>
      ) : null}
      <AddUnit
        onAdd={(name, externalRef) =>
          run(
            {
              type: "add",
              id: crypto.randomUUID(),
              name,
              externalRef,
              // Synthesized pending cells so the optimistic row renders real
              // dots; server truth replaces the temp ids on revalidation. A
              // click on a temp id fails safe: generic error toast, then
              // reconciliation.
              stages: stages.map((s) => ({
                unitStageId: crypto.randomUUID(),
                stageId: s.id,
                done: false,
              })),
            },
            () => addUnit({ programId, name, externalRef }),
          )
        }
      />
    </div>
  );
}
