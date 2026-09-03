"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updateOrgModes } from "@/features/orgs/actions";
import type { OrgMode } from "@/features/orgs/mode";

/** Each channel's Settings row reads its own namespace (`spaces.settings`,
    `appointments.settings`) — the one place the channel is named for people. */
const ROWS = [
  { key: "offersRentals", ns: "spaces" },
  { key: "offersAppointments", ns: "appointments" },
] as const;

/* Org-level "what you offer" (Settings → Business). Optimistic: the box flips
   immediately and rolls back on a failed save. The last enabled channel is
   locked — the RPC enforces the same rule as a defence. */
export function BusinessSettings({ mode }: { mode: OrgMode }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = React.useState<OrgMode>(mode);
  const [pending, startTransition] = React.useTransition();
  const enabledCount = Number(value.offersAppointments) + Number(value.offersRentals);

  const toggle = (key: keyof OrgMode, next: boolean) => {
    const prev = value;
    const draft = { ...value, [key]: next };
    setValue(draft);
    startTransition(async () => {
      const result = await updateOrgModes(draft);
      if (!result.ok) {
        setValue(prev);
        toast.error(result.error);
        return;
      }
      toast.success(t("common.saved"));
      router.refresh();
    });
  };

  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("settings.business.title")}</div>
        <p className="text-muted-foreground text-sm">{t("settings.business.blurb")}</p>
      </div>
      <div className="flex flex-col gap-3">
        {ROWS.map((row) => {
          const checked = value[row.key];
          const locked = checked && enabledCount === 1;
          const id = `business-${row.key}`;
          return (
            <div key={row.key} className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor={id}>{t(`${row.ns}.settings.label`)}</Label>
                <span className="text-muted-foreground text-sm">
                  {locked ? t("errors.orgs.keepOne") : t(`${row.ns}.settings.blurb`)}
                </span>
              </div>
              <Switch
                id={id}
                checked={checked}
                disabled={pending || locked}
                onCheckedChange={(c) => toggle(row.key, c)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
