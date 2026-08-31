"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Switch } from "@base-ui/react/switch";
import { setStaffActive } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { ServiceRow } from "@/features/scheduling/queries";
import { bookingPath } from "@/lib/booking/url";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StaffDialog } from "./staff-dialog";

function serviceLabel(count: number): string {
  if (count === 0) return "No services";
  return count === 1 ? "1 service" : `${count} services`;
}

function Row({
  staff,
  services,
  usedColors,
  handle,
  appUrl,
  isPublic,
}: {
  staff: StaffRow;
  services: ServiceRow[];
  usedColors: string[];
  handle: string | null;
  appUrl: string;
  /** On the plan's public roster (Team page passed the real one)? A person
      beyond the cap has a 404ing URL, so their link isn't offered either. */
  isPublic: boolean;
}) {
  const [, startTransition] = React.useTransition();
  // The switch moves the moment it's clicked and snaps back on its own if the
  // action fails (a deactivation blocked by the offboarding guard).
  const [active, setActive] = React.useOptimistic(staff.active);

  // A deactivated person's booking URL 404s, so their link isn't offered —
  // same for a person the plan keeps off the public roster.
  const path = handle && staff.active && isPublic ? bookingPath(handle, staff.slug) : null;
  const overPlanLimit = staff.active && !isPublic;

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setStaffActive({ id: staff.id, active: next });
      if (!result.ok) toast.error(result.error);
    });
  };

  // Awaited: the clipboard write can be refused (permissions, insecure
  // context, no focus) and "Copied" must not claim otherwise
  // (portal-links-panel.tsx precedent).
  const copyLink = async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(`${appUrl}${path}`);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the link text and copy manually.");
    }
  };

  return (
    <li className="bg-card flex flex-col gap-2 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          style={{ background: staff.color }}
          className="size-2.5 shrink-0 rounded-full"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{staff.name}</span>
            {!staff.active ? <Badge variant="outline">Inactive</Badge> : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {serviceLabel(staff.serviceIds.length)}
            {path ? <span className="font-mono"> · {path}</span> : null}
            {overPlanLimit ? " · Not on your public page — over your plan's limit" : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {path ? (
          <>
            <Button variant="ghost" size="xs" onClick={copyLink}>
              Copy link
            </Button>
            {/*
              A plain styled Link, not <Button render={<Link .../>}>: base-ui's
              Button enforces button semantics on whatever it renders, and its
              own docs say links should not go through that render prop
              (rentals/components/offerings-list.tsx makes the same call).
            */}
            <Link
              href={`/embed?staff=${staff.slug}`}
              className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}
            >
              Embed…
            </Link>
          </>
        ) : null}
        <StaffDialog
          staff={staff}
          services={services}
          usedColors={usedColors}
          handle={handle}
        />
        <Switch.Root
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`${staff.name} is bookable`}
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-input bg-muted transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50"
        >
          <Switch.Thumb className="size-3.5 translate-x-0.5 rounded-full bg-background shadow-sm transition-[translate] data-checked:translate-x-[18px]" />
        </Switch.Root>
      </div>
    </li>
  );
}

export function StaffList({
  staff,
  services,
  handle,
  appUrl,
  publicStaffIds,
}: {
  staff: StaffRow[];
  services: ServiceRow[];
  handle: string | null;
  appUrl: string;
  /** The plan's public roster ids; null = no cap applies, flag nobody. */
  publicStaffIds: string[] | null;
}) {
  const usedColors = staff.map((s) => s.color);
  return (
    <div className="flex flex-col gap-3">
      {handle ? null : (
        <p className="text-muted-foreground text-sm">
          Set your booking page handle first on{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Booking page
          </Link>{" "}
          — then everyone gets their own link.
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {staff.map((person) => (
          <Row
            key={person.id}
            staff={person}
            services={services}
            usedColors={usedColors}
            handle={handle}
            appUrl={appUrl}
            isPublic={publicStaffIds === null || publicStaffIds.includes(person.id)}
          />
        ))}
      </ol>
    </div>
  );
}
