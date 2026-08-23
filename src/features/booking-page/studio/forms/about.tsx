"use client";
import { TextAreaField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

export function AboutForm({ section, issues, supabaseUrl, onChange }: FormProps<"about">) {
  return (
    <>
      <ImageField id="sec-about-photo" label="Photo" shape="square" path={section.photoPath} supabaseUrl={supabaseUrl} onChange={(photoPath) => onChange(patch(section, { photoPath }))} />
      <TextField id="sec-about-title" label="Title" value={section.title} max={60} error={issues.title} placeholder="About me" onChange={(v) => onChange(patch(section, { title: v }))} />
      <TextAreaField id="sec-about-body" label="Text" value={section.body} max={2000} rows={8} error={issues.body} hint="Blank line = new paragraph." onChange={(v) => onChange(patch(section, { body: v }))} />
    </>
  );
}
