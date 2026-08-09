"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { addUnit, renameUnit, deleteUnit } from "@/features/rollouts/actions";
import type { Unit } from "@/features/rollouts/queries";
import { UnitRow } from "./unit-row";
import { AddUnit } from "./add-unit";

// Project convention (see features/README.md): useOptimistic over the
// server-provided array; every mutation applies optimistically inside a
// transition, calls the Server Action, and toasts on failure. The action's
// revalidatePath re-renders the server truth, which resets optimistic state.
// Units are unordered (no position/move), so the reducer only handles
// add/rename/delete.
type UnitEvent =
  | { type: "add"; id: string; name: string; externalRef?: string }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string };

function applyEvent(units: Unit[], event: UnitEvent): Unit[] {
  switch (event.type) {
    case "add":
      return [...units, { id: event.id, name: event.name, externalRef: event.externalRef ?? null }];
    case "rename":
      return units.map((u) => (u.id === event.id ? { ...u, name: event.name } : u));
    case "delete":
      return units.filter((u) => u.id !== event.id);
  }
}

export function UnitList({ rolloutId, units }: { rolloutId: string; units: Unit[] }) {
  const [optimistic, dispatch] = useOptimistic(units, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: UnitEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">Units ({optimistic.length})</h2>
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
            onRename={(name) =>
              run({ type: "rename", id: unit.id, name }, () =>
                renameUnit({ id: unit.id, name }),
              )
            }
            onDelete={() =>
              run({ type: "delete", id: unit.id }, () => deleteUnit({ id: unit.id }))
            }
          />
        ))}
      </ol>
      {optimistic.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No units yet — add the people or things moving through this rollout.
        </p>
      ) : null}
      <AddUnit
        onAdd={(name, externalRef) =>
          run({ type: "add", id: crypto.randomUUID(), name, externalRef }, () =>
            addUnit({ rolloutId, name, externalRef }),
          )
        }
      />
    </div>
  );
}
