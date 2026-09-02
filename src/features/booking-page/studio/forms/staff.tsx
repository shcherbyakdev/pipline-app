"use client";
import { useTranslations } from "next-intl";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function StaffForm({ section, issues, onChange }: FormProps<"staff">) {
  const t = useTranslations("studio.forms");
  return (
    <TextField id="sec-staff-title" label={t("title")} value={section.title} max={60} error={issues.title} hint={t("staff.hint")} onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
