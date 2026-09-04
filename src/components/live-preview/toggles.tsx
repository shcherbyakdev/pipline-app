"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@hugeicons/react";
import { ComputerIcon, Moon02Icon, SmartPhone01Icon, Sun01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export type Scheme = "light" | "dark";
export type Device = "desktop" | "mobile";

/* Small icon-only radiogroup used for the preview switches. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string; icon: React.ComponentProps<typeof HugeiconsIcon>["icon"] }>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="bg-secondary flex h-7 items-center gap-0.5 rounded-md border p-0.5"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-6 items-center justify-center rounded-[4px] px-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={o.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}

/* Light/dark switch for whatever the preview is simulating — the host site,
   or the visitor's system — named by the caller so the tooltip says which. */
export function SchemeToggle({
  label,
  value,
  onChange,
  optionLabels,
}: {
  label: string;
  value: Scheme;
  onChange: (v: Scheme) => void;
  optionLabels?: Record<Scheme, string>;
}) {
  const t = useTranslations("studio.preview");
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: "light", label: optionLabels?.light ?? t("light"), icon: Sun01Icon },
        { value: "dark", label: optionLabels?.dark ?? t("dark"), icon: Moon02Icon },
      ]}
    />
  );
}

export function DeviceToggle({ value, onChange }: { value: Device; onChange: (v: Device) => void }) {
  const t = useTranslations("studio.preview");
  return (
    <Segmented
      label={t("device")}
      value={value}
      onChange={onChange}
      options={[
        { value: "desktop", label: t("desktop"), icon: ComputerIcon },
        { value: "mobile", label: t("mobile"), icon: SmartPhone01Icon },
      ]}
    />
  );
}
