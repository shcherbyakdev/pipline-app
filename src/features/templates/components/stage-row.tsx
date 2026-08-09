"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Stage } from "@/features/templates/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function StageRow({
  stage,
  isFirst,
  isLast,
  onRename,
  onDelete,
  onMove,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  // No effect syncing local state from `stage.name`: the call site
  // (stage-list.tsx) keys this component on `${stage.id}:${stage.name}`, so
  // a server-truth name change remounts this row instead of requiring a
  // `useEffect` state sync (react-hooks/set-state-in-effect).
  const [value, setValue] = React.useState(stage.name);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === stage.name) {
      setValue(stage.name);
      return;
    }
    onRename(next);
  };

  return (
    <li className="group flex items-center gap-1 rounded-md border px-2 py-1">
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Move ${stage.name} up`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Move ${stage.name} down`}
          disabled={isLast}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={60}
        aria-label={`Stage name: ${stage.name}`}
        className="border-transparent shadow-none focus-visible:border-input"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${stage.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
