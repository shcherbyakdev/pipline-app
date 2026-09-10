"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateOrgClientContact } from "@/features/orgs/actions";
import { CLIENT_CONTACTS, type ClientContact } from "@/features/orgs/schema";
import { SettingsPrefRow } from "@/components/settings-row";
import { SettingsSelect } from "@/components/settings-select";

/* Settings → Business: which contact details the public booking form asks
   for (orgs.client_contact, 0086). Same optimistic pick as BusinessSettings:
   the row flips at once, rolls back on a failed save. */
export function ClientContactSettings({ value: initial }: { value: ClientContact }) {
  const t = useTranslations("settings.clientContact");
  const tc = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  const pick = (next: ClientContact) => {
    const prev = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateOrgClientContact({ value: next });
      if (!result.ok) {
        setValue(prev);
        toast.error(result.error);
        return;
      }
      toast.success(tc("saved"));
      router.refresh();
    });
  };

  return (
    <SettingsPrefRow label={t("title")} blurb={t("blurb")}>
      <SettingsSelect
        label={t("title")}
        value={value}
        busy={pending}
        disabled={pending}
        options={CLIENT_CONTACTS.map((choice) => ({
          value: choice,
          label: t(`options.${choice}.label`),
          hint: t(`options.${choice}.blurb`),
        }))}
        onSelect={pick}
      />
    </SettingsPrefRow>
  );
}
