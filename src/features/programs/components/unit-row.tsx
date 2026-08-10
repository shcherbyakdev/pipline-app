"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Trash2 } from "lucide-react";
import type { Unit } from "@/features/programs/queries";
import type { ParticipantListItem } from "@/features/participants/queries";
import type { ClientOption } from "@/features/clients/queries";
import { AssignParticipant } from "@/features/participants/components/assign-participant";
import { AssignClient } from "@/features/clients/components/assign-client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StageDots } from "./stage-dots";

export function UnitRow({
  unit,
  programId,
  stageMeta,
  participants,
  clients,
  onRename,
  onDelete,
  onToggleStage,
}: {
  unit: Unit;
  programId: string;
  stageMeta: Record<string, { name: string; hasRequirements: boolean }>;
  participants: ParticipantListItem[];
  clients: ClientOption[];
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
        stages={unit.stages.map((s) => {
          const meta = stageMeta[s.stageId] ?? { name: "stage", hasRequirements: false };
          return {
            unitStageId: s.unitStageId,
            name: meta.name,
            done: s.done,
            href: meta.hasRequirements
              ? `/programs/${programId}/units/${unit.id}#stage-${s.stageId}`
              : null,
          };
        })}
        onToggle={onToggleStage}
      />
      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
        {doneCount}/{unit.stages.length}
      </span>
      <AssignParticipant
        unitId={unit.id}
        unitName={unit.name}
        programId={programId}
        participants={participants}
        value={unit.assignedParticipantId}
      />
      <AssignClient
        unitId={unit.id}
        unitName={unit.name}
        programId={programId}
        clients={clients}
        value={unit.clientId}
      />
      {unit.externalRef !== null ? (
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {unit.externalRef}
        </span>
      ) : null}
      {/*
        A plain styled Link, not <Button render={<Link .../>}>: base-ui's
        Button enforces button semantics (role="button", keyboard handling)
        on whatever it renders, and its own docs say links should not be
        passed through that render prop — style the anchor directly instead.
      */}
      <Link
        href={`/programs/${programId}/units/${unit.id}`}
        aria-label={`Open ${unit.name}`}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7")}
      >
        <ArrowUpRight className="size-3.5" />
      </Link>
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
