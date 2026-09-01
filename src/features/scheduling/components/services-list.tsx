"use client";

import * as React from "react";
import { toast } from "sonner";
import { deleteService, setServiceActive } from "@/features/scheduling/actions";
import { Switch } from "@/components/ui/switch";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { bookingLink } from "@/lib/booking/url";
import { bookableAdminServices } from "@/lib/booking/bookable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyLinkButton, type LinkBase } from "@/components/copy-link-button";
import { cn } from "@/lib/utils";
import { ServiceDialog } from "./service-dialog";

// Solo rule: one active person means the count is always "1 of 1" — noise, so
// the hint only exists once there is a team to narrow.
function teamLabel(service: ServiceRow, activeStaff: StaffRow[]): string | null {
  if (activeStaff.length < 2) return null;
  const assigned = activeStaff.filter((s) => service.staffIds.includes(s.id)).length;
  if (assigned === 0) return "No team members";
  return `${assigned} of ${activeStaff.length} team members`;
}

/* Shared column template so the header row and every service row align:
   Service | Duration | Price | actions — the Team page's table grammar
   (staff-list.tsx). Fixed tracks only fit from lg: up; below that the row
   keeps the stacked layout. */
const gridCols =
  "lg:grid lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_360px] lg:items-center lg:gap-3";

function Row({
  service,
  staff,
  linkBase,
  canLink,
}: {
  service: ServiceRow;
  staff: StaffRow[];
  linkBase: LinkBase | null;
  canLink: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  // Delete is irreversible (a service with bookings is refused server-side,
  // one without simply vanishes), so it takes two clicks — the same inline
  // Confirm/Keep step bookings-list.tsx uses for cancelling.
  const [confirming, setConfirming] = React.useState(false);
  // The switch moves the moment it's clicked and snaps back on its own if
  // the action fails (staff-list.tsx idiom).
  const [active, setActive] = React.useOptimistic(service.active);
  const team = teamLabel(
    service,
    staff.filter((s) => s.active),
  );

  const onToggle = (next: boolean) => {
    startTransition(async () => {
      setActive(next);
      const result = await setServiceActive({ id: service.id, active: next });
      if (!result.ok) toast.error(result.error);
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteService({ id: service.id });
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
    });
  };

  return (
    <li role="row" className={cn("group relative flex flex-col gap-2 rounded-lg px-3 py-2 hover:bg-muted/50", gridCols)}>
      <div role="cell" className="min-w-0 max-lg:pr-12">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">{service.name}</span>
          {!service.active ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        {team ? <p className="text-muted-foreground truncate text-xs">{team}</p> : null}
      </div>
      <span role="cell" className="text-muted-foreground text-xs tabular-nums max-lg:hidden">
        {service.durationMin} min
      </span>
      <span role="cell" className="text-muted-foreground truncate text-xs max-lg:hidden">
        {service.priceLabel ?? "—"}
      </span>
      {/* Below lg the columns collapse into one meta line. */}
      <p role="cell" className="text-muted-foreground text-xs lg:hidden">
        {service.durationMin} min{service.priceLabel ? ` · ${service.priceLabel}` : ""}
      </p>
      <div role="cell" className="flex items-center gap-1 max-lg:flex-wrap lg:justify-end">
        {/* Row actions surface on hover/focus (always visible below lg, and
            while the delete confirm is open — it must not vanish mid-choice). */}
        <span
          className={cn(
            "flex items-center gap-1 lg:transition-opacity lg:group-focus-within:opacity-100 lg:group-hover:opacity-100",
            confirming ? "lg:opacity-100" : "lg:opacity-0",
          )}
        >
          {/* Only a service a client can actually book gets a link — active and
              offered by an active person; an unlinked one would just degrade to
              the org flow. */}
          {canLink && linkBase ? (
            <CopyLinkButton
              url={bookingLink(linkBase.appUrl, linkBase.handle, { service: service.id })}
              name={service.name}
            />
          ) : null}
          <ServiceDialog service={service} staff={staff} />
          {confirming ? (
            <>
              <Button size="sm" variant="destructive" onClick={onDelete} disabled={pending}>
                {pending ? "Deleting…" : "Confirm delete"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Keep
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setConfirming(true)}
              disabled={pending}
              aria-label={`Delete ${service.name}`}
            >
              Delete
            </Button>
          )}
        </span>
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={`${service.name} is bookable`}
          className="max-lg:absolute max-lg:top-2.5 max-lg:right-3"
        />
      </div>
    </li>
  );
}

export function ServicesList({
  services,
  staff,
  linkBase,
}: {
  services: ServiceRow[];
  staff: StaffRow[];
  linkBase: LinkBase | null;
}) {
  const bookable = new Set(bookableAdminServices(services, staff).map((s) => s.id));
  return (
    // ARIA table grammar on the styled rows so duration and price read in
    // their columns; the layout stays the responsive grid.
    <div role="table" aria-label="Services" className="flex flex-col gap-3">
      <div
        role="row"
        className={cn(
          "hidden border-b px-3 pb-2 text-xs font-medium text-muted-foreground",
          gridCols,
        )}
      >
        <span role="columnheader">Service</span>
        <span role="columnheader">Duration</span>
        <span role="columnheader">Price</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>
      <ol role="rowgroup" className="flex flex-col max-lg:divide-y">
        {services.map((service) => (
          <Row
            key={service.id}
            service={service}
            staff={staff}
            linkBase={linkBase}
            canLink={linkBase !== null && bookable.has(service.id)}
          />
        ))}
      </ol>
    </div>
  );
}
