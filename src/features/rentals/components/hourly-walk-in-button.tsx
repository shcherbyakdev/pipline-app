"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { NewRentalBookingDialog, type OfferingOption } from "./new-rental-booking-dialog";

// The week-calendar's own entry point into the walk-in dialog (Task 10 Step
// 4): the timeline mounts NewRentalBookingDialog straight off a clicked
// empty cell, but the week calendar has no equivalent surface for an hourly
// offering, so this is a plain trigger button. Conditional mount, not a
// persistently-rendered-but-closed Dialog (timeline.tsx's own idiom): each
// open gets fresh state, and a walk-in created through the dialog's own
// `router.refresh()` doesn't leave a stale picker behind for the next one.
export function HourlyWalkInButton({
  offerings,
  timeZone,
}: {
  offerings: OfferingOption[];
  timeZone: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New rental booking
      </Button>
      {open ? (
        <NewRentalBookingDialog
          open
          onOpenChange={setOpen}
          offerings={offerings}
          timeZone={timeZone}
          defaultMode="hours"
        />
      ) : null}
    </>
  );
}
