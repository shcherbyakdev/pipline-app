"use client";

import * as React from "react";
import { toast } from "sonner";
import { deleteService } from "@/features/scheduling/actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { bookingLink } from "@/lib/booking/url";
import { bookableAdminServices } from "@/lib/booking/bookable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyLinkButton, type LinkBase } from "@/components/copy-link-button";
import { ServiceDialog } from "./service-dialog";

// Solo rule: one active person means the count is always "1 of 1" — noise, so
// the hint only exists once there is a team to narrow.
function teamLabel(service: ServiceRow, activeStaff: StaffRow[]): string | null {
  if (activeStaff.length < 2) return null;
  const assigned = activeStaff.filter((s) => service.staffIds.includes(s.id)).length;
  if (assigned === 0) return "No team members";
  return `${assigned} of ${activeStaff.length} team members`;
}

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
  const team = teamLabel(
    service,
    staff.filter((s) => s.active),
  );

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
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{service.name}</span>
          {!service.active ? <Badge variant="outline">Inactive</Badge> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {service.durationMin} min{service.priceLabel ? ` · ${service.priceLabel}` : ""}
          {team ? ` · ${team}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={`Delete ${service.name}`}
          >
            Delete
          </Button>
        )}
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
    <ol className="flex flex-col gap-2">
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
  );
}
