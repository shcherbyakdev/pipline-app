"use client";
import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/components/settings-row";
import { uploadPageImage } from "../../actions";
import { PAGE_IMAGE_ACCEPT, pageImageUrl } from "../../images";
import { FieldError, ListEditor, SelectField } from "../fields";
import { IMAGE_HINT, preCheckImage } from "../image-field";
import { patch, type FormProps } from "./types";

const MAX_IMAGES = 12;

export function GalleryForm({ section, issues, supabaseUrl, onChange }: FormProps<"gallery">) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const room = MAX_IMAGES - section.images.length;
  // The upload loop spans several renders; read the latest section through a
  // ref so an edit made mid-upload (columns, a caption) is never reverted.
  // Synced in an effect, not during render — react-hooks/refs forbids
  // writing ref.current in the render body.
  const sectionRef = React.useRef(section);
  React.useEffect(() => {
    sectionRef.current = section;
  }, [section]);

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, room);
    if (files.length === 0) return;
    const problem = files.map(preCheckImage).find(Boolean);
    if (problem) {
      setError(problem);
      e.target.value = "";
      return;
    }
    setError(null);
    startTransition(async () => {
      // Sequential so the order in the gallery matches the pick order.
      for (const file of files) {
        const formData = new FormData();
        formData.set("file", file);
        const result = await uploadPageImage(formData);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        const latest = sectionRef.current;
        onChange(patch(latest, { images: [...latest.images, { path: result.path, alt: "" }] }));
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <>
      <SelectField id="sec-gallery-columns" label="Columns" value={String(section.columns) as "2" | "3"} options={[{ value: "2", label: "Two" }, { value: "3", label: "Three" }]} onChange={(v) => onChange(patch(section, { columns: v === "2" ? 2 : 3 }))} />
      <SettingsRow label="Photos" htmlFor="sec-gallery-files" hint={`${IMAGE_HINT} Up to ${MAX_IMAGES}.`}>
        <input ref={fileRef} id="sec-gallery-files" type="file" multiple accept={PAGE_IMAGE_ACCEPT} onChange={onFiles} disabled={pending || room === 0} className="sr-only" />
        <Button variant="outline" size="sm" disabled={pending || room === 0} onClick={() => fileRef.current?.click()}>
          <HugeiconsIcon icon={Upload04Icon} size={14} />
          {pending ? "Uploading…" : "Add photos"}
        </Button>
        <FieldError message={error ?? issues.images} />
      </SettingsRow>
      <ListEditor
        items={section.images}
        max={MAX_IMAGES}
        hideAdd
        addLabel="Add photo"
        blank={() => ({ path: "", alt: "" })}
        onChange={(images) => onChange(patch(section, { images }))}
        render={(img, set, i) => (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pageImageUrl(supabaseUrl, img.path)} alt="" className="bg-background size-12 shrink-0 rounded border object-cover" />
            <Input value={img.alt} maxLength={120} placeholder="Describe the photo (alt text)" aria-label={`Photo ${i + 1} description`} onChange={(e) => set({ ...img, alt: e.target.value })} />
          </div>
        )}
      />
    </>
  );
}
