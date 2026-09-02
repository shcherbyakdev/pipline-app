"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, Copy, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  addAvailabilityRule,
  applyDefaultHours,
  updateAvailabilityRule,
  deleteAvailabilityRule,
  copyDayHours,
} from "@/features/scheduling/actions";
import { DEFAULT_START_TIME, DEFAULT_END_TIME } from "@/features/scheduling/default-hours";
import type { AvailabilityOwner } from "@/features/scheduling/schema";
import {
  TIME_OPTIONS,
  endOptions,
  nextInterval,
  overlapsSiblings,
  type Interval,
} from "@/features/scheduling/time-options";
import type { RuleRow } from "@/features/scheduling/queries";
import { TimeCombobox } from "./time-combobox";

// Monday-first rows; the day names come from `availability.weekdaysLong` /
// `weekdaysShort` (Sunday first, like `weekday` on the rows).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type Conflict = { ruleId: string; message: string } | null;

// `owner` is whose week this is: a staff member (the page's `?staff=` /
// `?space=` tab, or the sole active member for a solo org) XOR an hourly
// space (H2/U3). Rules are already scoped to that owner by the query; the id
// travels with every write that creates or re-keys a row.
export function WeeklyHours({ owner, rules }: { owner: AvailabilityOwner; rules: RuleRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {/* A week with nothing in it is the state a new owner used to start in
          and the one anyone who clears their week lands back in. Filling it
          day by day is seven "+" clicks; this is one. */}
      {rules.length === 0 ? <DefaultHoursPrompt owner={owner} /> : null}
      <div className="rounded-lg border border-border">
        {WEEKDAY_ORDER.map((weekday, i) => (
          <DayRow
            key={weekday}
            owner={owner}
            weekday={weekday}
            rules={rules.filter((r) => r.weekday === weekday)}
            isLast={i === WEEKDAY_ORDER.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function DefaultHoursPrompt({ owner }: { owner: AvailabilityOwner }) {
  const t = useTranslations("availability.defaultPrompt");
  const [pending, startTransition] = React.useTransition();

  function onApply() {
    startTransition(async () => {
      const result = await applyDefaultHours(owner);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="mr-auto">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-xs">{t("blurb", { start: DEFAULT_START_TIME, end: DEFAULT_END_TIME })}</p>
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={onApply}>
        {pending ? t("applying") : t("apply")}
      </Button>
    </div>
  );
}

function DayRow({
  owner,
  weekday,
  rules,
  isLast,
}: {
  owner: AvailabilityOwner;
  weekday: number;
  rules: RuleRow[];
  isLast: boolean;
}) {
  const t = useTranslations("availability");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = React.useTransition();
  const [conflict, setConflict] = React.useState<Conflict>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [targets, setTargets] = React.useState<Set<number>>(new Set());

  const weekdaysLong = t("weekdaysLong").split(" ");
  const fullLabel = weekdaysLong[weekday];
  const shortLabel = t("weekdaysShort").split(" ")[weekday];
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
      setConflict({ ruleId: rule.id, message: t("endAfterStart") });
      return;
    }
    const siblings: Interval[] = rules
      .filter((r) => r.id !== rule.id)
      .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    if (overlapsSiblings(candidate, siblings)) {
      setConflict({ ruleId: rule.id, message: tErrors("availability.overlap") });
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
      const result = await addAvailabilityRule({ ...owner, weekday, ...next });
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
        ...owner,
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
          <p className="pt-2 text-sm text-muted-foreground">{t("unavailable")}</p>
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
          aria-label={t("day.addInterval", { day: fullLabel })}
          disabled={pending || !next}
          title={!next ? t("day.noRoom") : undefined}
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
                aria-label={t("day.copyHours", { day: fullLabel })}
              >
                <Copy />
              </Button>
            }
          />
          <PopoverContent align="end" className="w-56">
            <p className="mb-2 text-sm font-medium">{t("day.copyTo")}</p>
            <div className="flex flex-col gap-2">
              {otherWeekdays.map((day) => (
                <label key={day} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox
                    checked={targets.has(day)}
                    onCheckedChange={(checked) => toggleTarget(day, checked === true)}
                  />
                  {weekdaysLong[day]}
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
              {t("day.apply")}
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
  const t = useTranslations("availability.day");
  const messageId = `rule-conflict-${rule.id}`;
  const invalid = conflict !== null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <TimeCombobox
          value={rule.startTime}
          options={TIME_OPTIONS}
          onCommit={onCommitStart}
          label={t("startTime", { day: fullLabel })}
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
          label={t("endTime", { day: fullLabel })}
          invalid={invalid}
          describedBy={invalid ? messageId : undefined}
          disabled={pending}
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t("removeInterval", { day: fullLabel, start: rule.startTime, end: rule.endTime })}
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
