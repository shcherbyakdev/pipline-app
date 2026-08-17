"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setDateOverride, deleteDateOverride } from "@/features/scheduling/actions";
import { OVERLAP_ERROR } from "@/features/scheduling/schema";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  TIME_OPTIONS,
  endOptions,
  nextInterval,
  hasOverlap,
  formatTime,
  type Interval,
} from "@/features/scheduling/time-options";
import type { RuleRow, ExceptionRow } from "@/features/scheduling/queries";
import { TimeCombobox } from "./time-combobox";

const MAX_WINDOWS = 10; // mirrors dateOverrideInput's zod cap

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(date: string): string {
  // Noon UTC avoids DST/offset edge cases pushing the date field itself
  // across a day boundary when rendered in the browser's local time.
  const d = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

type Group = { date: string; closed: boolean; windows: Interval[] };

function groupExceptions(exceptions: ExceptionRow[]): Group[] {
  const byDate = new Map<string, ExceptionRow[]>();
  for (const e of exceptions) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const closed = rows.some((r) => r.closed);
      const windows = closed
        ? []
        : rows
            .map((r) => ({ startTime: r.startTime!, endTime: r.endTime! }))
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return { date, closed, windows };
    });
}

// `staffId`: whose overrides these are — see WeeklyHours for the same note.
export function DateOverrides({
  staffId,
  rules,
  exceptions,
}: {
  staffId: string;
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  // Bumped on every openNew/openEdit call so <OverrideDialog> — keyed on
  // it — remounts and re-derives fresh initial state from current props,
  // rather than needing an effect to re-seed on every open.
  const [dialogKey, setDialogKey] = React.useState(0);
  const [editingDate, setEditingDate] = React.useState<string | null>(null);

  const groups = React.useMemo(() => groupExceptions(exceptions), [exceptions]);

  function openNew() {
    setEditingDate(null);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function openEdit(date: string) {
    setEditingDate(date);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Date overrides</h2>
        <p className="text-muted-foreground text-xs">
          Days when your availability differs from your weekly hours.
        </p>
      </div>
      {groups.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <OverrideRow
              key={group.date}
              staffId={staffId}
              group={group}
              onEdit={() => openEdit(group.date)}
            />
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={openNew}
      >
        <Plus /> Add a date override
      </Button>
      <OverrideDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        staffId={staffId}
        date={editingDate}
        rules={rules}
        exceptions={exceptions}
      />
    </section>
  );
}

function OverrideRow({
  staffId,
  group,
  onEdit,
}: {
  staffId: string;
  group: Group;
  onEdit: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const label = formatDateLabel(group.date);

  function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await deleteDateOverride({ staffId, date: group.date });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Override removed");
    });
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border">
      <button
        type="button"
        onClick={onEdit}
        className="flex flex-1 flex-col items-start gap-0.5 rounded-l-lg px-3 py-2 text-left hover:bg-accent/50"
      >
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">
          {group.closed
            ? "Unavailable"
            : group.windows
                .map((w) => `${formatTime(w.startTime)}–${formatTime(w.endTime)}`)
                .join(", ")}
        </span>
      </button>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className="mr-2 shrink-0"
        disabled={pending}
        aria-label={`Remove override for ${label}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function OverrideDialog({
  open,
  onOpenChange,
  staffId,
  date,
  rules,
  exceptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffId: string;
  date: string | null;
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}) {
  const isEditing = date !== null;
  const initialDate = date ?? todayISO();
  const initialWindows = effectiveWindows(initialDate, rules, exceptions);

  const [draftDate, setDraftDate] = React.useState(initialDate);
  const [closed, setClosed] = React.useState(initialWindows.length === 0);
  const [windows, setWindows] = React.useState<Interval[]>(initialWindows);
  const [touched, setTouched] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const today = todayISO();
  const next = closed ? null : nextInterval(windows);
  const addDisabled = closed || next === null || windows.length >= MAX_WINDOWS;
  const errorId = "date-override-error";

  function reseedForDate(nextDate: string) {
    if (touched) return;
    const eff = effectiveWindows(nextDate, rules, exceptions);
    setClosed(eff.length === 0);
    setWindows(eff);
  }

  function onDateChange(nextDate: string) {
    setDraftDate(nextDate);
    reseedForDate(nextDate);
  }

  function onToggleClosed(checked: boolean) {
    setTouched(true);
    setError(null);
    setClosed(checked);
  }

  function updateWindow(index: number, patch: Partial<Interval>) {
    setTouched(true);
    setError(null);
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWindow(index: number) {
    setTouched(true);
    setError(null);
    setWindows((prev) => prev.filter((_, i) => i !== index));
  }

  function addWindow() {
    if (!next) return;
    setTouched(true);
    setError(null);
    setWindows((prev) => [...prev, next]);
  }

  function validate(): string | null {
    if (closed) return null;
    if (windows.length === 0) return "Add at least one time window, or mark the day unavailable.";
    for (const w of windows) {
      if (w.startTime >= w.endTime) return "End must be after start.";
    }
    if (hasOverlap(windows)) return OVERLAP_ERROR;
    return null;
  }

  function onSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      const result = await setDateOverride({
        staffId,
        date: draftDate,
        closed,
        windows: closed ? [] : windows,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isEditing ? "Override updated" : "Override added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit date override" : "Add a date override"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="override-date" className="text-sm font-medium">
              Date
            </label>
            <Input
              id="override-date"
              type="date"
              min={today}
              value={draftDate}
              onChange={(e) => onDateChange(e.target.value)}
              // date is fixed while editing — changing it would orphan the
              // original date's rows; delete and re-add instead
              disabled={isEditing}
              className="w-auto"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={closed} onCheckedChange={(c) => onToggleClosed(c === true)} />
            Unavailable
          </label>
          {!closed ? (
            <div className="flex flex-col gap-2">
              {windows.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TimeCombobox
                    value={w.startTime}
                    options={TIME_OPTIONS}
                    onCommit={(hm) => updateWindow(i, { startTime: hm })}
                    label={`Window ${i + 1} start time`}
                    invalid={error !== null}
                    describedBy={error !== null ? errorId : undefined}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    –
                  </span>
                  <TimeCombobox
                    value={w.endTime}
                    options={endOptions(w.startTime)}
                    onCommit={(hm) => updateWindow(i, { endTime: hm })}
                    label={`Window ${i + 1} end time`}
                    invalid={error !== null}
                    describedBy={error !== null ? errorId : undefined}
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove window ${i + 1}`}
                    onClick={() => removeWindow(i)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                disabled={addDisabled}
                onClick={addWindow}
              >
                <Plus /> Add interval
              </Button>
            </div>
          ) : null}
          {error ? (
            <p id={errorId} className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={onSave}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
