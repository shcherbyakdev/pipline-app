"use client";

import { useTranslations } from "next-intl";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";

export type StudioTab = "sections" | "settings";
const TABS: readonly StudioTab[] = ["sections", "settings"];

/* Sections = the draft → Publish model; Settings = saved-as-you-go. */
export function StudioTabs({ value, onChange }: { value: StudioTab; onChange: (tab: StudioTab) => void }) {
  const t = useTranslations("studio");
  return <SegmentedTabs label={t("name")} value={value} onChange={onChange} items={TABS.map((id) => ({ value: id, label: t(`tabs.${id}`) }))} />;
}
