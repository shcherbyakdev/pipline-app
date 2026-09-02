"use client";
import { useTranslations } from "next-intl";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function BookingForm({ section, issues, onChange }: FormProps<"booking">) {
  const t = useTranslations("studio.forms");
  return (
    <TextField id="sec-booking-title" label={t("title")} value={section.title} max={60} error={issues.title} placeholder={t("booking.titlePlaceholder")} hint={t("booking.hint")} onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
