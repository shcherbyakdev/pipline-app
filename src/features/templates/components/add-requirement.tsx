"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { Requirement } from "@/features/templates/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TYPES = ["text", "number", "boolean", "date", "choice", "photo", "checklist"] as const;
export type EditorType = (typeof TYPES)[number];

export function AddRequirement({
  onAdd,
}: {
  onAdd: (r: {
    type: EditorType;
    label: string;
    required: boolean;
    options?: string[];
    items?: string[];
    config: Requirement["config"];
    recurLeadDays?: number;
  }) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<EditorType>("text");
  const [required, setRequired] = React.useState(true);
  const [lines, setLines] = React.useState("");
  const [leadDays, setLeadDays] = React.useState("");

  const needsLines = type === "choice" || type === "checklist";
  const parsedLines = [...new Set(lines.split("\n").map((l) => l.trim()).filter((l) => l !== ""))];
  const linesValid = !needsLines || parsedLines.length >= (type === "choice" ? 2 : 1);
  const parsedLead = leadDays.trim() === "" ? undefined : Number(leadDays);
  const leadValid =
    type !== "date" || leadDays.trim() === "" || (Number.isInteger(parsedLead) && parsedLead! >= 1);
  const valid = label.trim() !== "" && linesValid && leadValid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onAdd({
      type,
      label: label.trim(),
      required,
      options: type === "choice" ? parsedLines : undefined,
      items: type === "checklist" ? parsedLines : undefined,
      config:
        type === "choice"
          ? { options: parsedLines }
          : type === "checklist"
            ? { items: parsedLines }
            : {},
      recurLeadDays: type === "date" ? parsedLead : undefined,
    });
    setLabel("");
    setLines("");
    setLeadDays("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 pl-7">
      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a requirement…"
          maxLength={120}
          aria-label="New requirement label"
          className="h-7 text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EditorType)}
          aria-label="Requirement type"
          className="border-input bg-transparent h-7 shrink-0 rounded-md border px-2 text-xs"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {type === "date" ? (
          <Input
            type="number"
            min={1}
            value={leadDays}
            onChange={(e) => setLeadDays(e.target.value)}
            placeholder="re-arm days"
            aria-label="Re-arm this many days before the date (blank = never)"
            className="h-7 w-28 shrink-0 text-xs"
          />
        ) : null}
        <label className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            aria-label="Required"
          />
          required
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      {needsLines ? (
        <Textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          placeholder={type === "choice" ? "One option per line (min 2)" : "One checklist item per line"}
          aria-label={type === "choice" ? "Choice options" : "Checklist items"}
          rows={3}
          className="text-sm"
        />
      ) : null}
    </form>
  );
}
