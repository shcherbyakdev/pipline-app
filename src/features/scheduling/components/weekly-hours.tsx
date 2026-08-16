"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Copy, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  addAvailabilityRule,
  updateAvailabilityRule,
  deleteAvailabilityRule,
  copyDayHours,
} from "@/features/scheduling/actions";
import { OVERLAP_ERROR } from "@/features/scheduling/schema";
import {
  TIME_OPTIONS,
  endOptions,
  nextInterval,
  overlapsSiblings,
  type Interval,
} from "@/features/scheduling/time-options";
import type { RuleRow } from "@/features/scheduling/queries";
import { TimeCombobox } from "./time-combobox";

// Local to this file — the old editor's copies of these arrays are deleted
// alongside it in Task 8, so nothing else in the app owns weekday labels.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_LABELS_SHORT = ["Sun.", "Mon.", "Tue.", "Wed.", "Thu.", "Fri.", "Sat."];

type Conflict = { ruleId: string; message: string } | null;

export function WeeklyHours({ rules }: { rules: RuleRow[] }) {
  return (
    <div className="rounded-lg border border-border">
      {WEEKDAY_ORDER.map((weekday, i) => (
        <DayRow
          key={weekday}
          weekday={weekday}
          rules={rules.filter((r) => r.weekday === weekday)}
          isLast={i === WEEKDAY_ORDER.length - 1}
        />
      ))}
    </div>
  );
}

function DayRow({
  weekday,
  rules,
  isLast,
}: {
  weekday: number;
  rules: RuleRow[];
  isLast: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [conflict, setConflict] = React.useState<Conflict>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [targets, setTargets] = React.useState<Set<number>>(new Set());

  const fullLabel = WEEKDAY_LABELS_FULL[weekday];
  const shortLabel = WEEKDAY_LABELS_SHORT[weekday];
  const sortedRules = React.useMemo(
    () => [...rules].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [rules],
  );
  const dayIntervals: Interval[] = React.useMemo(
    () => rules.map((r) => ({ startTime: r.startTime, endTime: r.endTime })),
    [rules],
  );
  const next = nextInterval(dayIntervals);
  const otherWeekdays = WEEKDAY_ORDER.filter((d) => d !== weekday);

  function commitTime(rule: RuleRow, patch: Partial<Interval>) {
    const candidate: Interval = {
      startTime: patch.startTime ?? rule.startTime,
      endTime: patch.endTime ?? rule.endTime,
    };
    if (candidate.startTime >= candidate.endTime) {
      setConflict({ ruleId: rule.id, message: "End must be after start." });
      return;
    }
    const siblings: Interval[] = rules
      .filter((r) => r.id !== rule.id)
      .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    if (overlapsSiblings(candidate, siblings)) {
      setConflict({ ruleId: rule.id, message: OVERLAP_ERROR });
      return;
    }
    setConflict(null);
    startTransition(async () => {
      const result = await updateAvailabilityRule({ id: rule.id, ...candidate });
      if (!result.ok) toast.error(result.error);
    });
  }

  function onAdd() {
    if (!next) return;
    startTransition(async () => {
      const result = await addAvailabilityRule({ weekday, ...next });
      if (!result.ok) toast.error(result.error);
    });
  }

  function onDelete(rule: RuleRow) {
    startTransition(async () => {
      const result = await deleteAvailabilityRule({ id: rule.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConflict((c) => (c?.ruleId === rule.id ? null : c));
    });
  }

  function onCopyOpenChange(open: boolean) {
    setCopyOpen(open);
    if (!open) setTargets(new Set());
  }

  function toggleTarget(day: number, checked: boolean) {
    setTargets((prev) => {
      const nextTargets = new Set(prev);
      if (checked) nextTargets.add(day);
      else nextTargets.delete(day);
      return nextTargets;
    });
  }

  function onApplyCopy() {
    startTransition(async () => {
      const result = await copyDayHours({
        sourceWeekday: weekday,
        targetWeekdays: Array.from(targets),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCopyOpen(false);
      setTargets(new Set());
    });
  }

  return (
    <div className={cn("flex items-start gap-3 p-3", !isLast && "border-b border-border")}>
      <span className="w-12 shrink-0 pt-2 text-sm font-medium">{shortLabel}</span>
      <div className="flex flex-1 flex-col gap-2">
        {sortedRules.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">Unavailable</p>
        ) : (
          sortedRules.map((rule) => (
            <IntervalLine
              key={rule.id}
              rule={rule}
              fullLabel={fullLabel}
              conflict={conflict?.ruleId === rule.id ? conflict : null}
              pending={pending}
              onCommitStart={(hm) => commitTime(rule, { startTime: hm })}
              onCommitEnd={(hm) => commitTime(rule, { endTime: hm })}
              onDelete={() => onDelete(rule)}
            />
          ))
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-1">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Add interval to ${fullLabel}`}
          disabled={pending || !next}
          title={!next ? "No room left after the last interval" : undefined}
          onClick={onAdd}
        >
          <Plus />
        </Button>
        <Popover open={copyOpen} onOpenChange={onCopyOpenChange}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`Copy ${fullLabel} hours to other days`}
              >
                <Copy />
              </Button>
            }
          />
          <PopoverContent align="end" className="w-56">
            <p className="mb-2 text-sm font-medium">Copy hours to…</p>
            <div className="flex flex-col gap-2">
              {otherWeekdays.map((day) => (
                <label key={day} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox
                    checked={targets.has(day)}
                    onCheckedChange={(checked) => toggleTarget(day, checked === true)}
                  />
                  {WEEKDAY_LABELS_FULL[day]}
                </label>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              className="mt-3 w-full"
              disabled={targets.size === 0 || pending}
              onClick={onApplyCopy}
            >
              Apply
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function IntervalLine({
  rule,
  fullLabel,
  conflict,
  pending,
  onCommitStart,
  onCommitEnd,
  onDelete,
}: {
  rule: RuleRow;
  fullLabel: string;
  conflict: Conflict;
  pending: boolean;
  onCommitStart: (hm: string) => void;
  onCommitEnd: (hm: string) => void;
  onDelete: () => void;
}) {
  const messageId = `rule-conflict-${rule.id}`;
  const invalid = conflict !== null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <TimeCombobox
          value={rule.startTime}
          options={TIME_OPTIONS}
          onCommit={onCommitStart}
          label={`${fullLabel} start time`}
          invalid={invalid}
          describedBy={invalid ? messageId : undefined}
          disabled={pending}
        />
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
        <TimeCombobox
          value={rule.endTime}
          options={endOptions(rule.startTime)}
          onCommit={onCommitEnd}
          label={`${fullLabel} end time`}
          invalid={invalid}
          describedBy={invalid ? messageId : undefined}
          disabled={pending}
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Remove ${fullLabel} ${rule.startTime}–${rule.endTime}`}
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      {invalid ? (
        <p id={messageId} className="text-destructive text-xs">
          {conflict.message}
        </p>
      ) : null}
    </div>
  );
}
