"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function HeaderForm({ section, issues, onChange }: FormProps<"header">) {
  return (
    <TextField id="sec-tagline" label="Tagline" value={section.tagline} max={120} error={issues.tagline} placeholder="Colour specialist in Kraków" hint="Shown under your name. Logo and accent are on the Settings tab." onChange={(v) => onChange(patch(section, { tagline: v }))} />
  );
}
