"use client";
import { useTranslations } from "next-intl";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function HeaderForm({ section, issues, onChange }: FormProps<"header">) {
  const t = useTranslations("studio.forms.header");
  return (
    <TextField id="sec-tagline" label={t("tagline")} value={section.tagline} max={120} error={issues.tagline} placeholder={t("taglinePlaceholder")} hint={t("taglineHint")} onChange={(v) => onChange(patch(section, { tagline: v }))} />
  );
}
