"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { NewRentalBookingDialog, type OfferingOption } from "./new-rental-booking-dialog";

// The week-calendar's own entry point into the walk-in dialog: the timeline
// mounts NewRentalBookingDialog straight off a clicked empty cell, but the
// week calendar has no equivalent surface, so this is a plain trigger
// button. It lists every active offering (walkInOfferings) — the dialog
// branches per offering into the nights/days range picker or the hourly
// time grid, so a mixed org's nightly rentals are bookable from here too,
// not only via the timeline. Conditional mount, not a
// persistently-rendered-but-closed Dialog (timeline.tsx's own idiom): each
// open gets fresh state, and a walk-in created through the dialog's own
// `router.refresh()` doesn't leave a stale picker behind for the next one.
export function RentalWalkInButton({
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
        <NewRentalBookingDialog open onOpenChange={setOpen} offerings={offerings} timeZone={timeZone} />
      ) : null}
    </>
  );
}
