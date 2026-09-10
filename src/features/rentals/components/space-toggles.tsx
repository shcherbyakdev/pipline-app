"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { patchOffering, setOfferingActive } from "@/features/rentals/actions";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        {/* The explanation rides an info glyph (the rail is narrow): a
            tooltip for the pointer, the same words as the button's name
            for a screen reader. */}
        {hint ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={hint}
                  className="text-subtle hover:text-foreground focus-visible:ring-ring/30 rounded-sm outline-none focus-visible:ring-3"
                />
              }
            >
              <HugeiconsIcon
                icon={InformationCircleIcon}
                size={14}
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56 text-left">
              {hint}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      {/* Base UI names the switch after the label (aria-labelledby). */}
      <Switch id={id} checked={on} onCheckedChange={onToggle} />
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
    <TooltipProvider>
      <section className="flex flex-col gap-3">
        <Toggle
          id="space-active"
          label={tc("active")}
          initial={active}
          save={(next) => setOfferingActive({ id, active: next })}
        />
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
    </TooltipProvider>
  );
}
