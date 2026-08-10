"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { submitResponse, clearResponse } from "@/features/participants/flow-actions";
import { RequirementField } from "@/features/programs/components/requirement-field";
import type { SectionRequirement, StageSection } from "@/features/programs/queries";
import { Badge } from "@/components/ui/badge";

// The participant twin of unit-stage-sections: same optimistic derive
// mirror, NO override control (staff-only — it's the audit line between
// 'requirements' and 'override'). Done stages collapse to a summary line.
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required && r.type !== "photo");
  if (required.length === 0) return section;
  const satisfied = required.every((r) =>
    r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
  );
  return satisfied
    ? { ...section, status: "done", doneSource: "requirements" }
    : { ...section, status: "pending", doneSource: null };
}

function applyEvent(sections: StageSection[], event: SectionEvent): StageSection[] {
  return sections.map((s) => {
    if (s.unitStageId !== event.unitStageId) return s;
    const value = event.type === "setValue" ? event.value : null;
    return derive({
      ...s,
      requirements: s.requirements.map((r) =>
        r.id === event.requirementId ? { ...r, value } : r,
      ),
    });
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
        const required = s.requirements.filter((r) => r.required && r.type !== "photo");
        const satisfied = required.filter((r) =>
          r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
        ).length;
        if (s.status === "done") {
          return (
            <section key={s.unitStageId} className="flex items-center gap-2 rounded-lg border px-4 py-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              <Badge variant="secondary" className="ml-auto text-[10px]">done</Badge>
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
                    key={`${r.id}:${String(r.value)}`}
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
