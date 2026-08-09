"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import type { Unit } from "@/features/rollouts/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StageDots } from "./stage-dots";

export function UnitRow({
  unit,
  stageNames,
  onRename,
  onDelete,
  onToggleStage,
}: {
  unit: Unit;
  stageNames: Record<string, string>;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleStage: (unitStageId: string, done: boolean) => void;
}) {
  // No effect syncing local state from `unit.name`: the call site
  // (unit-list.tsx) keys this component on `${unit.id}:${unit.name}`, so a
  // server-truth name change remounts this row instead of requiring a
  // `useEffect` state sync (react-hooks/set-state-in-effect).
  const [value, setValue] = React.useState(unit.name);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === unit.name) {
      setValue(unit.name);
      return;
    }
    onRename(next);
  };

  const doneCount = unit.stages.filter((s) => s.done).length;

  return (
    <li className="group flex items-center gap-2 rounded-md border px-2 py-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label={`Unit name: ${unit.name}`}
        className="border-transparent shadow-none focus-visible:border-input"
      />
      <StageDots
        stages={unit.stages.map((s) => ({
          unitStageId: s.unitStageId,
          name: stageNames[s.stageId] ?? "stage",
          done: s.done,
        }))}
        onToggle={onToggleStage}
      />
      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
        {doneCount}/{unit.stages.length}
      </span>
      {unit.externalRef !== null ? (
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {unit.externalRef}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${unit.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
