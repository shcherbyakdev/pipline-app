"use client";
import { TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function StaffForm({ section, issues, onChange }: FormProps<"staff">) {
  return (
    <TextField id="sec-staff-title" label="Title" value={section.title} max={60} error={issues.title} hint="Shows once two or more team members are bookable; clicking a person opens their own booking link." onChange={(v) => onChange(patch(section, { title: v }))} />
  );
}
