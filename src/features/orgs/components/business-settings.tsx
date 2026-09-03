"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateOrgModes } from "@/features/orgs/actions";
import { ORG_MODES, type OrgModeChoice } from "@/features/orgs/schema";
import { cn } from "@/lib/utils";

/** Each channel's card reads its own namespace (`spaces.settings`,
    `appointments.settings`) — the one place the channel is named for people. */
const NS: Record<OrgModeChoice, "spaces" | "appointments"> = { rentals: "spaces", appointments: "appointments" };

/* Org-level "what you offer" (Settings → Business): one channel per
   workspace (0073). A live radio only while the current channel has nothing
   active in it (`locked` — the page counts, update_org_modes enforces);
   after that, a fixed label. Optimistic: the card flips at once and rolls
   back on a failed save. */
export function BusinessSettings({ mode, locked }: { mode: OrgModeChoice; locked: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = React.useState(mode);
  const [pending, startTransition] = React.useTransition();

  const pick = (next: OrgModeChoice) => {
    if (next === value) return;
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
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("settings.business.title")}</div>
        <p className="text-muted-foreground text-sm">{t("settings.business.blurb")}</p>
      </div>
      {locked ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-xl border p-3">
            <div className="text-sm font-medium">{t(`${NS[mode]}.settings.label`)}</div>
            <div className="text-muted-foreground text-sm">{t(`${NS[mode]}.settings.blurb`)}</div>
          </div>
          <p className="text-muted-foreground text-xs">{t("settings.business.locked")}</p>
        </div>
      ) : (
      /* Native radios in label-cards (the onboarding mode step's idiom). */
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="sr-only">{t("settings.business.title")}</legend>
        {ORG_MODES.map((choice) => {
          const selected = value === choice;
          return (
            <label
              key={choice}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                selected ? "border-foreground/40 bg-accent" : "hover:bg-accent/60",
              )}
            >
              <input
                type="radio"
                name="business-mode"
                value={choice}
                className="sr-only"
                checked={selected}
                onChange={() => pick(choice)}
              />
              <span className="text-sm font-medium">{t(`${NS[choice]}.settings.label`)}</span>
              <span className="text-muted-foreground text-sm">{t(`${NS[choice]}.settings.blurb`)}</span>
            </label>
          );
        })}
      </fieldset>
      )}
    </div>
  );
}
