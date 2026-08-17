"use client";

import * as React from "react";
import { toast } from "sonner";
import { updateAccent, uploadLogo, removeLogo } from "@/features/orgs/actions";
import type { BrandingSettings } from "@/features/orgs/queries";
import { LOGO_MAX_BYTES, isAllowedLogoType } from "@/lib/storage/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandingForm({
  settings,
  onPreviewAccent,
}: {
  settings: BrandingSettings;
  // Fires with the accent the preview should show while typing: the typed
  // value once it is a valid hex, else the saved one. Lets the page-level
  // preview (Booking page studio) track the unsaved colour live.
  onPreviewAccent?: (hex: string | null) => void;
}) {
  const [accent, setAccent] = React.useState(settings.accentColor ?? "");
  const [pending, startTransition] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const saveAccent = () => {
    const value = accent.trim();
    if (value !== "" && !HEX_RE.test(value)) {
      toast.error("Accent must be a #rrggbb hex colour.");
      return;
    }
    startTransition(async () => {
      const result = await updateAccent({ accentColor: value === "" ? null : value });
      if (!result.ok) toast.error(result.error);
      else toast.success("Accent saved");
    });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Pre-check before any bytes move (participant-flow precedent); the
    // server re-validates against the buffered bytes.
    if (!isAllowedLogoType(file.type)) {
      toast.error("PNG, JPEG or WebP only.");
      e.target.value = "";
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be 1 MB or less.");
      e.target.value = "";
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadLogo(formData);
      if (!result.ok) toast.error(result.error);
      else toast.success("Logo updated");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const remove = () =>
    startTransition(async () => {
      const result = await removeLogo();
      if (!result.ok) toast.error(result.error);
      else toast.success("Logo removed");
    });

  const previewAccent = HEX_RE.test(accent.trim()) ? accent.trim().toLowerCase() : settings.accentColor;
  const onAccentInput = (value: string) => {
    setAccent(value);
    onPreviewAccent?.(HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : settings.accentColor);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-logo">Logo</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={fileRef}
            id="branding-logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            disabled={pending}
            className="max-w-72"
          />
          {settings.logoUrl ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">PNG, JPEG or WebP · max 1 MB.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-accent">Accent colour</Label>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-6 shrink-0 rounded border"
            style={previewAccent ? { backgroundColor: previewAccent } : undefined}
          />
          <Input
            id="branding-accent"
            value={accent}
            onChange={(e) => onAccentInput(e.target.value)}
            onBlur={saveAccent}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="#0f766e"
            maxLength={7}
            disabled={pending}
            className="max-w-32 font-mono"
          />
        </div>
      </div>
    </div>
  );
}
