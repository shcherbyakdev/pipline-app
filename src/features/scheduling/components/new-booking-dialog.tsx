"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { SPACES } from "@/features/orgs/vocab";
import {
  defaultSelection,
  parseSelection,
  pickerLabel,
  selectionValue,
  type Initial,
  type KindSelection,
} from "@/features/scheduling/booking-kinds";
import { AppointmentBookingForm } from "./appointment-booking-form";
import { SpaceBookingForm } from "@/features/rentals/components/space-booking-form";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogContent,
  DialogDescription,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* The one walk-in entry (admin IA spec §2, ruling 5): the header pill picks
   a service or a space (the Linear-style context chip); the matching form
   mounts below it KEYED BY THE PICKED ID, so nothing — dates, unit, client
   fields — survives a switch (H5a lesson). Callers mount this per opening
   (conditional mount, the timeline idiom) so every open starts clean. */
export function NewBookingDialog({
  open,
  onOpenChange,
  services,
  spaces,
  staff,
  defaultStaffId,
  timeZone,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceRow[]; // active
  spaces: OfferingOption[]; // active, any range mode
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
  const space =
    selected?.kind === "space"
      ? (spaces.find((o) => o.id === selected.id) ?? null)
      : null;
  const spacePrefill =
    initial?.kind === "space" && space && initial.offeringId === space.id
      ? initial
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          dialogPanelClass,
          selected?.kind === "space" ? "sm:max-w-2xl" : "sm:max-w-xl",
        )}
      >
        <DialogBreadcrumbHeader
          chip={
            <span className="relative inline-flex">
              <select
                aria-label={label}
                className={cn(
                  // Kind colour where it names a kind of booking (palette rule):
                  // periwinkle for a service, green for a space.
                  selected?.kind === "space"
                    ? "bg-kind-space-soft text-kind-space-text"
                    : "bg-kind-time-soft text-kind-time-text",
                  "focus-visible:ring-ring/30 h-6 max-w-48 appearance-none truncate rounded-full pr-6 pl-2.5 text-xs font-medium outline-none focus-visible:ring-3",
                )}
                value={selected ? selectionValue(selected) : ""}
                onChange={(e) => setSelected(parseSelection(e.target.value))}
              >
                {spaces.length > 0 ? (
                  <optgroup label={SPACES.nav}>
                    {spaces.map((o) => (
                      <option
                        key={o.id}
                        value={selectionValue({ kind: "space", id: o.id })}
                      >
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {services.length > 0 ? (
                  <optgroup label="Services">
                    {services.map((s) => (
                      <option
                        key={s.id}
                        value={selectionValue({ kind: "service", id: s.id })}
                      >
                        {s.name} ({s.durationMin} min)
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  selected?.kind === "space"
                    ? "text-kind-space-text"
                    : "text-kind-time-text",
                  "pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2",
                )}
              />
            </span>
          }
        >
          New booking
        </DialogBreadcrumbHeader>
        <DialogDescription className="px-5 pt-2 text-xs">
          Recorded on your behalf — notice and booking-window limits don’t
          apply.
        </DialogDescription>
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
          <div className="flex flex-col p-5 pt-4">
            <SpaceBookingForm
              key={space.id}
              offering={space}
              timeZone={timeZone}
              initialUnitId={spacePrefill?.unitId ?? null}
              initialStartDate={spacePrefill?.date}
              onDone={close}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
