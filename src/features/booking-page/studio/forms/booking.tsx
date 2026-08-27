"use client";
import { Button } from "@/components/ui/button";
import type { OrgMode } from "@/features/orgs/mode";
import { bookingChannel, type BookingChannel, type SectionOf } from "../../schema";
import { SelectField, TextField } from "../fields";
import { patch, type FormProps } from "./types";

const SHOW_OPTIONS: ReadonlyArray<{ value: BookingChannel; label: string }> = [
  { value: "all", label: "Appointments & spaces" },
  { value: "appointments", label: "Appointments only" },
  { value: "spaces", label: "Spaces only" },
];

/** "all" is stored as no `channel` at all — the shape every page had before
    the split, so an untouched widget stays byte-equal to its published one. */
function withChannel(section: SectionOf<"booking">, channel: BookingChannel): SectionOf<"booking"> {
  if (channel !== "all") return patch(section, { channel });
  const next = { ...section };
  delete next.channel;
  return next;
}

export function BookingForm({
  section, issues, onChange, mode, single, onSplit,
}: FormProps<"booking"> & { mode: OrgMode; single: boolean; onSplit: () => void }) {
  const both = mode.offersAppointments && mode.offersRentals;
  const channel = bookingChannel(section);
  return (
    <>
      <TextField id="sec-booking-title" label="Title" value={section.title} max={60} error={issues.title} placeholder="Book a time" hint="The widget itself is styled on the Settings tab and on Website embed." onChange={(v) => onChange(patch(section, { title: v }))} />
      {both && single ? (
        <>
          <SelectField
            id="sec-booking-channel"
            label="Show"
            value={channel}
            options={SHOW_OPTIONS}
            hint="What this widget books. A channel left out can't be booked on this page."
            onChange={(v) => onChange(withChannel(section, v))}
          />
          {channel === "all" ? (
            // A SettingsCard row of its own (px-4 py-3, like SettingsRow).
            <div className="flex flex-col gap-1.5 px-4 py-3">
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onSplit}>
                Split into two sections
              </Button>
              <p className="text-muted-foreground text-xs">
                One widget for appointments, one for spaces — hide, move or remove each on its own.
              </p>
            </div>
          ) : null}
        </>
      ) : both ? (
        <p className="text-muted-foreground px-4 py-3 text-xs">
          This widget books {channel === "spaces" ? "spaces" : "appointments"}; the other channel has its own section.
        </p>
      ) : null}
    </>
  );
}
