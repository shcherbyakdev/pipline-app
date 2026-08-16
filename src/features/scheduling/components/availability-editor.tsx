"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  addAvailabilityRule,
  deleteAvailabilityRule,
  addAvailabilityException,
  deleteAvailabilityException,
} from "@/features/scheduling/actions";
import type { RuleRow, ExceptionRow } from "@/features/scheduling/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function WeekdayRow({ weekday, rules }: { weekday: number; rules: RuleRow[] }) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);

  const onDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteAvailabilityRule({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
    });
  };

  const onAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    startTransition(async () => {
      const result = await addAvailabilityRule({ weekday, startTime, endTime });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      formRef.current?.reset();
    });
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
      <span className="text-sm font-medium">{WEEKDAY_LABELS[weekday]}</span>
      {rules.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {rule.startTime}–{rule.endTime}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={pending}
                onClick={() => onDelete(rule.id)}
                aria-label={`Remove ${WEEKDAY_LABELS[weekday]} ${rule.startTime}–${rule.endTime}`}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">Closed</p>
      )}
      <form ref={formRef} onSubmit={onAdd} className="flex flex-wrap items-center gap-2">
        <Input
          type="time"
          step={300}
          name="startTime"
          required
          className="w-auto"
          aria-label={`${WEEKDAY_LABELS[weekday]} start time`}
        />
        <span className="text-muted-foreground text-xs">–</span>
        <Input
          type="time"
          step={300}
          name="endTime"
          required
          className="w-auto"
          aria-label={`${WEEKDAY_LABELS[weekday]} end time`}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Add
        </Button>
      </form>
    </li>
  );
}

function ExceptionRowItem({ exception }: { exception: ExceptionRow }) {
  const [pending, startTransition] = React.useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteAvailabilityException({ id: exception.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{exception.date}</span>
        <span className="text-muted-foreground text-xs">
          {exception.closed ? "Closed" : `${exception.startTime}–${exception.endTime}`}
        </span>
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={onDelete}>
        {pending ? "Removing…" : "Remove"}
      </Button>
    </li>
  );
}

function AddExceptionForm() {
  const [pending, startTransition] = React.useTransition();
  const [closed, setClosed] = React.useState(true);
  const formRef = React.useRef<HTMLFormElement>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const date = String(formData.get("date") ?? "");
    const startTime = String(formData.get("startTime") ?? "");
    const endTime = String(formData.get("endTime") ?? "");
    startTransition(async () => {
      const result = await addAvailabilityException({
        date,
        closed,
        startTime: closed ? undefined : startTime,
        endTime: closed ? undefined : endTime,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      formRef.current?.reset();
      setClosed(true);
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input type="date" name="date" required className="w-auto" aria-label="Exception date" />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={closed}
          onChange={(e) => setClosed(e.target.checked)}
        />
        Closed
      </label>
      {!closed ? (
        <>
          <Input
            type="time"
            step={300}
            name="startTime"
            required={!closed}
            className="w-auto"
            aria-label="Exception start time"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="time"
            step={300}
            name="endTime"
            required={!closed}
            className="w-auto"
            aria-label="Exception end time"
          />
        </>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function AvailabilityEditor({
  rules,
  exceptions,
}: {
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Weekly hours</h2>
        <ul className="flex flex-col gap-2">
          {WEEKDAY_ORDER.map((weekday) => (
            <WeekdayRow
              key={weekday}
              weekday={weekday}
              rules={rules.filter((r) => r.weekday === weekday)}
            />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Exceptions</h2>
        {exceptions.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {exceptions.map((exception) => (
              <ExceptionRowItem key={exception.id} exception={exception} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No upcoming exceptions.</p>
        )}
        <AddExceptionForm />
      </section>
    </div>
  );
}
