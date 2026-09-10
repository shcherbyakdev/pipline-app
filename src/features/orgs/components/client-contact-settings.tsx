"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateOrgClientContact } from "@/features/orgs/actions";
import { CLIENT_CONTACTS, type ClientContact } from "@/features/orgs/schema";
import { cn } from "@/lib/utils";

/* Settings → Business: which contact details the public booking form asks
   for (orgs.client_contact, 0086). Same optimistic radio-card idiom as
   BusinessSettings: flips at once, rolls back on a failed save. */
export function ClientContactSettings({ value: initial }: { value: ClientContact }) {
  const t = useTranslations("settings.clientContact");
  const tc = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  const pick = (next: ClientContact) => {
    if (next === value) return;
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
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("title")}</div>
        <p className="text-muted-foreground text-sm">{t("blurb")}</p>
      </div>
      <fieldset className="flex flex-col gap-2" disabled={pending}>
        <legend className="sr-only">{t("title")}</legend>
        {CLIENT_CONTACTS.map((choice) => {
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
                name="client-contact"
                value={choice}
                className="sr-only"
                checked={selected}
                onChange={() => pick(choice)}
              />
              <span className="text-sm font-medium">{t(`options.${choice}.label`)}</span>
              <span className="text-muted-foreground text-sm">{t(`options.${choice}.blurb`)}</span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
