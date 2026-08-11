"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Requirement } from "@/features/templates/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequirementRow({
  requirement,
  isFirst,
  isLast,
  moveDisabled,
  onRename,
  onDelete,
  onMove,
}: {
  requirement: Requirement;
  isFirst: boolean;
  isLast: boolean;
  moveDisabled: boolean;
  onRename: (label: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  // Keyed remount at the call site re-derives this on server-truth change
  // (react-hooks/set-state-in-effect convention).
  const [value, setValue] = React.useState(requirement.label);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === requirement.label) {
      setValue(requirement.label);
      return;
    }
    onRename(next);
  };

  const detail =
    requirement.type === "choice"
      ? (requirement.config.options ?? []).join(" / ")
      : requirement.type === "checklist"
        ? `${(requirement.config.items ?? []).length} items`
        : requirement.type === "date" && requirement.recurLeadDays !== null
          ? `re-arms ${requirement.recurLeadDays}d before`
          : null;

  return (
    <li className="group flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5">
      <div className="flex flex-col">
        <Button
          variant="ghost" size="icon" className="size-5"
          aria-label={`Move ${requirement.label} up`}
          disabled={isFirst || moveDisabled} onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost" size="icon" className="size-5"
          aria-label={`Move ${requirement.label} down`}
          disabled={isLast || moveDisabled} onClick={() => onMove(1)}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label={`Requirement label: ${requirement.label}`}
        className="h-7 border-transparent text-sm shadow-none focus-visible:border-input"
      />
      <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
        {requirement.type}
      </Badge>
      {requirement.required ? null : (
        <span className="text-muted-foreground shrink-0 text-[10px]">optional</span>
      )}
      {detail ? (
        <span className="text-muted-foreground max-w-32 shrink-0 truncate text-[10px]" title={detail}>
          {detail}
        </span>
      ) : null}
      <Button
        variant="ghost" size="icon"
        className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${requirement.label}`} onClick={onDelete}
      >
        <Trash2 className="size-3" />
      </Button>
    </li>
  );
}
