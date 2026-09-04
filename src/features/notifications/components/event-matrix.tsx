"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "@/components/settings-row";
import { setMemberPref } from "../actions";
import { MEMBER_EVENTS, setMemberChannel, type Channel, type MemberEvent, type MemberPrefs } from "../prefs";

/* Four events × two channels, every switch its own autosave (spec 2026-09-05
   §3.11): the switch moves at once and snaps back if the action fails (the
   services row-switch idiom). One optimistic object for the whole grid so
   two quick flips render consistently. */
export function EventMatrix({ prefs }: { prefs: MemberPrefs }) {
  const t = useTranslations("notifications.events");
  const [, startTransition] = React.useTransition();
  const [shown, setShown] = React.useOptimistic(prefs);

  const flip = (event: MemberEvent, channel: Channel, enabled: boolean) => {
    startTransition(async () => {
      setShown((prev) => setMemberChannel(prev, event, channel, enabled));
      const result = await setMemberPref({ event, channel, enabled });
      if (!result.ok) toast.error(result.error);
    });
  };

  const channels: Channel[] = ["email", "push"];
  return (
    <SettingsCard title={t("title")} description={t("blurb")}>
      <div role="table" className="flex flex-col divide-y">
        <div role="row" className="text-muted-foreground grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-2 text-[11px] font-medium">
          {/* A real (empty-looking) first cell keeps the grid's columns: an
              sr-only span is positioned out of flow and would let "Email"
              slide into the label column. */}
          <span role="columnheader">
            <span className="sr-only">{t("title")}</span>
          </span>
          {channels.map((c) => (
            <span key={c} role="columnheader" className="w-12 text-center">
              {t(c)}
            </span>
          ))}
        </div>
        {MEMBER_EVENTS.map((event) => (
          <div key={event} role="row" className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-3">
            <span role="cell" className="text-xs font-medium">
              {t(event)}
            </span>
            {channels.map((channel) => (
              <span key={channel} role="cell" className="flex w-12 justify-center">
                <Switch
                  checked={shown[event][channel]}
                  onCheckedChange={(next) => flip(event, channel, next)}
                  aria-label={t("switchLabel", { event: t(event), channel: t(channel) })}
                />
              </span>
            ))}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}
