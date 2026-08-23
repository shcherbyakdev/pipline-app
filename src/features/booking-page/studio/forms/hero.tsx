"use client";
import * as React from "react";
import { SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function HeroForm({ section, issues, supabaseUrl, onChange }: FormProps<"hero">) {
  // Uploads span several renders; read the latest section through a ref so
  // an edit made mid-upload is never reverted (react-hooks/refs forbids
  // writing a ref during render, hence the effect).
  const sectionRef = React.useRef(section);
  React.useEffect(() => {
    sectionRef.current = section;
  }, [section]);
  return (
    <>
      <ImageField id="sec-hero-image" label="Cover image" path={section.imagePath} supabaseUrl={supabaseUrl} onChange={(imagePath) => onChange(patch(sectionRef.current, { imagePath }))} />
      <TextField id="sec-hero-headline" label="Headline" value={section.headline} max={80} error={issues.headline} placeholder="Hair & colour by Anna" onChange={(v) => onChange(patch(section, { headline: v }))} />
      <TextField id="sec-hero-sub" label="Subheadline" value={section.subheadline} max={160} error={issues.subheadline} onChange={(v) => onChange(patch(section, { subheadline: v }))} />
      <SelectField id="sec-hero-align" label="Alignment" value={section.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centered" }]} onChange={(align) => onChange(patch(section, { align }))} />
    </>
  );
}
