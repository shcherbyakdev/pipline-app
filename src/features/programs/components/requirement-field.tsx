"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { SectionRequirement } from "@/features/programs/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Display-only: client-supplied filenames are stored with only a length
// cap, so control characters, newlines, and bidi-override codepoints (e.g.
// U+202E, which can visually reverse an apparent file extension) survive
// into the DB verbatim. Never alters what's stored -- this only sanitizes
// the four places a filename is rendered, below. Strips C0/C1 controls and
// the explicit bidi formatting characters.
const UNSAFE_FILENAME_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function displayFilename(filename: string): string {
  return filename.replace(UNSAFE_FILENAME_CHARS, "");
}

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
  // The photo branch only renders an element carrying `inputId` (the file
  // input, below) when onUploadPhoto is passed — the read-only console/done
  // display renders neither an input nor a label target. Every other
  // branch always renders its id'd control, so htmlFor is safe there.
  const hasIdTarget = r.type !== "photo" || Boolean(onUploadPhoto);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={hasIdTarget ? inputId : undefined} className="w-56 shrink-0 truncate text-sm" title={r.label}>
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
            const safeFilename = displayFilename(p.filename);
            const meta = [
              safeFilename,
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
                      alt={safeFilename}
                      className="h-16 w-16 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <span
                    title={meta}
                    className="bg-muted text-muted-foreground inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border p-1 text-center text-[10px] break-all"
                  >
                    {safeFilename}
                  </span>
                )}
                {onRemovePhoto && !p.optimistic ? (
                  // Withheld on the optimistic placeholder: its id is a
                  // client-generated string, never the uuid removePhoto's
                  // schema requires, so tapping this before revalidation
                  // lands could only ever fail server-side.
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute -top-2 -right-2 size-5 rounded-full"
                    aria-label={`Remove ${safeFilename}`}
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
                id={inputId}
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
