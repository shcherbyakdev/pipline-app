"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { SettingsPrefRow } from "@/components/settings-row";
import { SettingsSelect } from "@/components/settings-select";

const subscribeNoop = () => () => {};

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/* Interface theme picker (Settings › Interface). Lives here rather than in
   the shell so the sidebar stays Linear-quiet. The server renders with no
   theme known, so it names the default one ("light" — providers.tsx) and the
   real choice is applied only after mount, via a state update: React does not
   repair markup it hydrated, and a mismatch here would stick. */
export function AppearanceSettings() {
  const t = useTranslations("settings.appearance");
  const { resolvedTheme, setTheme } = useTheme();
  // false on the server / during hydration, true on every client render after.
  const mounted = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  const current = (mounted ? resolvedTheme : undefined) ?? "light";
  return (
    <SettingsPrefRow label={t("title")} blurb={t("blurb")}>
      <SettingsSelect
        label={t("title")}
        value={current as Theme}
        options={THEMES.map((value) => ({ value, label: t(value) }))}
        onSelect={setTheme}
      />
    </SettingsPrefRow>
  );
}
