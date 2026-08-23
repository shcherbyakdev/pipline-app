"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function BookingForm({ section, issues, onChange }: FormProps<"booking">) {
  return (
    <TextField id="sec-booking-title" label="Title" value={section.title} max={60} error={issues.title} placeholder="Book a time" hint="The widget itself is styled on the Settings tab and on Website embed." onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
