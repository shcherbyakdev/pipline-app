"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
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
  DialogSelect,
  dialogFieldLabelClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* The one walk-in entry (admin IA spec §2, ruling 5). What is being booked
   is the FIRST field of the form, labelled and full width — it used to be a
   pill inside the header's breadcrumb, which read as decoration rather than
   as the choice the whole dialog hangs off (designer, 2026-09-04). The
   matching form mounts below it KEYED BY THE PICKED ID, so nothing — dates,
   unit, client fields — survives a switch (H5a lesson). Callers mount this
   per opening (conditional mount, the timeline idiom) so every open starts
   clean. */
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
  // Root translator: the picker's label is a key across namespaces
  // (booking-kinds.ts pickerLabel).
  const tRoot = useTranslations();
  const t = useTranslations("bookings");
  const tUnits = useTranslations("public.units");
  const [selected, setSelected] = React.useState<KindSelection | null>(() =>
    defaultSelection(services, spaces, initial),
  );
  const label = tRoot(pickerLabel(spaces.length > 0));
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
        <DialogBreadcrumbHeader>{t("new.title")}</DialogBreadcrumbHeader>
        <div className="px-5 pt-4">
          <label className="block">
            <span className={dialogFieldLabelClass}>{label}</span>
            <DialogSelect
              value={selected ? selectionValue(selected) : ""}
              onChange={(e) => setSelected(parseSelection(e.target.value))}
            >
              {spaces.length > 0 ? (
                <optgroup label={tRoot("spaces.nav")}>
                  {spaces.map((o) => (
                    <option key={o.id} value={selectionValue({ kind: "space", id: o.id })}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {services.length > 0 ? (
                <optgroup label={t("new.services")}>
                  {services.map((s) => {
                    const text = `${s.name} · ${tUnits("minutes", { count: s.durationMin })}`;
                    return (
                      <option key={s.id} value={selectionValue({ kind: "service", id: s.id })}>
                        {text}
                      </option>
                    );
                  })}
                </optgroup>
              ) : null}
            </DialogSelect>
          </label>
          <DialogDescription className="mt-2 flex items-start gap-1.5 text-xs">
            <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            {t("new.blurb")}
          </DialogDescription>
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
          <div className="flex flex-col p-5 pt-5">
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
