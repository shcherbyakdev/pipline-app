"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun01Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
] as const;

/* Interface theme picker (Settings). Lives here rather than in
   the shell so the sidebar stays Linear-quiet. The server renders with no
   theme known, and React does not repair attribute/className mismatches on
   hydration — so the selected state is applied only after mount (via a state
   update), otherwise the server's "nothing selected" markup would stick. */
export function AppearanceSettings() {
  const { resolvedTheme, setTheme } = useTheme();
  // false on the server / during hydration, true on every client render after.
  const mounted = React.useSyncExternalStore(subscribeNoop, () => true, () => false);
  const current = mounted ? resolvedTheme : undefined;
  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">Interface theme</div>
        <p className="text-muted-foreground text-sm">Applies to this browser only.</p>
      </div>
      <div role="radiogroup" aria-label="Interface theme" className="grid grid-cols-2 gap-2 sm:max-w-xs">
        {OPTIONS.map(({ value, label, icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={cn(
                "flex h-9 items-center justify-center gap-2 rounded-md border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selected
                  ? "border-foreground/40 bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={icon} size={16} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
