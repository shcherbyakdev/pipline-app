"use client";

import * as React from "react";
import { toast } from "sonner";
import { updateSchedulingSettings } from "@/features/scheduling/actions";
import type { getSchedulingSettings } from "@/features/orgs/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SchedulingSettings = NonNullable<Awaited<ReturnType<typeof getSchedulingSettings>>>;

const TIMEZONES = Intl.supportedValuesOf("timeZone");

export function SchedulingSettingsForm({ settings }: { settings: SchedulingSettings }) {
  const [handle, setHandle] = React.useState(settings.handle ?? "");
  const [timezone, setTimezone] = React.useState(
    settings.handle === null
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : settings.timezone,
  );
  const [savedHandle, setSavedHandle] = React.useState(settings.handle);
  const [pending, startTransition] = React.useTransition();
  // Lazy initializer (not an effect): runs once per mount, and on the
  // client's hydration-mount pass `window` is already available. The
  // resulting mismatch vs. the server-rendered ("") value only affects a
  // controlled <Input value> prop, which React's hydration intentionally
  // does not diff (autofill-safety special case) — no warning, no effect.
  const [origin] = React.useState(() =>
    typeof window !== "undefined" ? window.location.origin : "",
  );

  const save = () => {
    startTransition(async () => {
      const result = await updateSchedulingSettings({ handle, timezone });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Booking page settings saved");
        setSavedHandle(handle);
      }
    });
  };

  const copyLink = () => {
    if (!savedHandle) return;
    const url = `${window.location.origin}/book/${savedHandle}`;
    navigator.clipboard.writeText(url);
    toast.success("Copied");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="scheduling-handle">Booking page handle</Label>
        <Input
          id="scheduling-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          disabled={pending}
          className="max-w-72"
        />
        <p className="text-muted-foreground text-xs">
          Lowercase letters, digits and hyphens, 3–50 characters.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="scheduling-timezone">Timezone</Label>
        <select
          id="scheduling-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-8 max-w-72 rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Button onClick={save} disabled={pending}>
          Save
        </Button>
      </div>
      {savedHandle ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-medium">Public booking page</p>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={`${origin}/book/${savedHandle}`}
              className="max-w-96 font-mono text-xs"
            />
            <Button variant="ghost" size="sm" onClick={copyLink}>
              Copy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
