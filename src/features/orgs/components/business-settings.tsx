"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { updateOrgModes } from "@/features/orgs/actions";
import type { OrgMode } from "@/features/orgs/mode";

const ROWS = [
  { key: "offersAppointments", label: "Appointments", blurb: "Services booked as time slots on your calendar." },
  { key: "offersRentals", label: "Rentals", blurb: "Units booked by the night or day." },
] as const;

/* Org-level "what you offer" (Settings → Business). Optimistic: the box flips
   immediately and rolls back on a failed save. The last enabled channel is
   locked — the RPC enforces the same rule as a defence. */
export function BusinessSettings({ mode }: { mode: OrgMode }) {
  const router = useRouter();
  const [value, setValue] = React.useState<OrgMode>(mode);
  const [pending, startTransition] = React.useTransition();
  const enabledCount = Number(value.offersAppointments) + Number(value.offersRentals);

  const toggle = (key: keyof OrgMode, next: boolean) => {
    const prev = value;
    const draft = { ...value, [key]: next };
    setValue(draft);
    startTransition(async () => {
      const result = await updateOrgModes(draft);
      if (!result.ok) {
        setValue(prev);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  };

  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <div className="text-sm font-medium">What you offer</div>
        <p className="text-muted-foreground text-sm">
          Turning one off hides it from your booking page and this admin. Existing bookings stay.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {ROWS.map((row) => {
          const checked = value[row.key];
          const locked = checked && enabledCount === 1;
          const id = `business-${row.key}`;
          return (
            <div key={row.key} className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={checked}
                disabled={pending || locked}
                onCheckedChange={(c) => toggle(row.key, c === true)}
                className="mt-0.5"
              />
              <div className="flex flex-col">
                <Label htmlFor={id}>{row.label}</Label>
                <span className="text-muted-foreground text-sm">
                  {locked ? "Keep at least one booking type on." : row.blurb}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
