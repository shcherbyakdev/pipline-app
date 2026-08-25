"use client";
import Link from "next/link";
import type { PublicOffering } from "@/lib/booking/public";
import { PREVIEW_OFFERING_ID } from "@/lib/booking/preview-catalog";
import { CheckboxField, FieldError, SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

/* Spaces: presentation toggles plus one photo per offering. The offerings
   are the org's real catalogue (read-only here — "Manage spaces" edits them);
   the canned preview stand-in is never offered a photo row, its id isn't a
   uuid and the schema would refuse it. */
export function SpacesForm({ section, issues, supabaseUrl, offerings, onChange }: FormProps<"spaces"> & { offerings: PublicOffering[] }) {
  const real = offerings.filter((o) => o.id !== PREVIEW_OFFERING_ID);
  const photoFor = (id: string) => section.photos.find((p) => p.offeringId === id)?.path;
  const setPhoto = (offeringId: string, path: string | undefined) => {
    // Rebuilt from the live catalogue on every edit: a photo for a space
    // that no longer exists is dropped here rather than failing anywhere.
    const kept = section.photos.filter((p) => p.offeringId !== offeringId && real.some((o) => o.id === p.offeringId));
    onChange(patch(section, { photos: path ? [...kept, { offeringId, path }] : kept }));
  };
  return (
    <>
      <TextField id="sec-spaces-title" label="Title" value={section.title} max={60} error={issues.title} onChange={(v) => onChange(patch(section, { title: v }))} />
      <SelectField id="sec-spaces-style" label="Style" value={section.style} options={[{ value: "list", label: "List" }, { value: "cards", label: "Cards" }]} onChange={(style) => onChange(patch(section, { style }))} />
      <CheckboxField id="sec-spaces-prices" label="Show prices" checked={section.showPrices} onChange={(showPrices) => onChange(patch(section, { showPrices }))} />
      <CheckboxField id="sec-spaces-stay" label="Show stay / duration" checked={section.showStay} onChange={(showStay) => onChange(patch(section, { showStay }))} />
      {real.length === 0 ? (
        <p className="text-muted-foreground px-4 py-3 text-sm">
          Add a space first — <Link href="/rentals" className="underline underline-offset-3">Manage spaces</Link>.
        </p>
      ) : (
        real.map((o) => (
          <ImageField key={o.id} id={`sec-spaces-photo-${o.id}`} label={o.name} path={photoFor(o.id)} supabaseUrl={supabaseUrl} onChange={(p) => setPhoto(o.id, p)} shape="wide" />
        ))
      )}
      <FieldError message={issues.photos} />
    </>
  );
}
