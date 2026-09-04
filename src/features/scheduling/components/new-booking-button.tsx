"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import type { Initial } from "@/features/scheduling/booking-kinds";
import { Button } from "@/components/ui/button";
import { NewBookingDialog } from "./new-booking-dialog";

/* The Bookings toolbar's primary action — the same on every view. Conditional
   mount (timeline.tsx idiom): each open gets a fresh dialog, and a walk-in
   created through the dialog's own router.refresh() leaves no stale picker
   behind for the next one. The page renders this only when there is at
   least one service or space to book (canCreateWalkIn). `initial` is the
   week's scope speaking: on a space's week the dialog starts on that space. */
export function NewBookingButton({
  services, spaces, staff, defaultStaffId, timeZone, initial,
}: {
  services: ServiceRow[];
  spaces: OfferingOption[];
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
  initial?: Initial;
}) {
  const t = useTranslations("bookings");
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> {t("new.title")}
      </Button>
      {open ? (
        <NewBookingDialog
          open
          onOpenChange={setOpen}
          services={services}
          spaces={spaces}
          staff={staff}
          defaultStaffId={defaultStaffId}
          timeZone={timeZone}
          initial={initial}
        />
      ) : null}
    </>
  );
}
