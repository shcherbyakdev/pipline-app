"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsRow } from "@/components/settings-row";

// Same class string every raw <select> in the app uses (scheduling-settings-form.tsx).
export const SELECT_CLASS =
  "border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-destructive text-[11px]">{message}</p> : null;
}

export function TextField({
  id, label, value, onChange, max, error, hint, placeholder,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number;
  error?: string; hint?: React.ReactNode; placeholder?: string;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <Input id={id} value={value} maxLength={max} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </SettingsRow>
  );
}

export function TextAreaField({
  id, label, value, onChange, max, error, hint, placeholder, rows = 4,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number;
  error?: string; hint?: React.ReactNode; placeholder?: string; rows?: number;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <Textarea id={id} value={value} maxLength={max} rows={rows} placeholder={placeholder} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      <FieldError message={error} />
    </SettingsRow>
  );
}

export function SelectField<T extends string>({
  id, label, value, onChange, options, hint,
}: {
  id: string; label: string; value: T; onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>; hint?: React.ReactNode;
}) {
  return (
    <SettingsRow label={label} htmlFor={id} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={SELECT_CLASS}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </SettingsRow>
  );
}

export function CheckboxField({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 px-4 py-3 text-sm">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  );
}

/* Inline list editor for the repeating props (quotes, questions, links,
   gallery captions): add / remove / move up / move down. No nested
   drag-and-drop on purpose. */
export function ListEditor<T>({
  items, onChange, max, render, blank, addLabel, hideAdd = false,
}: {
  items: T[]; onChange: (items: T[]) => void; max: number;
  render: (item: T, set: (next: T) => void, index: number) => React.ReactNode;
  blank: () => T; addLabel: string;
  /** Gallery: rows are added by uploading, not by a blank row. */
  hideAdd?: boolean;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-2">
          {render(item, (next) => onChange(items.map((it, k) => (k === i ? next : it))), i)}
          <div className="flex items-center justify-end gap-1">
            <Button size="icon-xs" variant="ghost" aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="size-3.5" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Move item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ChevronDown className="size-3.5" /></Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => onChange(items.filter((_, k) => k !== i))}><Trash2 className="size-3.5" /></Button>
          </div>
        </div>
      ))}
      {hideAdd ? null : (
        <Button size="sm" variant="outline" disabled={items.length >= max} onClick={() => onChange([...items, blank()])}>
          <Plus className="size-3.5" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
