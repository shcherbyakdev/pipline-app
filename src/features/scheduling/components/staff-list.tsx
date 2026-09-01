"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { Switch } from "@/components/ui/switch";
import { setStaffActive } from "@/features/scheduling/staff-actions";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { ServiceRow } from "@/features/scheduling/queries";
import { bookingPath } from "@/lib/booking/url";
import { initials } from "@/features/scheduling/staff-slug";
import { ownerHref } from "@/features/scheduling/availability-owner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StaffDialog } from "./staff-dialog";

function serviceLabel(count: number): string {
  if (count === 0) return "No services";
  return count === 1 ? "1 service" : `${count} services`;
}

/* Shared column template so the header row and every member row align:
   Name | Booking link | Role | actions. The fixed tracks (110px + 360px)
   only fit from lg: up — below that the row keeps the stacked layout, or
   the fr columns collapse to zero width and the headers pile up. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_360px] lg:items-center lg:gap-3";

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
      if (!result.ok) toastRefusal(result.error);
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

  // ponytail: staff have no logins yet (user_id reserved), so "role" is
  // derived — the creator's seeded row is always sort_order 0 and it is
  // never user-editable. Replace with a real role once invites land.
  const role =
    staff.sortOrder === 0 ? (
      <Badge variant="secondary">Owner</Badge>
    ) : (
      <span className="text-muted-foreground text-xs">Member</span>
    );

  return (
    <li
      role="row"
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-muted/50",
        gridCols
      )}
    >
      {/* Below lg the switch is pinned top-right next to the name (the
          absolute variant wins over the base `relative`), so the stacked
          row reads name → link → actions instead of leaving the switch
          alone on a wrapped line. */}
      <div role="cell" className="flex min-w-0 items-center gap-3 max-lg:pr-12">
        <span
          aria-hidden
          style={{ background: staff.color }}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white"
        >
          {initials(staff.name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium">{staff.name}</span>
            <span className="lg:hidden">{role}</span>
            {!staff.active ? <Badge variant="outline">Inactive</Badge> : null}
            {overPlanLimit ? (
              <Badge
                variant="destructive"
                title="Not on your public page — over your plan's limit"
              >
                Over plan limit
                <span className="sr-only">
                  : not shown on your public page because it is over your
                  plan&apos;s limit
                </span>
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {serviceLabel(staff.serviceIds.length)}
          </p>
        </div>
      </div>
      <p
        role="cell"
        className={cn(
          "text-muted-foreground truncate font-mono text-xs max-lg:pl-9",
          !path && "max-lg:hidden"
        )}
      >
        {path ?? "—"}
      </p>
      <span role="cell" className="max-lg:hidden">{role}</span>
      <div role="cell" className="flex items-center gap-2 max-lg:flex-wrap lg:justify-end">
        {/* Row actions surface on hover/focus (always visible below lg,
            where there is no reliable hover). */}
        <span className="flex items-center gap-1 lg:opacity-0 lg:transition-opacity lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
          {staff.active ? (
            <Link
              href={ownerHref({ kind: "staff", id: staff.id })}
              className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}
            >
              Hours
            </Link>
          ) : null}
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
        </span>
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`${staff.name} is bookable`}
          className="max-lg:absolute max-lg:top-2.5 max-lg:right-3"
        />
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
      {/* ARIA table grammar on the styled rows so "Owner" and the link read
          in their columns; the layout stays the responsive grid. */}
      <div role="table" aria-label="Team members" className="flex flex-col gap-3">
        <div
          role="row"
          className={cn(
            "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
            gridCols
          )}
        >
          <span role="columnheader">Name</span>
          <span role="columnheader">Booking link</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">
            <span className="sr-only">Actions</span>
          </span>
        </div>
        <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
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
    </div>
  );
}
