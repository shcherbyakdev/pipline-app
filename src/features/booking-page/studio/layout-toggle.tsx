"use client";

import { PanelRight, Rows3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import type { PageDocument } from "../schema";

type Layout = PageDocument["layout"];
// The shape each one makes: sections stacked, or booking docked to the right.
const OPTIONS = [
  { id: "column", Icon: Rows3 },
  { id: "split", Icon: PanelRight },
] as const satisfies ReadonlyArray<{ id: Layout; Icon: typeof Rows3 }>;

export function LayoutToggle({ value, onChange }: { value: Layout; onChange: (layout: Layout) => void }) {
  const t = useTranslations("studio.layout");
  return (
    <div role="radiogroup" aria-label={t("label")} className={SEGMENTED_NAV_CLASS}>
      {OPTIONS.map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          title={t(`${id}Hint`)}
          onClick={() => onChange(id)}
          className={segmentedItemClass(value === id, "h-6 gap-1 px-2.5 text-xs")}
        >
          <Icon aria-hidden className="size-3.5" />
          {t(id)}
        </button>
      ))}
    </div>
  );
}
