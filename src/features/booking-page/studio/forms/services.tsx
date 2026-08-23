"use client";
import { CheckboxField, SelectField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function ServicesForm({ section, issues, onChange }: FormProps<"services">) {
  return (
    <>
      <TextField id="sec-services-title" label="Title" value={section.title} max={60} error={issues.title} onChange={(v) => onChange(patch(section, { title: v }))} />
      <SelectField id="sec-services-style" label="Style" value={section.style} options={[{ value: "list", label: "List" }, { value: "cards", label: "Cards" }]} onChange={(style) => onChange(patch(section, { style }))} />
      <CheckboxField id="sec-services-prices" label="Show prices" checked={section.showPrices} onChange={(showPrices) => onChange(patch(section, { showPrices }))} />
      <CheckboxField id="sec-services-durations" label="Show durations" checked={section.showDurations} onChange={(showDurations) => onChange(patch(section, { showDurations }))} />
    </>
  );
}
