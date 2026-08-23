"use client";
import { SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function HeroForm({ section, issues, supabaseUrl, onChange }: FormProps<"hero">) {
  return (
    <>
      <ImageField id="sec-hero-image" label="Cover image" path={section.imagePath} supabaseUrl={supabaseUrl} onChange={(imagePath) => onChange(patch(section, { imagePath }))} />
      <TextField id="sec-hero-headline" label="Headline" value={section.headline} max={80} error={issues.headline} placeholder="Hair & colour by Anna" onChange={(v) => onChange(patch(section, { headline: v }))} />
      <TextField id="sec-hero-sub" label="Subheadline" value={section.subheadline} max={160} error={issues.subheadline} onChange={(v) => onChange(patch(section, { subheadline: v }))} />
      <SelectField id="sec-hero-align" label="Alignment" value={section.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centered" }]} onChange={(align) => onChange(patch(section, { align }))} />
    </>
  );
}
