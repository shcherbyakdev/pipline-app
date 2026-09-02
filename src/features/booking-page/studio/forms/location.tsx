"use client";
import { useTranslations } from "next-intl";
import { TextAreaField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function LocationForm({ section, issues, onChange }: FormProps<"location">) {
  const t = useTranslations("studio.forms.location");
  return (
    <>
      <TextAreaField id="sec-location-address" label={t("address")} value={section.address} max={300} rows={3} error={issues.address} placeholder={t("addressPlaceholder")} onChange={(v) => onChange(patch(section, { address: v }))} />
      <TextField id="sec-location-maps" label={t("maps")} value={section.mapsUrl} max={500} error={issues.mapsUrl} placeholder="https://maps.app.goo.gl/…" hint={t("mapsHint")} onChange={(v) => onChange(patch(section, { mapsUrl: v }))} />
    </>
  );
}
