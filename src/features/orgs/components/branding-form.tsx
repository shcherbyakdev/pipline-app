"use client";

import * as React from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { updateAccent, uploadLogo, removeLogo } from "@/features/orgs/actions";
import type { BrandingSettings } from "@/features/orgs/queries";
import { LOGO_MAX_BYTES, isAllowedLogoType } from "@/lib/storage/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsRow } from "@/components/settings-row";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/* Logo + accent rows (auto-save: logo on pick, accent on blur/Enter or on
   picking from the swatch). Rendered inside a SettingsCard by the caller so
   it can sit alongside other look-and-feel rows. */
export function BrandingForm({
  settings,
  onPreviewAccent,
}: {
  settings: BrandingSettings;
  // Fires with the accent the preview should show while typing: the typed
  // value once it is a valid hex, else the saved one. Lets the page-level
  // preview track the unsaved colour live.
  onPreviewAccent?: (hex: string | null) => void;
}) {
  const [accent, setAccent] = React.useState(settings.accentColor ?? "");
  const [pending, startTransition] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const persistAccent = (raw: string) => {
    const value = raw.trim();
    if (value !== "" && !HEX_RE.test(value)) {
      toast.error("Accent must be a #rrggbb hex colour.");
      return;
    }
    if ((value === "" ? null : value.toLowerCase()) === settings.accentColor) return;
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
    <>
      <SettingsRow label="Logo" hint="PNG, JPEG or WebP · max 1 MB.">
        <div className="flex items-center gap-2">
          {settings.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logoUrl}
              alt="Current logo"
              className="bg-background h-8 w-auto max-w-28 rounded border object-contain px-1"
            />
          ) : null}
          <input
            ref={fileRef}
            id="branding-logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            disabled={pending}
            className="sr-only"
          />
          <Button variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
            <HugeiconsIcon icon={Upload04Icon} size={14} />
            {settings.logoUrl ? "Replace" : "Upload"}
          </Button>
          {settings.logoUrl ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow label="Accent colour" htmlFor="branding-accent" hint="Used on the booking page and in the website embed.">
        <div className="flex items-center gap-2">
          {/* Native picker as the swatch: click to pick, or type a hex. */}
          <input
            type="color"
            aria-label="Pick accent colour"
            value={previewAccent ?? "#0f766e"}
            disabled={pending}
            onChange={(e) => onAccentInput(e.target.value)}
            onBlur={(e) => persistAccent(e.target.value)}
            className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Input
            id="branding-accent"
            value={accent}
            onChange={(e) => onAccentInput(e.target.value)}
            onBlur={(e) => persistAccent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="#0f766e"
            maxLength={7}
            disabled={pending}
            className="max-w-32 font-mono"
          />
        </div>
      </SettingsRow>
    </>
  );
}
