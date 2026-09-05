"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsCard, SettingsRow } from "@/components/settings-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PremiumChip } from "@/features/billing/components/premium-chip";
import { setReminderPrefs } from "../actions";
import { DEFAULT_REMINDER_LEAD_HOURS, REMINDER_LEAD_HOURS, type OrgPrefs, type ReminderLeadHours } from "../prefs";

/* The Reminders card (spec 2026-09-05 §3.5): on/off on every plan; the lead
   picker is a paid perk. A capped org sees the picker disabled at 24 h with
   the Premium chip that leads to the door (the appearance-fields badge
   idiom); with no door it is plainly disabled. Both controls autosave. */
export function ReminderSettings({
  prefs,
  canCustomize,
  upgradeHref,
  quotaHint,
}: {
  prefs: OrgPrefs;
  canCustomize: boolean;
  upgradeHref: string | null;
  /** "On Free, reminders go to the first N bookings each month." or null. */
  quotaHint: string | null;
}) {
  const t = useTranslations("notifications.reminders");
  const [, startTransition] = React.useTransition();
  const [shown, setShown] = React.useOptimistic(prefs.reminder);
  const id = React.useId();

  const save = (next: { enabled: boolean; leadHours: ReminderLeadHours }) => {
    startTransition(async () => {
      setShown(next);
      const result = await setReminderPrefs(next);
      if (!result.ok) toast.error(result.error);
    });
  };

  const lead = canCustomize ? shown.leadHours : DEFAULT_REMINDER_LEAD_HOURS;

  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <label htmlFor={`${id}-enabled`} className="text-xs font-medium">
          {t("enabled")}
        </label>
        <Switch id={`${id}-enabled`} checked={shown.enabled} onCheckedChange={(next) => save({ ...shown, enabled: next })} />
      </div>
      <SettingsRow label={t("lead")} hint={quotaHint}>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!shown.enabled || !canCustomize}
              render={
                <Button variant="outline" size="sm" aria-describedby={canCustomize ? undefined : `${id}-plan`}>
                  {t("leadOption", { count: lead })}
                  <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-44">
              {REMINDER_LEAD_HOURS.map((hours) => (
                <DropdownMenuItem key={hours} onClick={() => save({ ...shown, leadHours: hours })}>
                  <CheckIcon className={cn("size-3.5", hours !== lead && "invisible")} aria-hidden />
                  {t("leadOption", { count: hours })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {canCustomize ? null : <PremiumChip id={`${id}-plan`} href={upgradeHref} label={t("premium")} />}
        </div>
      </SettingsRow>
    </SettingsCard>
  );
}
