"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { submitResponse, clearResponse, uploadPhoto, removePhoto } from "@/features/participants/flow-actions";
import { RequirementField } from "@/features/programs/components/requirement-field";
import type { SectionRequirement, StageSection } from "@/features/programs/queries";
import { isAllowedPhotoType, PHOTO_MAX_BYTES } from "@/lib/storage/photo";
import { Badge } from "@/components/ui/badge";

// The participant twin of unit-stage-sections: same optimistic derive
// mirror, NO override control (staff-only — it's the audit line between
// 'requirements' and 'override'). Done stages collapse to a summary line.
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string }
  | { type: "addPhoto"; unitStageId: string; requirementId: string; filename: string; placeholderId: string }
  | { type: "removePhoto"; unitStageId: string; requirementId: string; evidenceId: string };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required);
  if (required.length === 0) return section;
  const satisfied = required.every((r) =>
    r.type === "photo"
      ? r.photos.length > 0
      : r.type === "boolean"
        ? r.value === true
        : r.value !== null && r.value !== "",
  );
  return satisfied
    ? { ...section, status: "done", doneSource: "requirements" }
    : { ...section, status: "pending", doneSource: null };
}

function applyEvent(sections: StageSection[], event: SectionEvent): StageSection[] {
  return sections.map((s) => {
    if (s.unitStageId !== event.unitStageId) return s;
    switch (event.type) {
      case "setValue":
      case "clear": {
        const value = event.type === "setValue" ? event.value : null;
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId ? { ...r, value } : r,
          ),
        });
      }
      case "addPhoto":
        // Placeholder tile (no URL yet); revalidation replaces it with truth.
        // `placeholderId` is generated once, at event creation (onUploadPhoto
        // below), NOT derived from r.photos.length here — useOptimistic
        // replays pending actions in order over base state on every render,
        // so an id computed from a length that itself depends on earlier
        // pending events in the same replay can collide across two
        // concurrent addPhoto events, producing a duplicate React key and a
        // removePhoto filter that drops both tiles. `optimistic: true` marks
        // this as a placeholder — never set by a real read model — so the
        // remove button can be withheld for it (see requirement-field.tsx):
        // tapping it can only ever fail server-side, since the server's
        // evidenceId is a uuid and this id never is.
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId
              ? {
                  ...r,
                  photos: [
                    ...r.photos,
                    {
                      id: event.placeholderId,
                      filename: event.filename,
                      sizeBytes: 0,
                      createdAt: "",
                      uploadedBy: null,
                      url: null,
                      optimistic: true,
                    },
                  ],
                }
              : r,
          ),
        });
      case "removePhoto":
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId
              ? { ...r, photos: r.photos.filter((p) => p.id !== event.evidenceId) }
              : r,
          ),
        });
    }
  });
}

export function ParticipantStageSections({
  token,
  unitId,
  sections,
}: {
  token: string;
  unitId: string;
  sections: StageSection[];
}) {
  const [optimistic, dispatch] = useOptimistic(sections, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: SectionEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  return (
    <div className="flex flex-col gap-4">
      {optimistic.map((s) => {
        const required = s.requirements.filter((r) => r.required);
        const satisfied = required.filter((r) =>
          r.type === "photo"
            ? r.photos.length > 0
            : r.type === "boolean"
              ? r.value === true
              : r.value !== null && r.value !== "",
        ).length;
        if (s.status === "done") {
          // Thumbnails visible, no controls (design spec): reuse
          // RequirementField's own read-only branch — the same one the
          // staff console gets by omitting onUploadPhoto/onRemovePhoto —
          // rather than a second photo renderer. Only requirements that
          // actually have photos get a row, so a stage completed entirely
          // by scalar answers still collapses to just the summary line.
          const photoRequirements = s.requirements.filter(
            (r) => r.type === "photo" && r.photos.length > 0,
          );
          return (
            <section key={s.unitStageId} className="flex flex-col gap-2 rounded-lg border px-4 py-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{s.name}</h2>
                <Badge variant="secondary" className="ml-auto text-[10px]">done</Badge>
              </div>
              {photoRequirements.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {photoRequirements.map((r) => (
                    <RequirementField
                      key={`${r.id}:${r.photos.length}`}
                      requirement={r}
                      onSave={() => {}}
                      onClear={() => {}}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        }
        return (
          <section key={s.unitStageId} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              {required.length > 0 ? (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {satisfied}/{required.length}
                </Badge>
              ) : null}
            </div>
            {s.requirements.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing to fill in here.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {s.requirements.map((r: SectionRequirement) => (
                  <RequirementField
                    key={`${r.id}:${String(r.value)}:${r.photos.length}`}
                    requirement={r}
                    onSave={(value) =>
                      run(
                        { type: "setValue", unitStageId: s.unitStageId, requirementId: r.id, value },
                        () =>
                          submitResponse({
                            token,
                            unitId,
                            requirementId: r.id,
                            type: r.type as Exclude<SectionRequirement["type"], "photo">,
                            value,
                          }),
                      )
                    }
                    onClear={() =>
                      run({ type: "clear", unitStageId: s.unitStageId, requirementId: r.id }, () =>
                        clearResponse({ token, unitId, requirementId: r.id }),
                      )
                    }
                    onUploadPhoto={(file) => {
                      // Pre-check before any bytes move; the server and the
                      // bucket both re-check.
                      if (
                        !isAllowedPhotoType(file.type) ||
                        file.size === 0 ||
                        file.size > PHOTO_MAX_BYTES
                      ) {
                        toast.error("Photos must be JPEG, PNG, WebP, HEIC, or HEIF and under 15MB.");
                        return;
                      }
                      const fd = new FormData();
                      fd.set("token", token);
                      fd.set("unitId", unitId);
                      fd.set("requirementId", r.id);
                      fd.set("file", file);
                      run(
                        {
                          type: "addPhoto",
                          unitStageId: s.unitStageId,
                          requirementId: r.id,
                          filename: file.name,
                          // Generated once here, at event creation, so it's
                          // stable across useOptimistic's replays.
                          placeholderId: `optimistic-${crypto.randomUUID()}`,
                        },
                        () => uploadPhoto(fd),
                      );
                    }}
                    onRemovePhoto={(evidenceId) =>
                      run(
                        { type: "removePhoto", unitStageId: s.unitStageId, requirementId: r.id, evidenceId },
                        () => removePhoto({ token, unitId, evidenceId }),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
