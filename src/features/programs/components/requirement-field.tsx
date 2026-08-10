"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import type { SectionRequirement } from "@/features/programs/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequirementField({
  requirement,
  onSave,
  onClear,
}: {
  requirement: SectionRequirement;
  onSave: (value: string | number | boolean) => void;
  onClear: () => void;
}) {
  const r = requirement;
  const inputId = `req-${r.id}`;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="w-56 shrink-0 truncate text-sm" title={r.label}>
        {r.label}
        {r.required ? null : <span className="text-muted-foreground"> (optional)</span>}
      </label>
      {r.type === "boolean" ? (
        <input
          id={inputId}
          type="checkbox"
          checked={r.value === true}
          onChange={(e) => onSave(e.target.checked)}
          className="size-4"
        />
      ) : r.type === "choice" ? (
        <select
          id={inputId}
          value={typeof r.value === "string" ? r.value : ""}
          onChange={(e) => e.target.value !== "" && onSave(e.target.value)}
          className="border-input bg-transparent h-8 rounded-md border px-2 text-sm"
        >
          <option value="" disabled>Choose…</option>
          {(r.config.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : r.type === "photo" ? (
        <span className="text-muted-foreground text-xs">photo evidence arrives in a later release</span>
      ) : (
        // text | number | date share the commit-on-blur Input. Keyed remount
        // (call site) re-derives defaultValue when the server truth changes.
        <Input
          id={inputId}
          type={r.type === "number" ? "number" : r.type === "date" ? "date" : "text"}
          step={r.type === "number" ? "any" : undefined}
          defaultValue={r.value === null ? "" : String(r.value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            // Uncontrolled input: on any branch that doesn't save, reset the
            // DOM value back to the stored one — mirrors StageRow's
            // empty-blur reset, since a keyed remount won't fire here
            // (r.value hasn't changed).
            if (raw === "" || raw === String(r.value ?? "")) {
              e.target.value = r.value === null ? "" : String(r.value);
              return;
            }
            if (r.type === "number") {
              const n = Number(raw);
              if (!Number.isFinite(n)) {
                e.target.value = r.value === null ? "" : String(r.value);
                return;
              }
              onSave(n);
            } else {
              onSave(raw);
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 max-w-64 text-sm"
        />
      )}
      {r.value !== null && r.type !== "photo" ? (
        <Button
          variant="ghost" size="icon" className="size-6"
          aria-label={`Clear ${r.label}`} onClick={onClear}
        >
          <Trash2 className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
