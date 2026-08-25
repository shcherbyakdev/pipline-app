"use client";

import * as React from "react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { SPACES } from "@/features/orgs/vocab";
import {
  defaultSelection, parseSelection, pickerLabel, selectionValue, type Initial, type KindSelection,
} from "@/features/scheduling/booking-kinds";
import { AppointmentBookingForm } from "./appointment-booking-form";
import { SpaceBookingForm } from "@/features/rentals/components/space-booking-form";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

/* The one walk-in entry (admin IA spec §2, ruling 5): the first field picks
   a service or a space; the matching form mounts below it KEYED BY THE
   PICKED ID, so nothing — dates, unit, client fields — survives a switch
   (H5a lesson). Callers mount this per opening (conditional mount, the
   timeline idiom) so every open starts clean. */
export function NewBookingDialog({
  open, onOpenChange, services, spaces, staff, defaultStaffId, timeZone, initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceRow[];      // active
  spaces: OfferingOption[];    // active, any range mode
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
  initial?: Initial;
}) {
  const [selected, setSelected] = React.useState<KindSelection | null>(() =>
    defaultSelection(services, spaces, initial),
  );
  const label = pickerLabel(services.length > 0, spaces.length > 0);
  const close = () => onOpenChange(false);
  const space = selected?.kind === "space" ? (spaces.find((o) => o.id === selected.id) ?? null) : null;
  const spacePrefill = initial?.kind === "space" && space && initial.offeringId === space.id ? initial : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", selected?.kind === "space" && "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            Recorded on your behalf — notice and booking-window limits don’t apply.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nb-what">{label}</Label>
          <select
            id="nb-what"
            className={selectClass}
            value={selected ? selectionValue(selected) : ""}
            onChange={(e) => setSelected(parseSelection(e.target.value))}
          >
            {services.length > 0 ? (
              <optgroup label="Services">
                {services.map((s) => (
                  <option key={s.id} value={selectionValue({ kind: "service", id: s.id })}>
                    {s.name} ({s.durationMin} min)
                  </option>
                ))}
              </optgroup>
            ) : null}
            {spaces.length > 0 ? (
              <optgroup label={SPACES.nav}>
                {spaces.map((o) => (
                  <option key={o.id} value={selectionValue({ kind: "space", id: o.id })}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        {selected?.kind === "service" ? (
          <AppointmentBookingForm
            key={selected.id}
            serviceId={selected.id}
            services={services}
            staff={staff}
            defaultStaffId={defaultStaffId}
            timeZone={timeZone}
            drag={initial?.kind === "service" ? initial : null}
            onDone={close}
          />
        ) : space ? (
          <SpaceBookingForm
            key={space.id}
            offering={space}
            timeZone={timeZone}
            initialUnitId={spacePrefill?.unitId ?? null}
            initialStartDate={spacePrefill?.date}
            onDone={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
