"use client";
import { useTranslations } from "next-intl";
import { CheckboxField, SelectField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function ServicesForm({ section, issues, onChange }: FormProps<"services">) {
  const t = useTranslations("studio.forms");
  return (
    <>
      <TextField id="sec-services-title" label={t("title")} value={section.title} max={60} error={issues.title} onChange={(v) => onChange(patch(section, { title: v }))} />
      <SelectField id="sec-services-style" label={t("style")} value={section.style} options={[{ value: "list", label: t("list") }, { value: "cards", label: t("cards") }]} onChange={(style) => onChange(patch(section, { style }))} />
      <CheckboxField id="sec-services-prices" label={t("showPrices")} checked={section.showPrices} onChange={(showPrices) => onChange(patch(section, { showPrices }))} />
      <CheckboxField id="sec-services-durations" label={t("services.showDurations")} checked={section.showDurations} onChange={(showDurations) => onChange(patch(section, { showDurations }))} />
    </>
  );
}
