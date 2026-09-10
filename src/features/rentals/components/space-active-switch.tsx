"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { setOfferingActive } from "@/features/rentals/actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/* The space's on/off, in its header — a status, not a setting, so it saves
   on its own (the list row's switch, offerings-list.tsx, same action) and
   never waits for the settings form's Save. */
export function SpaceActiveSwitch({ id, active: initial }: { id: string; active: boolean }) {
  const tc = useTranslations("common");
  const [active, setActive] = React.useState(initial);
  const [, startTransition] = React.useTransition();
  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setOfferingActive({ id, active: next });
      if (!result.ok) {
        setActive(!next);
        toastRefusal(result.error, result.upgrade);
      }
    });
  };
  return (
    <div className="ml-auto flex items-center gap-2">
      <Label htmlFor="space-active" className="text-muted-foreground text-xs">
        {tc("active")}
      </Label>
      {/* Base UI names the switch after the label (aria-labelledby): "Active". */}
      <Switch id="space-active" checked={active} onCheckedChange={onToggle} />
    </div>
  );
}
