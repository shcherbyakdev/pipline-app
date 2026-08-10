"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SectionRequirement } from "@/features/programs/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequirementField({
  requirement,
  onSave,
  onClear,
  onUploadPhoto,
  onRemovePhoto,
}: {
  requirement: SectionRequirement;
  onSave: (value: string | number | boolean) => void;
  onClear: () => void;
  // Photo controls: pass both from the participant flow while the stage is
  // pending; omit both for the read-only console display.
  onUploadPhoto?: (file: File) => void;
  onRemovePhoto?: (evidenceId: string) => void;
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
        <div className="flex flex-wrap items-center gap-2">
          {r.photos.map((p) => {
            const meta = [
              p.filename,
              `${Math.max(1, Math.round(p.sizeBytes / 1024))} KB`,
              p.uploadedBy ?? undefined,
              p.createdAt ? new Date(p.createdAt).toLocaleString() : undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <span key={p.id} className="relative inline-flex">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" title={meta}>
                    {/* Short-lived signed URLs: next/image's optimizer and
                        remotePatterns add nothing for a private bucket. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.filename}
                      className="h-16 w-16 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <span
                    title={meta}
                    className="bg-muted text-muted-foreground inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border p-1 text-center text-[10px] break-all"
                  >
                    {p.filename}
                  </span>
                )}
                {onRemovePhoto ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute -top-2 -right-2 size-5 rounded-full"
                    aria-label={`Remove ${p.filename}`}
                    onClick={() => onRemovePhoto(p.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </span>
            );
          })}
          {onUploadPhoto ? (
            <label className="border-input text-muted-foreground hover:bg-accent inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px]">
              <Plus className="size-4" />
              Add photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadPhoto(f);
                  e.target.value = ""; // same file can be re-picked after a failure
                }}
              />
            </label>
          ) : r.photos.length === 0 ? (
            <span className="text-muted-foreground text-xs">Awaiting photo</span>
          ) : null}
        </div>
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
