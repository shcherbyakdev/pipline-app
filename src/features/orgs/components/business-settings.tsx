"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateOrgModes } from "@/features/orgs/actions";
import { ORG_MODES, type OrgModeChoice } from "@/features/orgs/schema";
import { SettingsPrefRow } from "@/components/settings-row";
import { SettingsSelect } from "@/components/settings-select";

/** Each channel reads its own namespace (`spaces.settings`,
    `appointments.settings`) — the one place the channel is named for people. */
const NS: Record<OrgModeChoice, "spaces" | "appointments"> = { rentals: "spaces", appointments: "appointments" };

/* Org-level "what you offer" (Settings → Business): one channel per
   workspace (0073). A live choice only while the current channel has nothing
   active in it (`locked` — the page counts, update_org_modes enforces);
   after that, a fixed label. Optimistic: the row flips at once and rolls
   back on a failed save. */
export function BusinessSettings({ mode, locked }: { mode: OrgModeChoice; locked: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = React.useState(mode);
  const [pending, startTransition] = React.useTransition();

  const pick = (next: OrgModeChoice) => {
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateOrgModes({ mode: next });
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
    <SettingsPrefRow
      label={t("settings.business.title")}
      blurb={locked ? t("settings.business.locked") : t("settings.business.blurb")}
    >
      {locked ? (
        <span className="text-muted-foreground shrink-0 text-sm">{t(`${NS[mode]}.settings.label`)}</span>
      ) : (
        <SettingsSelect
          label={t("settings.business.title")}
          value={value}
          busy={pending}
          disabled={pending}
          options={ORG_MODES.map((choice) => ({
            value: choice,
            label: t(`${NS[choice]}.settings.label`),
            hint: t(`${NS[choice]}.settings.blurb`),
          }))}
          onSelect={pick}
        />
      )}
    </SettingsPrefRow>
  );
}
