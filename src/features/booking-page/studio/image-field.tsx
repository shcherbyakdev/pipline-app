"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/settings-row";
import { GENERIC_WRITE_ERROR } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { uploadPageImage } from "../actions";
import { PAGE_IMAGE_ACCEPT, PAGE_IMAGE_MAX_BYTES, isAllowedPageImageType, pageImageUrl } from "../images";
import { FieldError } from "./fields";

export const IMAGE_HINT = "PNG, JPEG or WebP · max 4 MB · best under 2000 px wide.";

/** Client-side pre-check before any bytes move (branding-form precedent); the server re-validates the buffered bytes. */
export function preCheckImage(file: File): string | null {
  if (!isAllowedPageImageType(file.type)) return "PNG, JPEG or WebP only.";
  if (file.size > PAGE_IMAGE_MAX_BYTES) return "Images must be 4 MB or less.";
  return null;
}

/* Single-image control (cover, photo): thumbnail + Upload/Replace + Remove. */
export function ImageField({
  id, label, path, supabaseUrl, onChange, shape = "wide",
}: {
  id: string; label: string; path: string | undefined; supabaseUrl: string;
  onChange: (path: string | undefined) => void; shape?: "wide" | "square";
}) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const problem = preCheckImage(file);
    if (problem) {
      setError(problem);
      e.target.value = "";
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      try {
        const result = await uploadPageImage(formData);
        if (!result.ok) setError(result.error);
        else onChange(result.path);
      } catch (error) {
        console.error("[booking-page] image upload threw:", error);
        setError(GENERIC_WRITE_ERROR);
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  return (
    <SettingsRow label={label} htmlFor={id} hint={IMAGE_HINT}>
      <div className="flex items-center gap-2">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pageImageUrl(supabaseUrl, path)} alt="" className={cn("bg-background rounded border object-cover", shape === "square" ? "size-12" : "h-12 w-20")} />
        ) : null}
        <input ref={fileRef} id={id} type="file" accept={PAGE_IMAGE_ACCEPT} onChange={onFile} disabled={pending} className="sr-only" />
        <Button variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
          <HugeiconsIcon icon={Upload04Icon} size={14} />
          {pending ? "Uploading…" : path ? "Replace" : "Upload"}
        </Button>
        {path ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onChange(undefined)}>Remove</Button>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </SettingsRow>
  );
}
