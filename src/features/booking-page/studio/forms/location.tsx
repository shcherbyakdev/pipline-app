"use client";
import { TextAreaField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

export function LocationForm({ section, issues, onChange }: FormProps<"location">) {
  return (
    <>
      <TextAreaField id="sec-location-address" label="Address" value={section.address} max={300} rows={3} error={issues.address} placeholder={"Main St 1\n00-001 Warsaw"} onChange={(v) => onChange(patch(section, { address: v }))} />
      <TextField id="sec-location-maps" label="Maps link" value={section.mapsUrl} max={500} error={issues.mapsUrl} placeholder="https://maps.app.goo.gl/…" hint="Shown as “Open in Maps”." onChange={(v) => onChange(patch(section, { mapsUrl: v }))} />
    </>
  );
}
