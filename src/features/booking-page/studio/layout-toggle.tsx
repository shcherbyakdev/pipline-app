"use client";

import { useTranslations } from "next-intl";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import type { PageDocument } from "../schema";

type Layout = PageDocument["layout"];
const OPTIONS: readonly Layout[] = ["column", "split"];

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  const t = useTranslations("studio.layout");
  return (
    <div role="radiogroup" aria-label={t("label")} className={SEGMENTED_NAV_CLASS}>
      {OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          title={t(`${o}Hint`)}
          onClick={() => onChange(o)}
          className={segmentedItemClass(value === o, "h-6 px-2.5 text-xs")}
        >
          {t(o)}
        </button>
      ))}
    </div>
  );
}
