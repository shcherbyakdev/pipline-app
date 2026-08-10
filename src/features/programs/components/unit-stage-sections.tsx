"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { saveResponse, clearResponse, setUnitStageStatus } from "@/features/programs/actions";
import { RequirementField } from "@/features/programs/components/requirement-field";
import type { SectionRequirement, StageSection } from "@/features/programs/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Optimistic convention (features/README.md), with a twist: the reducer
// mirrors the DB derivation rule so the status chip flips without waiting
// for the round-trip. The server remains the truth on revalidation.
//
// Note: on requirement-bearing stages, an override is not sticky — the DB
// derivation trigger re-derives status on every response write, so a later
// fill-in can silently flip a stage back out of "override". derive() below
// mirrors that: it only special-cases manual stages (no required fields),
// leaving an override in place there since there's nothing to re-derive from.
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string }
  | { type: "override"; unitStageId: string; done: boolean };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required && r.type !== "photo");
  if (required.length === 0) return section; // manual stage — leave as-is
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
      case "override":
        return {
          ...s,
          status: event.done ? "done" : "pending",
          doneSource: event.done ? "override" : null,
        };
    }
  });
}

export function UnitStageSections({ sections }: { sections: StageSection[] }) {
  const [optimistic, dispatch] = useOptimistic(sections, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: SectionEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  return (
    <div className="flex flex-col gap-6">
      {optimistic.map((s) => {
        const required = s.requirements.filter((r) => r.required && r.type !== "photo");
        const satisfied = required.filter((r) =>
          r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
        ).length;
        const isManual = required.length === 0;
        return (
          <section
            key={s.unitStageId}
            id={`stage-${s.programStageId}`}
            className="flex scroll-mt-20 flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              {s.status === "done" ? (
                <Badge variant="secondary" className="text-[10px]">
                  done · {s.doneSource === "override" ? "override" : "requirements"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {isManual ? "pending" : `pending · ${satisfied}/${required.length}`}
                </Badge>
              )}
              <div className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run({ type: "override", unitStageId: s.unitStageId, done: s.status !== "done" }, () =>
                      setUnitStageStatus({ id: s.unitStageId, done: s.status !== "done" }),
                    )
                  }
                >
                  {s.status === "done" ? "Reopen" : isManual ? "Mark done" : "Mark done anyway"}
                </Button>
              </div>
            </div>
            {s.requirements.length === 0 ? (
              <p className="text-muted-foreground text-sm">No requirements — this stage is completed by hand.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {s.requirements.map((r) => (
                  <RequirementField
                    // Keyed remount on server-truth change (convention).
                    key={`${r.id}:${String(r.value)}`}
                    requirement={r}
                    onSave={(value) =>
                      run(
                        { type: "setValue", unitStageId: s.unitStageId, requirementId: r.id, value },
                        () =>
                          saveResponse({
                            unitStageId: s.unitStageId,
                            requirementId: r.id,
                            type: r.type as Exclude<SectionRequirement["type"], "photo">,
                            value,
                          }),
                      )
                    }
                    onClear={() =>
                      run({ type: "clear", unitStageId: s.unitStageId, requirementId: r.id }, () =>
                        clearResponse({ unitStageId: s.unitStageId, requirementId: r.id }),
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
