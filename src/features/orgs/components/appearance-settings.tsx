"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

const subscribeNoop = () => () => {};

const OPTIONS = [
  { value: "light", icon: Sun01Icon },
  { value: "dark", icon: Moon02Icon },
] as const;

/* Interface theme picker (Settings). Lives here rather than in
   the shell so the sidebar stays Linear-quiet. The server renders with no
   theme known, and React does not repair attribute/className mismatches on
   hydration — so the selected state is applied only after mount (via a state
   update), otherwise the server's "nothing selected" markup would stick. */
export function AppearanceSettings() {
  const t = useTranslations("settings.appearance");
  const { resolvedTheme, setTheme } = useTheme();
  // false on the server / during hydration, true on every client render after.
  const mounted = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  const current = mounted ? resolvedTheme : undefined;
  return (
    <div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <div className="text-sm font-medium">{t("title")}</div>
        <p className="text-muted-foreground text-sm">{t("blurb")}</p>
      </div>
      <div role="radiogroup" aria-label={t("title")} className={SEGMENTED_NAV_CLASS}>
        {OPTIONS.map(({ value, icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={segmentedItemClass(selected)}
            >
              <HugeiconsIcon icon={icon} size={15} />
              {t(value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
