"use client";

import * as React from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { updateSchedulingSettings } from "@/features/scheduling/actions";
import type { getSchedulingSettings } from "@/features/orgs/queries";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { SettingsCard, SettingsRow } from "@/components/settings-row";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

const TIMEZONES = Intl.supportedValuesOf("timeZone");

/* Booking page address + timezone. One card, explicit Save (the handle is
   validated server-side and can collide), Save only lights up when dirty.
   The public URL is the field itself — host prefix + handle — with a copy
   button once a handle is saved, instead of a separate read-only block. */
export function SchedulingSettingsForm({
  settings,
  appUrl,
  onHandleInput,
}: {
  settings: SchedulingSettings;
  appUrl: string;
  // Typed (unsaved) handle, so a page-level preview can show the URL live.
  onHandleInput?: (handle: string) => void;
}) {
  const [handle, setHandle] = React.useState(settings.handle ?? "");
  const [timezone, setTimezone] = React.useState(
    settings.handle === null ? Intl.DateTimeFormat().resolvedOptions().timeZone : settings.timezone,
  );
  const [saved, setSaved] = React.useState({ handle: settings.handle ?? "", timezone: settings.timezone });
  const [pending, startTransition] = React.useTransition();
  const [copied, setCopied] = React.useState(false);

  const dirty = handle !== saved.handle || timezone !== saved.timezone;
  const host = hostLabel(appUrl);

  const save = () => {
    startTransition(async () => {
      const result = await updateSchedulingSettings({ handle, timezone });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Booking page saved");
        setSaved({ handle, timezone });
      }
    });
  };

  const copyLink = () => {
    if (!saved.handle) return;
    navigator.clipboard.writeText(bookingUrl(appUrl, saved.handle));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <SettingsCard
      title="Address & timezone"
      footer={
        <>
          {dirty ? <span className="text-muted-foreground mr-auto text-xs">Unsaved changes</span> : null}
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <SettingsRow
        label="Booking page address"
        htmlFor="scheduling-handle"
        hint="Lowercase letters, digits and hyphens, 3–50 characters. Empty unpublishes the page."
      >
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText className="font-mono text-xs">{host}/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="scheduling-handle"
            value={handle}
            onChange={(e) => {
              setHandle(e.target.value);
              onHandleInput?.(e.target.value);
            }}
            disabled={pending}
            placeholder="your-handle"
            className="font-mono text-xs"
          />
          {saved.handle && handle === saved.handle ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label="Copy booking page link" title="Copy link" onClick={copyLink}>
                <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </SettingsRow>
      <SettingsRow label="Timezone" htmlFor="scheduling-timezone" hint="Your availability is set in this timezone.">
        <select
          id="scheduling-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={pending}
          className="border-input h-8 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </SettingsRow>
    </SettingsCard>
  );
}
