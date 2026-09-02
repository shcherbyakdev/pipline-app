"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function HeroForm({ section, issues, supabaseUrl, onChange }: FormProps<"hero">) {
  const t = useTranslations("studio.forms.hero");
  // Uploads span several renders; read the latest section through a ref so
  // an edit made mid-upload is never reverted (react-hooks/refs forbids
  // writing a ref during render, hence the effect).
  const sectionRef = React.useRef(section);
  React.useEffect(() => {
    sectionRef.current = section;
  }, [section]);
  return (
    <>
      <ImageField id="sec-hero-image" label={t("image")} path={section.imagePath} supabaseUrl={supabaseUrl} onChange={(imagePath) => onChange(patch(sectionRef.current, { imagePath }))} />
      <TextField id="sec-hero-headline" label={t("headline")} value={section.headline} max={80} error={issues.headline} placeholder={t("headlinePlaceholder")} onChange={(v) => onChange(patch(section, { headline: v }))} />
      <TextField id="sec-hero-sub" label={t("subheadline")} value={section.subheadline} max={160} error={issues.subheadline} onChange={(v) => onChange(patch(section, { subheadline: v }))} />
      <SelectField id="sec-hero-align" label={t("align")} value={section.align} options={[{ value: "left", label: t("left") }, { value: "center", label: t("center") }]} onChange={(align) => onChange(patch(section, { align }))} />
      <TextField id="sec-hero-cta" label={t("button")} value={section.cta ?? ""} max={40} error={issues.cta} placeholder={t("buttonPlaceholder")} hint={t("buttonHint")} onChange={(v) => onChange(patch(section, { cta: v }))} />
    </>
  );
}
