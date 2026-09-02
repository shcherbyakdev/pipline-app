"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { TextAreaField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function AboutForm({ section, issues, supabaseUrl, onChange }: FormProps<"about">) {
  const t = useTranslations("studio.forms");
  // Uploads span several renders; read the latest section through a ref so
  // an edit made mid-upload is never reverted (react-hooks/refs forbids
  // writing a ref during render, hence the effect).
  const sectionRef = React.useRef(section);
  React.useEffect(() => {
    sectionRef.current = section;
  }, [section]);
  return (
    <>
      <ImageField id="sec-about-photo" label={t("about.photo")} shape="square" path={section.photoPath} supabaseUrl={supabaseUrl} onChange={(photoPath) => onChange(patch(sectionRef.current, { photoPath }))} />
      <TextField id="sec-about-title" label={t("title")} value={section.title} max={60} error={issues.title} placeholder={t("about.titlePlaceholder")} onChange={(v) => onChange(patch(section, { title: v }))} />
      <TextAreaField id="sec-about-body" label={t("about.text")} value={section.body} max={2000} rows={8} error={issues.body} hint={t("about.textHint")} onChange={(v) => onChange(patch(section, { body: v }))} />
    </>
  );
}
