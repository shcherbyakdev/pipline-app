"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { patchOffering, setOfferingActive } from "@/features/rentals/actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ActionState } from "@/lib/actions";

/* The space's two on/off properties, in the rail (Linear keeps an issue's
   properties beside it): each saves the moment it flips — the list row's
   switch does the same for Active — and never waits for the settings
   form's Save, so a "Saved" toast says so (a Save button is what people
   look for otherwise). A refusal snaps the switch back with the action's
   words. */
function Toggle({
  id,
  label,
  hint,
  initial,
  save,
}: {
  id: string;
  label: string;
  hint?: string;
  initial: boolean;
  save: (next: boolean) => Promise<ActionState>;
}) {
  const tc = useTranslations("common");
  const [on, setOn] = React.useState(initial);
  const [, startTransition] = React.useTransition();
  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setOn(next);
      const result = await save(next);
      if (result.ok) {
        toast.success(tc("saved"));
        return;
      }
      setOn(!next);
      toastRefusal(result.error, result.upgrade);
    });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        {/* Base UI names the switch after the label (aria-labelledby). */}
        <Switch id={id} checked={on} onCheckedChange={onToggle} />
      </div>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SpaceToggles({
  id,
  active,
  requiresApproval,
}: {
  id: string;
  active: boolean;
  /** Undefined for equipment: it rides a room booking, so it never asks. */
  requiresApproval?: boolean;
}) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  return (
    <section className="flex flex-col gap-3">
      <Toggle id="space-active" label={tc("active")} initial={active} save={(next) => setOfferingActive({ id, active: next })} />
      {requiresApproval === undefined ? null : (
        <Toggle
          id="space-requires-approval"
          label={t("form.requireApproval")}
          hint={t("form.requireApprovalHint")}
          initial={requiresApproval}
          save={(next) => patchOffering({ id, requiresApproval: next })}
        />
      )}
    </section>
  );
}
